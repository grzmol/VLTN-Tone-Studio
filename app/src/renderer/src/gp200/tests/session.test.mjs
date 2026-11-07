import assert from "node:assert/strict";
import { test } from "node:test";
import { MockGp200 } from "../lib/mock-device.mjs";
import { CMD, REC, decodeFrame, encode, encodeFrames, rec, slotLabel, tlv } from "../lib/protocol.mjs";
import { applyPatchEdits, buildPrst, encodePatchImage, imagesMatch, parsePatch } from "../lib/prst.mjs";
import { Gp200Session } from "../lib/session.mjs";
import { checkGp200SnapTone, crc16Modbus } from "../lib/snaptone.mjs";

const fast = { multiChunkPauseMs: 40, selectSettleMs: 5, replyTimeoutMs: 300, globalsPushMs: 300, uploadTimeoutMs: 2000, saveTimeoutMs: 500 };
const AMP_FXID = 0x0700003a; // the generated bank's AMP model

/** Transport wrapper that records every host frame with its send time. */
function recorder(t) {
  const sent = [];
  return {
    sent,
    transport: {
      name: t.name,
      send: (bytes) => {
        sent.push({ t: Date.now(), bytes: Uint8Array.from(bytes) });
        t.send(bytes);
      },
      onMessage: (cb) => t.onMessage(cb),
      close: () => t.close(),
    },
  };
}

async function setup(mockOpts = {}, timing = fast) {
  const dev = new MockGp200({ deafMs: 20, ...mockOpts });
  const rec = recorder(dev.transport());
  const s = new Gp200Session(rec.transport, { timing });
  return { dev, s, sent: rec.sent };
}

const nextMessage = (s, kind) =>
  new Promise((resolve) => {
    const on = (e) => {
      if (e.message.kind !== kind) return;
      s.removeEventListener("message", on);
      resolve(e.message);
    };
    s.addEventListener("message", on);
  });

const gaps = (sent) => sent.slice(1).map((x, i) => x.t - sent[i].t);
const dataViolations = (dev) => dev.violations.filter((v) => v.kind !== "deaf");

test("connect: 0x2001, 100 ms, SOFTWARE_STATE, pushed 0x1007", async () => {
  const { dev, s, sent } = await setup({ firmware: "1.8.2" });
  const info = await s.connect();
  assert.deepEqual({ device: info.device, deviceType: info.deviceType, name: info.name, firmware: info.firmware, currentSlot: info.currentSlot }, { device: "gp200", deviceType: 2, name: "GP-200", firmware: "1.8.2", currentSlot: 0 });
  assert.equal(info.globals.inputMode, 1);
  assert.equal(decodeFrame(sent[0].bytes).data[0], 0x01, "first frame: 0x2001 query");
  assert.equal(decodeFrame(sent[1].bytes).address, "softwareState");
  assert.ok(sent[1].t - sent[0].t >= 100, "SOFTWARE_STATE 100 ms after the identity query");
  assert.equal(sent.length, 2, "the pushed 0x1007 needs no request");
  assert.equal(s.slotCount, 256);
  assert.deepEqual(dataViolations(dev), []);
  await s.close();
});

/** Host frames as "identity" (0x2001 query), "softwareState" or "other". */
const sentKinds = (sent) =>
  sent.map(({ bytes }) => {
    const f = decodeFrame(bytes);
    if (f.kind === "address") return f.address;
    return f.data[0] === 0x01 && f.data[1] === 0x20 ? "identity" : "other";
  });

test("connects when the pedal never answers SOFTWARE_STATE (captured behaviour)", async () => {
  // USB captures of the editor and a GP-200 on firmware 1.8.0 (phash/gp200editor): 0x2001 is answered, SOFTWARE_STATE is not
  const dev = new MockGp200({ deafMs: 20, firmware: "1.8.2" });
  const t = dev.transport();
  const received = [];
  const watched = { ...t, onMessage: (cb) => t.onMessage((bytes) => (received.push(decodeFrame(bytes)), cb(bytes))) };
  const { transport, sent } = recorder(watched);
  const s = new Gp200Session(transport, { timing: fast });
  const info = await s.connect();
  assert.deepEqual({ device: info.device, deviceType: info.deviceType, firmware: info.firmware }, { device: "gp200", deviceType: 2, firmware: "1.8.2" });
  assert.equal(received.filter((f) => f?.kind === "address").length, 0, "the pedal sent no SOFTWARE_STATE reply");
  assert.deepEqual(sentKinds(sent), ["identity", "softwareState"], "nothing resent");
  await s.close();
});

