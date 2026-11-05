// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { CMD, GLOBAL_EQ, GLOBALS, eqValues } from "@/gp150/lib/protocol.mjs";
import { applyPatchEdits, parsePrst } from "@/gp150/lib/prst.mjs";
import type { DriverEvent } from "./types";
import { Gp150Driver } from "./gp150-driver";

let open: Gp150Driver[] = [];
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()));
  open = [];
});

async function connected(device: "gp150" | "gp180" = "gp150") {
  const d = await Gp150Driver.simulate(device, { log: () => {}, onDisconnect: () => {} });
  open.push(d);
  const snap = await d.sync();
  return { d, dev: d.mock!, snap };
}

/** Resolves with the first `n` driver events. */
function nextEvents(d: Gp150Driver, n: number): Promise<DriverEvent[]> {
  const { promise, resolve } = Promise.withResolvers<DriverEvent[]>();
  const seen: DriverEvent[] = [];
  const off = d.subscribe((e) => {
    seen.push(e);
    if (seen.length < n) return;
    off();
    resolve(seen);
  });
  return promise;
}

describe("Gp150Driver", () => {
  it("syncs the names, the active preset and the settings", async () => {
    const { dev, snap } = await connected();
    expect(snap.device).toBe("gp150");
    expect(snap.names).toHaveLength(200);
    expect(snap.slot).toBe(dev.activeSlot);
    expect(parsePrst(snap.prst).name).toBe(snap.names[snap.slot].name);
    expect(snap.globals?.firmware).toBe("1.1.1");
    expect(snap.globals?.values.fsMode).toBe(0);
  });

  it("shows the pedal's Global EQ in the GP-200's order: level last, the low cut first", async () => {
    const { snap } = await connected();
    const eq = snap.globals?.eq;
    expect(eq?.read).toBe(true);
    expect(eq?.values).toHaveLength(31);
    expect(eq?.values[30]).toBe(50);
    expect(eq?.values[1]).toBe(40);
  });

  it("writes one Global EQ value as the whole record, leaving the switch and the rest", async () => {
    const { d, dev } = await connected();
    const before = eqValues(dev.records.get(CMD.GLOBAL_EQ)!);
    await d.setGlobalEq(30, 70);
    await d.setGlobalEq(1, 120);
    const after = eqValues(dev.records.get(CMD.GLOBAL_EQ)!);
    expect(after[GLOBAL_EQ.LEVEL]).toBe(70);
    expect(after[3]).toBe(120);
    expect(after[GLOBAL_EQ.ON]).toBe(before[GLOBAL_EQ.ON]);
    expect(after.filter((v, i) => v !== before[i])).toHaveLength(2);
  });

  it("switches the Global EQ off as a setting, and a later EQ edit keeps it off", async () => {
    const { d, dev, snap } = await connected();
    expect(snap.globals?.values.globalEq).toBe(1);
    await d.setGlobal("globalEq", 0);
    await d.setGlobalEq(30, 60);
    const eq = eqValues(dev.records.get(CMD.GLOBAL_EQ)!);
    expect(eq[GLOBAL_EQ.ON]).toBe(0);
    expect(eq[GLOBAL_EQ.LEVEL]).toBe(60);
    expect((await d.readGlobals()).values.globalEq).toBe(0);
  });

  it("reads a record level at the pedal's −21 dB and sets it again, leaving a −21 sibling alone", async () => {
    const { d, dev } = await connected();
    const record = Uint8Array.from(dev.records.get(GLOBALS.micRecLevel.cmd)!);
    record.set([0xeb, 0xff], GLOBALS.micRecLevel.off);
    dev.records.set(GLOBALS.micRecLevel.cmd, record);
    const snap = await d.readGlobals();
    expect(snap.values.micRecLevel).toBe(-21);
    await d.setGlobal("btRecLevel", -21);
    const after = await d.readGlobals();
    expect(after.values.btRecLevel).toBe(-21);
    expect(after.values.micRecLevel).toBe(-21);
    expect(d.clampGlobal("micRecLevel", -21)).toBe(-21);
  });

  it("sends a param with the model of its module", async () => {
    const { d, dev } = await connected();
    await d.setParam(4, 0, 33);
    const sent = dev.received.at(-1)!;
    expect(sent.cmd).toBe(CMD.PARAM);
    const fxid = new DataView(sent.payload.buffer, sent.payload.byteOffset + 4).getUint32(0, true);
    expect(fxid).toBe(parsePrst(dev.editBuffer).blocks[4].fxid);
    expect(parsePrst(dev.editBuffer).blocks[4].params[0]).toBe(33);
  });

  it("sends tempo and volume as the settings record of the edit buffer", async () => {
    const { d, dev } = await connected();
    const name = parsePrst(dev.editBuffer).name;
    await d.setBpm(500);
    await d.setPatchVolume(77);
    const p = parsePrst(dev.editBuffer);
    expect([p.tempo, p.volume, p.name]).toEqual([260, 77, name]);
  });

  it("numbers SnapTones 0-99: factory below 50, user from 50 (the pedal's list entries 1-100)", async () => {
    const { d, dev } = await connected();
    const list = await d.readSnapTones();
    expect(list).toHaveLength(100);
    expect(list[0]).toMatchObject({ slot: 0, kind: "factory" });
    expect(list[50]).toMatchObject({ slot: 50, kind: "empty" });
    const stored = await d.uploadSnapTone(50, "My Amp", new Uint8Array(2696));
    expect(stored).toBe("My Amp");
    expect(dev.uploads[0].slot).toBe(51);
    expect((await d.readSnapTones())[50]).toMatchObject({ slot: 50, name: "My Amp", kind: "user" });
  });

  it("refuses SnapTone files that aren't the 2696-byte upload file", async () => {
    const { d } = await connected();
    await expect(d.uploadSnapTone(50, "x", new Uint8Array(4744))).rejects.toThrow(RangeError);
  });

  it("writes a preset, reads it back and leaves its slot active", async () => {
    const { d, dev } = await connected();
    const prst = applyPatchEdits(await d.readPreset(3), { name: "Moved" });
    await d.writePreset(120, prst);
    expect(parsePrst(dev.presets[120]).name).toBe("Moved");
    expect(dev.activeSlot).toBe(120);
  });

  it("reports pedal-side edits: a knob as a param, another preset as a resync", async () => {
    const { d, dev } = await connected();
    const knob = nextEvents(d, 1);
    await dev.turnKnob(10, 2, 55);
    expect(await knob).toEqual([{ type: "param", block: 10, index: 2, value: 55 }]);
    const patch = nextEvents(d, 1);
    await dev.selectOnPedal(17);
    expect(await patch).toEqual([{ type: "resync" }]);
  });

  it("connects a GP-180 as a GP-180 (the protocol is the GP-150's)", async () => {
    const { d, snap } = await connected("gp180");
    expect(snap.device).toBe("gp180");
    expect(d.portName).toBe("GP-180 (simulated)");
  });
});
