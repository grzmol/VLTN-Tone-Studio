// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryStore, readPrstPaths } from "./files-store";
import { IMPORTED_ID, REPLACED_ID } from "@shared/host/files";
import { PRST_MODELS } from "@shared/devices";
import { applyPatchEdits } from '../../renderer/src/gp150/lib/prst.mjs';

/** Minimal bytes with the model's header and a name at 0x19 (the store only reads those). */
function fakePrst(name: string, device: "gp5" | "gp50" = "gp5"): Uint8Array {
  const b = new Uint8Array(device === "gp5" ? 507 : 552);
  b.set(new TextEncoder().encode(device === "gp5" ? "GP-5" : "GP-50"), 0);
  for (let i = 0; i < name.length; i++) b[0x19 + i] = name.charCodeAt(i);
  return b;
}

/** A 1224-byte GP-200 `.prst` header ("TSRP", "2-PG") with the patch name at 0x44. */
function fakeGp200Prst(name: string): Uint8Array {
  const b = new Uint8Array(1224);
  b.set(new TextEncoder().encode("TSRP"), 0);
  b.set(new TextEncoder().encode("2-PG"), 0x10);
  b.set(new TextEncoder().encode(name), 0x44);
  return b;
}

let root: string;
let store: LibraryStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gp5-lib-"));
  store = new LibraryStore(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("backups", () => {
  const day = new Date(2026, 9, 7, 14, 32);

  it('retains the GP-180 source model despite its shared GP-150 preset format', async () => {
    const prst = applyPatchEdits(null, { name: 'Inspection', slot: 14 });
    const info = await store.saveBackup([{ slot: 14, name: 'Inspection', prst }], day, 'gp180');
    expect(info).toMatchObject({ id: 'backups/gp180-2026-10-07', device: 'gp180', count: 1 });
    expect((await store.listPresets(info.id))[0].prst).toEqual(prst);
    await expect(store.saveBackup([{ slot: 14, name: 'Inspection', prst }], day, 'gp5')).rejects.toThrow(/one pedal model/);
  });

  it("writes NN-Name.prst files into gp5-YYYY-MM-DD and numbers a second backup of the day", async () => {
    const slots = [
      { slot: 0, name: "GreatPedal", prst: fakePrst("GreatPedal") },
      { slot: 1, name: "Neo Soul", prst: fakePrst("Neo Soul") },
      { slot: 97, name: "FF/CC", prst: fakePrst("FF/CC") },
    ];
    const first = await store.saveBackup(slots, day);
    const second = await store.saveBackup(slots, day);
    expect(first.id).toBe("backups/gp5-2026-10-07");
    expect(second.id).toBe("backups/gp5-2026-10-07-2");
    expect(first.count).toBe(3);
    const files = (await readdir(join(root, "backups", "gp5-2026-10-07"))).sort();
    expect(files).toEqual(["00-GreatPedal.prst", "01-Neo Soul.prst", "97-FF_CC.prst", "backup.json"]);
    const presets = await store.listPresets(first.id);
    expect(presets.map((p) => [p.slot, p.name])).toEqual([
      [0, "GreatPedal"],
      [1, "Neo Soul"],
      [97, "FF/CC"],
    ]);
    const json = JSON.parse(await readFile(join(root, "backups", "gp5-2026-10-07", "backup.json"), "utf8"));
    expect(json).toMatchObject({ device: "gp5", slots: 3 });
    expect(first).toMatchObject({ title: "GP-5 backup", device: "gp5" });
  });

  it("names and labels GP-50 backups by model", async () => {
    const gp5 = await store.saveBackup([{ slot: 0, name: "A", prst: fakePrst("A") }], day);
    const gp50 = await store.saveBackup([{ slot: 0, name: "A", prst: fakePrst("A", "gp50") }], day);
    expect(gp5.id).toBe("backups/gp5-2026-10-07");
    expect(gp50).toMatchObject({ id: "backups/gp50-2026-10-07", title: "GP-50 backup", device: "gp50", count: 1 });
    const json = JSON.parse(await readFile(join(root, "backups", "gp50-2026-10-07", "backup.json"), "utf8"));
    expect(json.device).toBe("gp50");
  });

  it("names GP-200 backups gp200-… with bank-letter slot labels", async () => {
    const info = await store.saveBackup([{ slot: 46, name: "Lead", prst: fakeGp200Prst("Lead") }], day);
    expect(info).toMatchObject({ id: "backups/gp200-2026-10-07", title: "GP-200 backup", device: "gp200", count: 1 });
    expect(await readdir(join(root, "backups", "gp200-2026-10-07"))).toContain("12-C-Lead.prst");
    expect((await store.listPresets(info.id)).map((p) => [p.slot, p.name])).toEqual([[46, "Lead"]]);
  });

  it("refuses a backup that mixes models or holds no presets", async () => {
    const mixed = [
      { slot: 0, name: "A", prst: fakePrst("A") },
      { slot: 1, name: "B", prst: fakePrst("B", "gp50") },
    ];
    await expect(store.saveBackup(mixed, day)).rejects.toThrow(/one pedal model/);
    await expect(store.saveBackup([{ slot: 0, name: "X", prst: new Uint8Array(507) }], day)).rejects.toThrow(/one pedal model/);
  });

  it("treats backup.json without a device as a GP-5 backup", async () => {
    const dir = join(root, "backups", "gp5-2026-03-04");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "00-A.prst"), fakePrst("A"));
    await writeFile(join(dir, "backup.json"), JSON.stringify({ createdAt: new Date(2026, 2, 4).toISOString(), slots: 1 }));
    expect((await store.listCollections())[0]).toMatchObject({ device: "gp5", title: "GP-5 backup" });
  });

  it("lists backups newest first and refuses to modify them", async () => {
    await store.saveBackup([{ slot: 0, name: "A", prst: fakePrst("A") }], new Date(2026, 9, 6));
    await store.saveBackup([{ slot: 0, name: "A", prst: fakePrst("A") }], day);
    const list = await store.listCollections();
    expect(list.map((c) => c.id)).toEqual(["backups/gp5-2026-10-07", "backups/gp5-2026-10-06"]);
    await expect(store.addPresets("backups/gp5-2026-10-07", [{ name: "x", prst: fakePrst("x") }])).rejects.toThrow(/read-only/);
    await expect(store.deleteCollection("backups/gp5-2026-10-07")).rejects.toThrow(/read-only/);
  });

  it("reads folders copied in by hand (no backup.json)", async () => {
    await mkdir(join(root, "backups", "gp5-2026-01-02"), { recursive: true });
    await writeFile(join(root, "backups", "gp5-2026-01-02", "05-Pure Clean.prst"), fakePrst("Pure Clean"));
    const [c] = await store.listCollections();
    expect(c.count).toBe(1);
    expect(new Date(c.createdAt).getMonth()).toBe(0);
    expect((await store.listPresets(c.id))[0].slot).toBe(5);
  });

  it("reads the model of a hand-copied folder from its presets", async () => {
    await mkdir(join(root, "backups", "Valeton export"), { recursive: true });
    await writeFile(join(root, "backups", "Valeton export", "05-Pure Clean.prst"), fakePrst("Pure Clean", "gp50"));
    expect((await store.listCollections())[0]).toMatchObject({ device: "gp50", title: "GP-50 backup" });
  });
});

