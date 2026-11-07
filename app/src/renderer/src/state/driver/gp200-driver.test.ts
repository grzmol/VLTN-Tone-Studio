// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Gp200FamilyKey } from "@/gp200/lib/session.mjs";
import { MockGp200, generatePatch, type MockGp200Options } from "@/gp200/lib/mock-device.mjs";
import { CHUNK, CMD, GLOBAL_EQ_INDEX, REC, concat, encodeFrames, f32le, rec, tlv } from "@/gp200/lib/protocol.mjs";
import { crc16Modbus } from "@/gp200/lib/snaptone.mjs";
import { applyPatchEdits, buildPrst, isGp200Prst, parsePatch, parsePrst } from "@/gp200/lib/prst.mjs";
import { profileFor } from "@shared/devices";
import { firstEmptySlot } from "@shared/tone3000";
import type { DriverEvent } from "./types";
import { Gp200Driver, Gp200UpdaterError, gp200SlotKind } from "./gp200-driver";
import { GP200_EQ_DEFAULTS, GP200_GLOBAL_SPECS } from "./gp200-globals";


let open: Gp200Driver[] = [];
afterEach(async () => {
  await Promise.all(open.map((d) => d.close()));
  open = [];
});

async function simulate(device: Gp200FamilyKey = "gp200", mock: Omit<MockGp200Options, "type"> = {}): Promise<Gp200Driver> {
  // Paced like FAST_SIMULATOR (the default), so a 256-slot sync takes well under 1 s.
  const d = await Gp200Driver.simulate(device, { log: () => {}, onDisconnect: () => {}, mock });
  open.push(d);
  return d;
}

/** Driver whose identify() already ran (the connect handshake). */
async function connected(device: Gp200FamilyKey = "gp200", mock: Omit<MockGp200Options, "type"> = {}) {
  const d = await simulate(device, mock);
  await d.identify();
  return { d, dev: d.mock! };
}