test("connect: a lost 0x2001 reply resends the identity query and SOFTWARE_STATE together", async () => {
  const dev = new MockGp200({ deafMs: 20 });
  const t = dev.transport();
  let dropped = 0;
  const lossy = {
    ...t,
    onMessage: (cb) =>
      t.onMessage((bytes) => {
        const f = decodeFrame(bytes);
        if (!dropped && f?.kind === "data" && f.data[0] === 0x01 && f.data[1] === 0x20) return void dropped++; // first 0x2001 reply lost
        cb(bytes);
      }),
  };
  const { transport, sent } = recorder(lossy);
  const s = new Gp200Session(transport, { timing: { ...fast, replyTimeoutMs: 100 } });
  assert.equal((await s.connect()).device, "gp200");
  assert.equal(dropped, 1);
  assert.deepEqual(sentKinds(sent), ["identity", "softwareState", "identity", "softwareState"]);
  await s.close();
});

test("connect falls back to 0x1006 when the pedal does not push 0x1007", async () => {
  const { s, sent } = await setup({ push1007: false });
  const info = await s.connect();
  assert.equal(info.firmware, "1.8.0");
  assert.equal(decodeFrame(sent.at(-1).bytes).data[0], 0x06, "0x1006 state dump");
  await s.close();
});

test("LT and JR: device keys, JR has 255 slots, labels 01-A..64-C", async () => {
  for (const [type, key, count] of [
    ["gp200lt", "gp200lt", 256],
    ["gp200jr", "gp200jr", 255],
  ]) {
    const { s } = await setup({ type });
    await s.connect();
    assert.equal(s.device, key);
    assert.equal(s.slotCount, count);
    if (key === "gp200jr") {
      assert.equal(slotLabel(254), "64-C");
      assert.throws(() => s.readStored(255), RangeError);
    }
    await s.close();
  }
});

test("updater mode: error 'updater' and nothing else is sent", async () => {
  const { dev, s, sent } = await setup({ state: 0 });
  await assert.rejects(s.connect(), { code: "updater" });
  assert.equal(s.isUpdater, true);
  await assert.rejects(s.selectPreset(1), { code: "updater" });
  await assert.rejects(s.readStored(1), { code: "updater" });
  assert.equal(sent.length, 2, "only the identity query and SOFTWARE_STATE");
  assert.deepEqual(dev.log, [], "the updater answered nothing but SOFTWARE_STATE");
  await s.close();
});

test("sync: editor order, every slot, names; a lost reply is resent", async () => {
  const dev = new MockGp200({ type: "gp200jr", deafMs: 20 });
  const t = dev.transport();
  let dropped = 0;
  const lossy = {
    ...t,
    onMessage: (cb) =>
      t.onMessage((bytes) => {
        const f = decodeFrame(bytes);
        if (!dropped && f?.kind === "data" && f.data[0] === 0x09 && f.data[1] === 0x10) return void dropped++; // first 0x1009 reply lost
        cb(bytes);
      }),
  };
  const s = new Gp200Session(lossy, { timing: { ...fast, replyTimeoutMs: 100 } });
  await s.connect();
  let progress = 0;
  const snap = await s.sync({ onProgress: (done, total) => (progress = `${done}/${total}`) });
  assert.equal(progress, "307/307");
  assert.equal(snap.presets.length, 255);
  assert.equal(snap.presets[5].label, "02-B");
  assert.equal(snap.presets[5].name, parsePatch(dev.slots[5]).name);
  assert.equal(snap.irNames.length, 20);
  assert.equal(snap.irNames[0].name, "User IR 1");
  assert.equal(snap.snapToneNames.length, 10);
  assert.equal(snap.styles[0], "Rock");
  assert.equal(snap.editBuffer.slot, 0);
  assert.equal(dropped, 1);
  assert.equal(dev.log.filter((m) => m.records[0]?.kind === "irName").length, 21, "one resend");
  assert.deepEqual(dataViolations(dev), []);
  await s.close();
});