describe("collections", () => {
  it("creates Imported files on first import and keeps both copies of a name", async () => {
    const a = await store.addPresets(IMPORTED_ID, [{ name: "Puppy", prst: fakePrst("Puppy"), fileName: "65-Puppy.prst", source: "65-Puppy.prst" }]);
    const b = await store.addPresets(IMPORTED_ID, [{ name: "Puppy", prst: fakePrst("Puppy"), fileName: "65-Puppy.prst" }]);
    expect(a[0].fileName).toBe("65-Puppy.prst");
    expect(b[0].fileName).toBe("65-Puppy (2).prst");
    const list = await store.listCollections();
    expect(list).toMatchObject([{ id: IMPORTED_ID, kind: "imported", title: "Imported files", count: 2 }]);
    expect((await store.listPresets(IMPORTED_ID))[0].source).toBe("65-Puppy.prst");
  });

  it("names replaced presets after their slot", async () => {
    const [p] = await store.addPresets(REPLACED_ID, [{ name: "Shatte-GT1", prst: fakePrst("Shatte-GT1"), slot: 63 }]);
    expect(p.fileName).toBe("63-Shatte-GT1.prst");
    expect(p.slot).toBe(63);
  });

  it("sanitises user collection names and keeps the title in collection.json", async () => {
    const c = await store.createCollection("  Gig: 7/10  ");
    expect(c.id).toBe("library/Gig_ 7_10");
    expect(c.title).toBe("Gig: 7/10");
    const again = await store.createCollection("Gig: 7/10");
    expect(again.id).toBe("library/Gig_ 7_10 (2)");
    const renamed = await store.renameCollection(c.id, "Rehearsal set");
    expect(renamed).toMatchObject({ id: c.id, title: "Rehearsal set" });
    const meta = JSON.parse(await readFile(join(root, "library", "Gig_ 7_10", "collection.json"), "utf8"));
    expect(meta.title).toBe("Rehearsal set");
  });

  it("keeps the order presets were added in and removes them", async () => {
    const c = await store.createCollection("Set");
    await store.addPresets(c.id, [
      { name: "Zed", prst: fakePrst("Zed") },
      { name: "Alpha", prst: fakePrst("Alpha") },
    ]);
    expect((await store.listPresets(c.id)).map((p) => p.name)).toEqual(["Zed", "Alpha"]);
    await store.removePreset(c.id, "Zed.prst");
    expect((await store.listPresets(c.id)).map((p) => p.name)).toEqual(["Alpha"]);
    await store.deleteCollection(c.id);
    expect(await store.listCollections()).toEqual([]);
  });

  it("gives library collections no device", async () => {
    await store.createCollection("Set");
    expect((await store.listCollections())[0].device).toBeNull();
  });

  it("rejects ids and file names that leave the library", async () => {
    await expect(store.listPresets("library/..")).rejects.toThrow(/Unknown collection/);
    await expect(store.listPresets("../etc")).rejects.toThrow(/Unknown collection/);
    await expect(store.removePreset(IMPORTED_ID, "../settings.json")).rejects.toThrow(/Unknown preset/);
  });
});

describe("readPrstPaths", () => {
  it("reads .prst files and explains what it rejects", async () => {
    const ok = join(root, "65-Puppy.prst");
    const big = join(root, "huge.prst");
    const txt = join(root, "notes.txt");
    await writeFile(ok, fakePrst("Puppy"));
    await writeFile(big, new Uint8Array(10_000));
    await writeFile(txt, "x");
    const [a, b, c, d] = await readPrstPaths([ok, big, txt, join(root, "missing.prst")]);
    expect(a).toMatchObject({ fileName: "65-Puppy.prst", error: null });
    expect(a.bytes?.length).toBe(507);
    expect(b.error).toBe(`Not a ${PRST_MODELS} preset.`);
    expect(c.error).toBe("Not a .prst preset file.");
    expect(d.error).toMatch(/Couldn't read/);
  });
});