/** Resolves with the first `n` driver events. */
function nextEvents(d: Gp200Driver, n: number): Promise<DriverEvent[]> {
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
const selects = (d: Gp200Driver) => d.mock!.log.flatMap((m) => m.records.flatMap((r) => (r.kind === "patchChanged" ? [r.slot] : [])));

describe("Gp200Driver sync", () => {
  it.each([
    ["gp200", 256, "64-D"],
    ["gp200lt", 256, "64-D"],
    ["gp200jr", 255, "64-C"],
  ] as const)("%s: names of every slot, the active slot, the edit buffer as a .prst, globals", async (device, count, lastLabel) => {
    const d = await simulate(device);
    const progress: [number, number][] = [];
    const snap = await d.sync({ onProgress: (done, total) => progress.push([done, total]) });
    const profile = profileFor(device);
    expect(snap.device).toBe(device);
    expect(d.device).toBe(device);
    expect(snap.names).toHaveLength(count);
    expect(profile.slotCount).toBe(count);
    expect(profile.slotLabel(snap.names.at(-1)!.slot)).toBe(lastLabel);
    expect(snap.names[5].name).toBe(parsePatch(d.mock!.slots[5]).name);
    expect(snap.slot).toBe(0);
    expect(isGp200Prst(snap.prst)).toBe(true);
    expect(parsePrst(snap.prst).patch.name).toBe(snap.names[0].name);
    expect(snap.globals?.values).toMatchObject({ inputMode: 1 });
    expect(snap.globals?.firmware).toBe("1.8.0");
    expect(snap.globals?.records.find((r) => r.a === 0x02)?.value).toBe(1);
    expect(progress.at(-1)).toEqual([progress.at(-1)![1], progress.at(-1)![1]]);
    expect(progress.length).toBeGreaterThan(count);
  });

  it("readNames reads every slot with progress; readPreset reads without selecting", async () => {
    const { d, dev } = await connected("gp200jr");
    let last = "";
    const names = await d.readNames({ onProgress: (done, total) => (last = `${done}/${total}`) });
    expect(names).toHaveLength(255);
    expect(last).toBe("255/255");
    const prst = await d.readPreset(40, names);
    expect(parsePrst(prst).patch.name).toBe(names[40].name);
    expect(await d.exportPreset(40)).toEqual(prst);
    expect(dev.current).toBe(0);
  });

  it("reports an edit buffer that differs from its slot at connect as modified", async () => {
    expect((await (await simulate()).sync()).modified).toBe(false);
    const d = await simulate();
    d.mock!.editBuffer = applyPatchEdits(d.mock!.editBuffer, { volume: 12 });
    expect((await d.sync()).modified).toBe(true);
    expect(await d.readModified()).toBe(false); // the pedal itself reported nothing yet
  });

  it("connects to a pedal that never answers User IR name reads: IR names unavailable, slots still read", async () => {
    // Field report: a real GP-200LT (firmware 1.6.0) never answered 0x1009 and every connect failed.
    const warnings: unknown[] = [];
    const d = await Gp200Driver.simulate("gp200lt", {
      log: (dir, _bytes, decoded) => void (dir === "warn" && warnings.push(decoded)),
      onDisconnect: () => {},
      timing: { replyTimeoutMs: 100 },
      mock: { silentQueries: [REC.IR_NAME] },
    });
    open.push(d);
    const snap = await d.sync();
    expect(snap.device).toBe("gp200lt");
    expect(snap.names).toHaveLength(256);
    expect(snap.names[5].name).toBe(parsePatch(d.mock!.slots[5]).name);
    expect(isGp200Prst(snap.prst)).toBe(true);
    expect(d.mock!.log.filter((m) => m.records[0]?.kind === "irName")).toHaveLength(4);
    expect(warnings).toContainEqual({ kind: "skipped", what: "User IR names" });
    // Unlisted: the default names, contents "unknown" (never offered as empty), and no new 4-try wait
    const asked = d.mock!.log.length;
    const irs = await d.readUserIRs();
    expect(irs).toHaveLength(20);
    expect(irs[0]).toEqual({ slot: 0, name: "User IR 1", kind: "unknown" });
    expect(irs[19]).toEqual({ slot: 19, name: "User IR 20", kind: "unknown" });
    expect(firstEmptySlot("ir", irs, "gp200lt")).toBeNull();
    expect(d.mock!.log).toHaveLength(asked);
    expect((await d.readSnapTones())[0]).toMatchObject({ slot: 0, kind: "empty" }); // SnapTone names still read
  });
});

describe("Gp200Driver slot tables", () => {
  it("reads the slot flag as the pedal sends it: 0 = holds data, 1 = empty", () => {
    // As a GP-200 on firmware 1.8.2 answers (example names): a stored SnapTone / User IR with flag 0, empty slots with flag 1
    expect(gp200SlotKind({ flag: 0, name: "My Capture" })).toBe("user");
    expect(gp200SlotKind({ flag: 0, name: "My Cab IR" })).toBe("user");
    expect(gp200SlotKind({ flag: 1, name: "" })).toBe("empty");
    expect(gp200SlotKind({ flag: 1, name: "User IR" })).toBe("empty");
    expect(gp200SlotKind({ flag: 1, name: "SnapTone 3" })).toBe("empty");
    // The flag decides: a stored IR the user named "Empty" is still occupied
    expect(gp200SlotKind({ flag: 0, name: "Empty" })).toBe("user");
    // Never offered as empty: an unexpected flag, or an "empty" slot with a name of its own
    expect(gp200SlotKind({ flag: 2, name: "" })).toBe("unknown");
    expect(gp200SlotKind({ flag: 1, name: "My Cab" })).toBe("unknown");
  });

  it("a stored SnapTone is never proposed as the first empty slot", async () => {
    const { d, dev } = await connected();
    dev.snapTone[0] = { name: "My Capture", sum: 0, data: new Uint8Array(16) };
    const table = await d.readSnapTones();
    expect(table[0]).toEqual({ slot: 0, name: "My Capture", kind: "user" });
    expect(table[1].kind).toBe("empty");
    expect(firstEmptySlot("snaptone", table, "gp200")).toBe(1);
  });
});

describe("Gp200Driver presets", () => {
  it("select goes out as 0x1008 only; its echo is no pedal-side change", async () => {
    const { d, dev } = await connected();
    const events: DriverEvent[] = [];
    d.subscribe((e) => events.push(e));
    await d.select(7);
    expect(dev.current).toBe(7);
    expect(dev.log.at(-1)?.records.map((r) => r.kind)).toEqual(["patchChanged"]);
    // the reply to this read comes after the select's echo, so the echo has been handled by now
    const active = await d.readActive([]);
    expect(active.slot).toBe(7);
    expect(parsePrst(active.prst).patch.name).toBe(parsePatch(dev.slots[7]).name);
    expect(events).toEqual([]);
  });

  it("reloadSlot drops the live edits by hopping to the next slot and back", async () => {
    const { d, dev } = await connected();
    await d.select(9);
    await d.setPatchVolume(3);
    await d.reloadSlot(9);
    expect(selects(d).slice(-2)).toEqual([10, 9]);
    expect(parsePatch(dev.editBuffer).volume).toBe(parsePatch(dev.slots[9]).volume);
  });

  it("live edits: params name the block's model, also after a model change", async () => {
    const { d, dev } = await connected();
    await d.select(4);
    const ampFxid = parsePatch(dev.editBuffer).blocks[3].fxid;
    await d.setParam(3, 0, 77);
    await d.setBlockEnabled(8, false);
    await d.setPatchVolume(88);
    await d.setBpm(300);
    const DST_FXID = 0x03000021;
    await d.setModel(2, DST_FXID);
    await d.setParam(2, 1, 12);
    const params = dev.log.flatMap((m) => m.records.flatMap((r) => (r.kind === "param" ? [r] : [])));
    expect(params.map((p) => [p.block, p.fxid])).toEqual([
      [3, ampFxid],
      [2, DST_FXID],
    ]);
    const live = parsePatch(dev.editBuffer);
    expect(live.blocks[3].params[0]).toBe(77);
    expect(live.blocks[8].enabled).toBe(false);
    expect(live.volume).toBe(88);
    expect(live.tempo).toBe(250);
    expect(live.blocks[2].fxid).toBe(DST_FXID);
    expect(live.blocks[2].params[1]).toBe(12);
    expect(dev.log.every((m) => m.header === null || m.header.a !== 0 || m.header.b === 4)).toBe(true);
    await expect(d.setParam(11, 0, 1)).rejects.toThrow(RangeError);
  });

  it("drops a param edit whose patch was left while its models were read", async () => {
    // Slot 0 (active) holds another amp than slot 1, so a param meant for slot 0 can't land on slot 1.
    const { d, dev } = await connected("gp200", { images: [applyPatchEdits(generatePatch(0), { blocks: { 3: { fxid: 0x07000001 } } })] });
    await Promise.all([d.setParam(3, 0, 12), d.select(1)]);
    expect(dev.violations).toEqual([]);
    expect(parsePatch(dev.editBuffer).blocks[3].params[0]).not.toBe(12);
    await d.setParam(3, 0, 13);
    expect(parsePatch(dev.editBuffer).blocks[3].params[0]).toBe(13);
    expect(dev.violations).toEqual([]);
  });

  it("writes a slot with a verified full write and leaves it active", async () => {
    const { d, dev } = await connected("gp200", { verifyGlitch: 1 });
    const prst = buildPrst(applyPatchEdits(dev.slots[3], { name: "Written" }));
    const progress: number[] = [];
    await d.writePreset(40, prst, { onProgress: (done) => progress.push(done) });
    expect(parsePatch(dev.slots[40]).name).toBe("Written");
    expect(progress.at(-1)).toBe(7);
    expect(dev.current).toBe(40);
    const readBacks = dev.log.filter((m) => m.header?.a === 1 && m.header.b === 40 && m.cmd === 0x11);
    expect(readBacks).toHaveLength(2);
  });

  it("writing the active slot moves off it first and comes back with a fresh edit buffer", async () => {
    const { d, dev } = await connected();
    await d.select(20);
    const events: DriverEvent[] = [];
    d.subscribe((e) => events.push(e));
    await d.writePreset(20, buildPrst(applyPatchEdits(dev.slots[3], { name: "Active Write" })));
    await d.readActive([]); // replies after the select echoes
    expect(selects(d).slice(-3)).toEqual([20, 21, 20]);
    expect(dev.current).toBe(20);
    expect(parsePatch(dev.editBuffer).name).toBe("Active Write");
    expect(events).toEqual([]);
  });

  it("refuses bytes that are no GP-200 preset", async () => {
    const { d } = await connected();
    await expect(d.writePreset(41, new Uint8Array(507))).rejects.toMatchObject({ code: "length" });
  });

  it("renames the active slot and another slot", async () => {
    const { d, dev } = await connected();
    await d.rename(60, "Other");
    await d.rename(0, "Current");
    expect(parsePatch(dev.slots[60]).name).toBe("Other");
    expect(parsePatch(dev.slots[0]).name).toBe("Current");
    expect(parsePatch(dev.editBuffer).name).toBe("Current");
  });

  it("backs up every slot with progress", async () => {
    const { d, dev } = await connected("gp200jr");
    const progress: string[] = [];
    const entries = await d.backupAll({ onProgress: (done, total) => progress.push(`${done}/${total}`) });
    expect(entries).toHaveLength(255);
    expect(progress.at(-1)).toBe("255/255");
    expect(entries[17].slot).toBe(17);
    expect(entries[17].name).toBe(parsePatch(dev.slots[17]).name);
    expect(isGp200Prst(entries[17].prst)).toBe(true);
    expect(dev.current).toBe(0);
  });
});

describe("Gp200Driver settings", () => {
  it("reads, clamps and sets GP-200 settings", async () => {
    const { d, dev } = await connected();
    const g = await d.readGlobals();
    expect(g.values.inputMode).toBe(1);
    expect(d.clampGlobal("inputLevel", 99)).toBe(20);
    expect(d.clampGlobal("midiOutChannelDin", -5)).toBe(-1);
    expect(d.clampGlobal("displayMode", 1.4)).toBe(1);
    await d.setGlobal("displayMode", 2);
    await d.setGlobal("inputLevel", -40);
    expect(dev.globals.displayMode).toBe(2);
    expect(dev.globals.inputLevel).toBe(-20);
    expect((await d.readGlobals()).values.inputLevel).toBe(-20);
  });

  it("refuses GP-5 settings and anything destructive before sending", async () => {
    const { d, dev } = await connected();
    const before = dev.log.length;
    expect(() => d.clampGlobal("masterVolume", 50)).toThrow(RangeError);
    for (const name of ["masterVolume", "deleteUserIr", "select", "globals"]) await expect(d.setGlobal(name as "masterVolume", 1)).rejects.toThrow(RangeError);
    expect(dev.log.length).toBe(before);
    expect(dev.violations.filter((v) => v.kind === "danger")).toEqual([]);
  });

  it("refuses the settings of jacks the connected model doesn't have", async () => {
    const { d, dev } = await connected("gp200jr");
    const before = dev.log.length;
    await expect(d.setGlobal("midiInChannelDin", 3)).rejects.toThrow("The GP-200JR has no setting midiInChannelDin");
    await expect(d.setGlobal("exp1Mode", 1)).rejects.toThrow(RangeError);
    expect(dev.log.length).toBe(before);
    await d.setGlobal("midiInChannelUsb", 3);
    expect(dev.globals.midiInChannelUsb).toBe(3);
  });

  it("gives every enum setting one label per value", () => {
    for (const s of GP200_GLOBAL_SPECS) if (s.labels) expect(s.max - s.min + 1).toBe(s.labels.length);
  });
});

describe("Gp200Driver Global EQ", () => {
  it("sets one value clamped to its range, refuses the unused ones, and reports the pedal's echo", async () => {
    const { d, dev } = await connected();
    expect((await d.readGlobals()).eq).toEqual({ values: GP200_EQ_DEFAULTS, read: false });
    const echo = nextEvents(d, 1);
    await d.setGlobalEq(GLOBAL_EQ_INDEX.band1.gain, 33);
    expect(await echo).toEqual([{ type: "globalEq", values: { [GLOBAL_EQ_INDEX.band1.gain]: 20 }, all: false }]);
    expect(dev.globalEq[GLOBAL_EQ_INDEX.band1.gain]).toBe(20);
    await d.setGlobalEq(GLOBAL_EQ_INDEX.band1.q, 0.123);
    expect(dev.globalEq[GLOBAL_EQ_INDEX.band1.q]).toBeCloseTo(0.12, 5);
    const before = dev.log.length;
    for (const unused of [2, 29, 31]) await expect(d.setGlobalEq(unused, 1)).rejects.toThrow(RangeError);
    expect(dev.log.length).toBe(before);
    expect((await d.readGlobals()).eq?.values[GLOBAL_EQ_INDEX.band1.gain]).toBe(20);
  });

  it("takes the whole EQ when the pedal reports it in one message with its settings", async () => {
    // Device-to-host bytes go through the transport's listener: keep it to play a 0x1004 report next to the settings
    let toHost: ((bytes: Uint8Array) => void) | null = null;
    const transport = MockGp200.prototype.transport;
    const spy = vi.spyOn(MockGp200.prototype, "transport").mockImplementation(function (this: MockGp200) {
      const t = transport.call(this);
      return { ...t, onMessage: (cb: (bytes: Uint8Array) => void) => t.onMessage((toHost = cb)) };
    });
    const { d } = await connected();
    spy.mockRestore();
    const reported = GP200_EQ_DEFAULTS.map((v, i) => (i === GLOBAL_EQ_INDEX.level ? 64 : v));
    const events = nextEvents(d, 1);
    for (const f of encodeFrames({ cmd: CMD.SET, payload: concat([rec.globals(new Uint8Array(72)), tlv(REC.GLOBAL_EQ_ALL, concat(reported.map(f32le)))]) }, CHUNK.DEVICE)) toHost!(f);
    expect((await events)[0]).toMatchObject({ type: "globalEq", all: true });
    const eq = (await d.readGlobals()).eq!;
    expect(eq.read).toBe(true);
    eq.values.forEach((v, i) => expect(v).toBeCloseTo(reported[i], 5)); // f32 on the wire
  });
});

/** A valid 0x2288 VTSI clone (the SnapTone conversion's output), as in gp200/tests/session.test.mjs. */
function cloneBlob(): Uint8Array {
  const b = new Uint8Array(0x2288);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x49535456, true);
  dv.setUint32(4, 0x2288, true);
  dv.setUint32(0x14, 0x2200, true);
  dv.setFloat64(0x18, 1, true);
  dv.setUint32(0x7c, 128, true);
  dv.setUint32(0x80, 128, true);
  dv.setUint32(0x84, 2048, true);
  for (let i = 0; i < 2176; i++) dv.setFloat32(0x88 + 4 * i, Math.sin(i) / (i + 1), true);
  const crc = crc16Modbus(b.subarray(12));
  b[8] = crc >> 8;
  b[9] = crc & 0xff;
  return b;
}