test("sync: a pedal that never answers User IR name reads still syncs; the names are skipped after one query", async () => {
  // Field report: a GP-200LT (firmware 1.6.0) answered the identity, 0x1006 and 0x1000 but never 0x1009.
  const dev = new MockGp200({ type: "gp200lt", deafMs: 20, silentQueries: [REC.IR_NAME] });
  const warnings = [];
  const s = new Gp200Session(dev.transport(), { timing: { ...fast, replyTimeoutMs: 100 }, log: (dir, _bytes, d) => dir === "warn" && warnings.push(d) });
  await s.connect();
  let progress = 0;
  const snap = await s.sync({ onProgress: (done, total) => (progress = `${done}/${total}`) });
  assert.equal(snap.irNames, null);
  assert.equal(progress, "308/308");
  assert.equal(snap.presets.length, 256);
  assert.equal(snap.presets[5].name, parsePatch(dev.slots[5]).name);
  assert.equal(snap.editBuffer.slot, 0);
  assert.equal(snap.snapToneNames.length, 10);
  assert.equal(snap.styles[0], "Rock");
  assert.deepEqual(
    dev.log.filter((m) => m.records[0]?.kind === "irName").map((m) => m.records[0].slot),
    [0, 0, 0, 0],
    "User IR name 1 tried 4 times, the other 19 never asked",
  );
  assert.deepEqual(warnings, [1, 2, 3].map((attempt) => ({ kind: "resend", what: "User IR name 1", attempt })).concat({ kind: "skipped", what: "User IR names" }));
  assert.deepEqual(dataViolations(dev), []);
  await s.close();
});

test("sync: drum state, drum style names and SnapTone names are optional too; slots and edit buffer are not", async () => {
  const dev = new MockGp200({ deafMs: 20, silentQueries: [REC.DRUM_STATE, REC.STYLE_NAME, REC.SNAPTONE_NAME] });
  const warnings = [];
  const s = new Gp200Session(dev.transport(), { timing: { ...fast, replyTimeoutMs: 100 }, log: (dir, _bytes, d) => dir === "warn" && d.kind === "skipped" && warnings.push(d.what) });
  await s.connect();
  const snap = await s.sync();
  assert.equal(snap.drum, null);
  assert.equal(snap.snapToneNames, null);
  assert.deepEqual(snap.styles, new Array(20).fill(null));
  assert.equal(snap.irNames.length, 20);
  assert.equal(snap.presets.length, 256);
  assert.deepEqual(warnings, ["drum state", "drum style names", "SnapTone names"]);
  const asked = (kind) => dev.log.filter((m) => m.records[0]?.kind === kind).length;
  assert.deepEqual([asked("drumState"), asked("styleName"), asked("snapToneName")], [4, 4, 4], "each silent table is given up after its first entry");

  const deaf = new MockGp200({ deafMs: 20, silentQueries: [REC.READ] });
  const s2 = new Gp200Session(deaf.transport(), { timing: { ...fast, replyTimeoutMs: 50 } });
  await s2.connect();
  await assert.rejects(s2.sync(), { code: "timeout", message: /read slot 01-A/ });
  await s.close();
  await s2.close();
});