describe("Gp200Driver uploads", () => {
  it("uploads a User IR (int32 LE samples) and reports the stored name", async () => {
    const { d, dev } = await connected();
    const data = new Uint8Array(4096);
    const view = new DataView(data.buffer);
    for (let i = 0; i < 1024; i++) view.setInt32(i * 4, Math.round(8388607 * Math.exp(-i / 100)) * (i % 2 ? -1 : 1), true);
    let frames = 0;
    expect(await d.uploadUserIr(19, "My Cab IR", data, { onProgress: (done) => (frames = done) })).toBe("My Cab IR");
    expect(frames).toBe(23);
    expect(dev.userIr[19].data).toEqual(data);
    const irs = await d.readUserIRs();
    expect(irs).toHaveLength(20);
    expect(irs[19]).toEqual({ slot: 19, name: "My Cab IR", kind: "user" });
    expect(irs[0].kind).toBe("empty");
    await expect(d.uploadUserIr(0, "Odd", new Uint8Array(4097))).rejects.toThrow(RangeError);
  });

  it("uploads a SnapTone clone and refuses the GP-5 upload file", async () => {
    const { d, dev } = await connected();
    expect(await d.uploadSnapTone(5, "DST Snap", cloneBlob())).toBe("DST Snap");
    expect(dev.snapTone[5].data).not.toBeNull();
    const table = await d.readSnapTones();
    expect(table).toHaveLength(10);
    expect(table[5]).toMatchObject({ name: "DST Snap", kind: "user" });
    await expect(d.uploadSnapTone(6, "GP-5 file", new Uint8Array(2696))).rejects.toThrow(/GP-5 or GP-50/);
  });

  it("a User IR the pedal confirmed (0x100B) is written even when it doesn't answer the name read-back (0x1009)", async () => {
    const d = await Gp200Driver.simulate("gp200lt", { log: () => {}, onDisconnect: () => {}, timing: { replyTimeoutMs: 50 }, mock: { silentQueries: [REC.IR_NAME] } });
    open.push(d);
    const dev = d.mock!;
    await d.identify();
    expect(await d.uploadUserIr(2, "Cab 3", new Uint8Array(4096))).toBe("Cab 3");
    expect(dev.userIr[2].name).toBe("Cab 3");
    // The table stays unlisted: the uploaded slot is known, the others' contents aren't (never "empty")
    const irs = await d.readUserIRs();
    expect(irs[2]).toEqual({ slot: 2, name: "Cab 3", kind: "user" });
    expect(irs[0]).toEqual({ slot: 0, name: "User IR 1", kind: "unknown" });
    expect(irs.filter((s) => s.kind === "unknown")).toHaveLength(19);
    // The 0x100B confirmation stays strict
    dev.failUploads = true;
    await expect(d.uploadUserIr(3, "Refused", new Uint8Array(4096))).rejects.toThrow();
    expect((await d.readUserIRs())[3].kind).toBe("unknown");
  });
});