test("select + live edits: header {0, current}, edit buffer only, dirty notification", async () => {
  const { dev, s } = await setup();
  await s.connect();
  const echo = nextMessage(s, "patchChanged");
  assert.equal(await s.selectPreset(7), 7);
  assert.equal((await echo).slot, 7);
  assert.equal(dev.current, 7);
  const dirty = nextMessage(s, "dirty");
  await s.setParam("AMP", 0, AMP_FXID, 77);
  await s.setBlockEnabled("DLY", false);
  await s.setTempo(133);
  await s.setPatchName("Live Name");
  await s.setChain({ order: [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 4], sendPos: 3, returnPos: 4 });
  await s.setCtrl(1, 0b1001);
  assert.equal((await dirty).dirty, true);
  assert.ok(dev.log.slice(-6).every((m) => m.header?.a === 0 && m.header.b === 7), "edits use the current slot");
  const live = parsePatch((await s.readEditBuffer()).image);
  assert.equal(live.blocks[3].params[0], 77);
  assert.equal(live.blocks[8].enabled, false);
  assert.equal(live.tempo, 133);
  assert.equal(live.name, "Live Name");
  assert.deepEqual(live.chain.order, [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 4]);
  assert.equal(live.ctrl[1].mask, 0b1001);
  assert.notEqual(parsePatch(dev.slots[7]).tempo, 133, "stored slot untouched");
  await s.send(encode.param(3, { block: 3, paramId: 0, fxid: AMP_FXID, value: 1 }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(dev.violations.at(-1).kind, "hostBug", "the simulator flags a header naming another slot");
  await s.close();
});

test("save resolves on the 0x2003 echo; persistent writes need confirm", async () => {
  const { dev, s } = await setup();
  await s.connect();
  await s.selectPreset(9);
  await s.setPatchVolume(88);
  await assert.rejects(s.savePreset(9, "Nope"), { code: "unsafe" });
  assert.deepEqual(await s.savePreset(9, "Saved One", { confirm: true }), { slot: 9, name: "Saved One" });
  const stored = parsePatch(dev.slots[9]);
  assert.equal(stored.name, "Saved One");
  assert.equal(stored.volume, 88);
  dev.latencyMs = 1000; // no echo within saveTimeoutMs
  await assert.rejects(s.savePreset(9, "Late", { confirm: true }), { code: "timeout" });
  await s.close();
});

test("writePreset: full write, double read-back verify; the 0x9F glitch is ignored", async () => {
  const { dev, s } = await setup({ verifyGlitch: 1 });
  await s.connect();
  const image = applyPatchEdits(dev.slots[3], { name: "Written", volume: 12 });
  let frames = 0;
  const r = await s.writePreset(40, buildPrst(image), { confirm: true, onProgress: (d) => (frames = d) });
  assert.deepEqual(r, { frames: 7, attempts: 1, verified: true });
  assert.equal(frames, 7);
  assert.ok(imagesMatch(image, dev.slots[40]));
  assert.equal(parsePatch(dev.slots[40]).slot, 40);
  assert.equal(dev.log.filter((m) => m.header?.a === 1 && m.header.b === 40 && m.cmd === CMD.QUERY).length, 2, "two read-backs");
  await s.close();
});

test("writePreset retries a lost write and gives up with 'verify'", async () => {
  const { dev, s } = await setup({ loseWrites: 1 });
  await s.connect();
  const image = applyPatchEdits(dev.slots[3], { name: "Retry" });
  assert.deepEqual(await s.writePreset(41, image, { confirm: true }), { frames: 7, attempts: 2, verified: true });
  dev.loseWrites = 5;
  await assert.rejects(s.writePreset(42, image, { confirm: true, attempts: 2 }), { code: "verify" });
  await assert.rejects(s.writePreset(42, new Uint8Array(100), { confirm: true }), { code: "length" });
  await s.close();
});

test("writePreset to the active slot selects another slot first and re-selects it", async () => {
  const { dev, s } = await setup();
  await s.connect();
  await s.selectPreset(20);
  const image = applyPatchEdits(dev.slots[3], { name: "Active Write" });
  await s.writePreset(20, image, { confirm: true });
  const selects = dev.log.filter((m) => m.records[0]?.kind === "patchChanged").map((m) => m.records[0].slot);
  assert.deepEqual(selects, [20, 21, 20]);
  assert.equal(dev.current, 20);
  assert.equal(parsePatch(dev.editBuffer).name, "Active Write", "edit buffer reloaded");
  await s.close();
});

test("a CMD 0x03 flush stops the message being sent; verification repeats the write", async () => {
  const { dev, s, sent } = await setup({ flushAfter: 4 });
  await s.connect();
  const image = applyPatchEdits(dev.slots[3], { name: "Flushed" });
  const r = await s.writePreset(50, image, { confirm: true });
  assert.equal(r.attempts, 2);
  assert.ok(imagesMatch(image, dev.slots[50]));
  const writeFrames = sent.filter((x) => decodeFrame(x.bytes)?.len === 1184).length;
  assert.ok(writeFrames < 14, `first write cut short (${writeFrames} write frames)`);
  await s.close();
});

test("renamePreset: other slot via read + write, current slot via edit + save", async () => {
  const { dev, s } = await setup();
  await s.connect();
  await s.renamePreset(60, "Other", { confirm: true });
  assert.equal(parsePatch(dev.slots[60]).name, "Other");
  await s.renamePreset(0, "Current", { confirm: true });
  assert.equal(parsePatch(dev.slots[0]).name, "Current");
  assert.equal(parsePatch(dev.editBuffer).name, "Current");
  await s.close();
});

test("globals: set + echo, read back; destructive ids are refused before sending", async () => {
  const { dev, s, sent } = await setup();
  await s.connect();
  const echo = nextMessage(s, "global");
  await s.setGlobal("displayMode", 2);
  assert.deepEqual(await echo, { kind: "global", id: 0x28, name: "displayMode", value: 2, header: null });
  assert.equal(dev.globals.displayMode, 2);
  assert.equal(s.globals.displayMode, 2);
  await s.setGlobal("inputLevel", -6);
  assert.equal((await s.readGlobals()).values.inputLevel, -6);
  await s.setGlobalEq(30, 60);
  assert.equal(dev.globalEq[30], 60);
  assert.throws(() => s.setGlobal("deleteEverything", 1), RangeError);
  const before = sent.length;
  await assert.rejects(s.send(encode.global(0x17, 0)), { code: "unsafe" });
  await assert.rejects(s.send(encode.global(0x29, 5)), { code: "unsafe" });
  await assert.rejects(s.send({ cmd: CMD.SET, payload: rec.globals(new Uint8Array(72)) }), { code: "unsafe" });
  await assert.rejects(s.send({ cmd: CMD.SET, payload: tlv(REC.FIRMWARE_JUMP) }), { code: "unsafe" });
  await assert.rejects(s.send({ cmd: CMD.SET, address: [0x12, 0, 0x20, 0] }), { code: "unsafe" });
  await assert.rejects(s.sendShort([0xf0, 0x7e, 0x48, 0x01, 0xf7]), { code: "unsafe" });
  assert.equal(sent.length, before, "nothing dangerous reached the transport");
  assert.deepEqual(dataViolations(dev), []);
  await s.close();
});

test("simulator refuses and records dangerous frames sent around the session", () => {
  const dev = new MockGp200();
  const before = structuredClone(dev.userIr);
  dev.receive(encodeFrames({ cmd: CMD.SET, payload: tlv(REC.FIRMWARE_JUMP) })[0]);
  dev.receive(Uint8Array.from([0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32, 0x12, 0x12, 0, 0x20, 0, 0xf7]));
  dev.receive(encodeFrames({ cmd: CMD.SET, payload: rec.system(0x17, 0) })[0]);
  dev.receive(Uint8Array.from([0xf0, 0x7e, 0x48, 0x01, 0xf7]));
  assert.deepEqual(
    dev.violations.filter((v) => v.kind !== "gap").map((v) => v.kind),
    ["danger", "danger", "danger", "danger"],
  );
  assert.deepEqual(dev.userIr, before);
  assert.equal(dev.state, 1);
});

test("User IR upload: 1024 x int32, byte sum, 0x100B result, name refresh", async () => {
  const { dev, s } = await setup();
  await s.connect();
  const samples = Array.from({ length: 1024 }, (_, i) => Math.round(8388607 * Math.exp(-i / 100)) * (i % 2 ? -1 : 1));
  let last = 0;
  const r = await s.uploadUserIr(19, "My Cab IR", samples, { confirm: true, onProgress: (d) => (last = d) });
  assert.equal(r.frames, 23);
  assert.equal(last, 23);
  assert.deepEqual({ slot: r.entry.slot, name: r.entry.name, flag: r.entry.flag }, { slot: 19, name: "My Cab IR", flag: 0 });
  assert.equal(dev.userIr[19].data.length, 4096);
  assert.equal(new DataView(dev.userIr[19].data.buffer).getInt32(4, true), -8305139);
  dev.failUploads = true;
  await assert.rejects(s.uploadUserIr(0, "Bad", samples, { confirm: true }), { code: "verify" });
  await assert.rejects(s.uploadUserIr(20, "Range", samples, { confirm: true }), { code: "unsafe" });
  await s.close();
});

test("uploads: a confirmed upload (0x100B / 0x1014) succeeds when the name read-back gets no reply; the result stays strict", async () => {
  const dev = new MockGp200({ deafMs: 20, silentQueries: [REC.IR_NAME, REC.SNAPTONE_NAME] });
  const warnings = [];
  const s = new Gp200Session(dev.transport(), { timing: { ...fast, replyTimeoutMs: 50 }, log: (dir, _bytes, d) => dir === "warn" && d.kind === "skipped" && warnings.push(d.what) });
  await s.connect();
  const ir = await s.uploadUserIr(4, "Cab 5", new Array(1024).fill(1000), { confirm: true });
  assert.deepEqual({ slot: ir.slot, name: ir.name, entry: ir.entry }, { slot: 4, name: "Cab 5", entry: null });
  assert.equal(dev.userIr[4].name, "Cab 5");
  const snap = await s.uploadSnapTone(5, "DST Snap", cloneBlob(), { confirm: true });
  assert.deepEqual({ name: snap.name, entry: snap.entry }, { name: "DST Snap", entry: null });
  assert.notEqual(dev.snapTone[5].data, null);
  assert.deepEqual(warnings, ["User IR name 5", "SnapTone name 6"]);
  dev.failUploads = true;
  await assert.rejects(s.uploadUserIr(0, "Bad", new Array(1024).fill(1000), { confirm: true }), { code: "verify" });
  await s.close();
});

function cloneBlob() {
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

test("SnapTone upload: clone cut to 1024 taps, 0x1014 result, name refresh", async () => {
  const { dev, s } = await setup();
  await s.connect();
  const r = await s.uploadSnapTone(5, "DST Snap", cloneBlob(), { confirm: true });
  assert.equal(r.frames, 45);
  assert.equal(r.entry.name, "DST Snap");
  const stored = dev.snapTone[5].data;
  assert.equal(checkGp200SnapTone(stored), null);
  assert.equal(new DataView(stored.buffer).getUint32(0x84, true), 1024);
  await assert.rejects(s.uploadSnapTone(1, "Junk", new Uint8Array(100), { confirm: true }), { code: "length" });
  await s.close();
});

test("pacing: >= 10 ms between frames, 1 s after a multi-chunk message, no ACK waits", async () => {
  const { dev, s, sent } = await setup({ deafMs: 800 }, { selectSettleMs: 5 });
  await s.connect();
  const image = applyPatchEdits(dev.slots[3], { name: "Paced" });
  await s.writePreset(30, image, { confirm: true });
  const g = gaps(sent);
  assert.ok(g.every((x) => x >= 10), `gaps ${g.join(",")}`);
  const lastChunk = sent.findLastIndex((x) => decodeFrame(x.bytes)?.len === 1184);
  assert.ok(sent[lastChunk + 1].t - sent[lastChunk].t >= 1000, "1 s pause after the write");
  const chunks = sent.filter((x) => decodeFrame(x.bytes)?.len === 1184);
  assert.ok(gaps(chunks).every((x) => x < 100), "chunks are streamed, not ACK-gated");
  assert.deepEqual(dev.violations, [], "no gap, deaf-window or ACK-wait violations");
  await s.close();
});

test("events: pedal patch change, block toggle, knob (behind a flag), MIDI; fragmented SysEx", async () => {
  const dev = new MockGp200({ deafMs: 20, fragmentSysex: 37, emitKnobNotify: true });
  const t = dev.transport();
  let toHost;
  const s = new Gp200Session({ ...t, onMessage: (cb) => t.onMessage((toHost = cb)) }, { timing: fast });
  await s.connect();
  const changed = nextMessage(s, "patchChanged");
  dev.pressPreset(9);
  assert.equal((await changed).slot, 9);
  assert.equal(s.currentSlot, 9);
  const toggled = nextMessage(s, "blockEnabled");
  dev.toggleBlock(3, false);
  assert.deepEqual(await toggled, { kind: "blockEnabled", block: 3, enabled: false, header: { kind: "header", a: 0, b: 9 } });
  const knob = nextMessage(s, "param");
  dev.turnKnob(3, 1, 42);
  assert.equal((await knob).value, 42);
  const midi = new Promise((r) => s.addEventListener("midi", (e) => r(e.data), { once: true }));
  toHost(Uint8Array.of(0xb0, 7, 1)); // a CC from the pedal
  assert.deepEqual(await midi, Uint8Array.of(0xb0, 7, 1));
  await s.close();
});

test("simulator: CC0 + PC select with the manual's polarity, block CCs", async () => {
  const dev = new MockGp200();
  dev.receive(Uint8Array.of(0xb0, 0, 0));
  dev.receive(Uint8Array.of(0xc0, 2));
  assert.equal(dev.current, 130, "CC0 0 = second half (manual: CC0 1 = 01-A..32-D)");
  dev.receive(Uint8Array.of(0xb0, 0, 1));
  dev.receive(Uint8Array.of(0xc0, 2));
  assert.equal(dev.current, 2);
  dev.receive(Uint8Array.of(0xb0, 50, 0));
  assert.equal(parsePatch(dev.editBuffer).blocks[3].enabled, false, "CC50 = AMP off");
  const generated = parsePatch(encodePatchImage({ name: "x" }));
  assert.equal(generated.name, "x");
});