describe("Gp200Driver events and update mode", () => {
  it("maps pedal traffic to driver events", async () => {
    const { d, dev } = await connected("gp200", { emitKnobNotify: true });
    const events = nextEvents(d, 4);
    dev.pressPreset(9);
    dev.toggleBlock(3, false);
    dev.turnKnob(3, 1, 42);
    dev.tapTempo(133);
    expect(await events).toEqual([
      { type: "resync" },
      { type: "block", block: 3, enabled: false },
      { type: "param", block: 3, index: 1, value: 42 },
      { type: "patchSetting", field: "bpm", value: 133 },
    ]);
  });

  it("update mode: a ConnectionError-shaped refusal and nothing sent after SOFTWARE_STATE", async () => {
    const d = await simulate("gp200", { state: 0 });
    const dev = d.mock!;
    const sent: Uint8Array[] = [];
    const receive = dev.receive.bind(dev);
    dev.receive = (bytes) => {
      sent.push(Uint8Array.from(bytes));
      receive(bytes);
    };
    const err = await d.sync().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Gp200UpdaterError);
    expect(err).toMatchObject({ code: "bootloader", message: expect.stringMatching(/firmware update mode/) });
    const handshake = sent.length;
    expect(handshake).toBe(2);
    await expect(d.select(1)).rejects.toMatchObject({ code: "updater" });
    await expect(d.readPreset(1)).rejects.toMatchObject({ code: "updater" });
    await expect(d.identify()).rejects.toBeInstanceOf(Gp200UpdaterError);
    expect(sent.length).toBe(handshake);
    expect(dev.log).toEqual([]);
  });
});
