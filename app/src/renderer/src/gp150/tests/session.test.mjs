import assert from "node:assert/strict";
import { test } from "node:test";
import { MockGp150 } from "../lib/mock-device.mjs";
import { CMD, GLOBALS, P } from "../lib/protocol.mjs";
import { applyPatchEdits, imagesMatch, parsePrst } from "../lib/prst.mjs";
import { Gp150Session } from "../lib/session.mjs";

const FAST = { frameGapMs: 0, helloTimeoutMs: 50, ackTimeoutMs: 30, replyTimeoutMs: 100, uploadTimeoutMs: 200, resends: 1 };

async function connected() {
  const mock = new MockGp150();
  const session = new Gp150Session(mock.transport(), { timing: FAST });
  const events = [];
  session.addEventListener("message", (e) => events.push(e.message));
  const info = await session.connect();
  return { mock, session, events, info };
}

test("connect: hello, state, settings with the firmware", async () => {
  const { mock, info } = await connected();
  assert.equal(info.firmware, "1.1.1");
  assert.equal(info.globals.fsMode, 0);
  assert.equal(info.eq?.length, 32);
  assert.deepEqual(
    mock.received.map((m) => m.cmd),
    [CMD.STATE, CMD.GLOBALS],
  );
});

test("names, edit buffer and select", async () => {
  const { mock, session } = await connected();
  const names = await session.readPresetNames();
  assert.equal(names.length, 200);
  assert.equal(names[5].name, parsePrst(mock.presets[5]).name);
  const prst = await session.selectPreset(5);
  assert.equal(parsePrst(prst).slot, 5);
  assert.equal(session.currentSlot, 5);
  assert.equal(mock.activeSlot, 5);
  const eb = await session.readEditBuffer();
  assert.equal(eb.slot, 5);
});

test("reading a stored preset does not select it", async () => {
  const { mock, session } = await connected();
  await session.selectPreset(2);
  const prst = await session.readPreset(9);
  assert.equal(parsePrst(prst).slot, 9);
  assert.equal(mock.activeSlot, 2);
  assert.equal(session.currentSlot, 2);
});

test("a live param edit reaches the edit buffer and the pedal reports it edited", async () => {
  const { mock, session, events } = await connected();
  const { prst } = await session.readEditBuffer();
  const amp = parsePrst(prst).blocks[4];
  await session.setParam(4, 0, amp.fxid, 42);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(parsePrst(mock.editBuffer).blocks[4].params[0], 42);
  assert.equal(session.modified, true);
  assert.ok(events.some((e) => e.kind === "modified" && e.modified));
});

test("writes need { confirm: true }", async () => {
  const { session } = await connected();
  const prst = await session.readPreset(0);
  assert.throws(() => session.writePreset(3, prst, {}), /confirm/);
  assert.throws(() => session.uploadUserIr(0, "x", [1], {}), /confirm/);
});

test("a write imports the file into its slot, reads it back and selects it", async () => {
  const { mock, session } = await connected();
  const prst = applyPatchEdits(await session.readPreset(0), { name: "Written" });
  const res = await session.writePreset(12, prst, { confirm: true });
  assert.equal(res.verified, true);
  assert.equal(parsePrst(mock.presets[12]).name, "Written");
  assert.equal(parsePrst(mock.presets[12]).slot, 12);
  assert.equal(mock.activeSlot, 12);
  const imp = mock.received.find((m) => m.p === P.UPLOAD && m.cmd === CMD.PATCH);
  assert.deepEqual([...imp.payload.subarray(10, 12)], [0x5c, 0x04]);
});

test("uploads: User IR and SnapTone land in their slot and the list is re-read", async () => {
  const { mock, session } = await connected();
  const ir = await session.uploadUserIr(4, "My Cab", Int32Array.from({ length: 683 }, (_, i) => i), { confirm: true });
  assert.deepEqual(ir, { slot: 4, name: "My Cab", empty: false });
  const up = mock.uploads[0];
  assert.equal(up.data.length, 8192);
  assert.equal(new DataView(up.data.buffer, up.data.byteOffset).getInt32(4 * 682, true), 682);
  const st = await session.uploadSnapTone(51, "Capture", new Uint8Array(2696).fill(7), { confirm: true });
  assert.deepEqual(st, { slot: 51, name: "Capture", empty: false });
  assert.throws(() => session.uploadSnapTone(0, "x", new Uint8Array(10), { confirm: true }), RangeError);
});

test("a setting is sent as its whole record with the one value changed", async () => {
  const { mock, session } = await connected();
  const before = mock.records.get(CMD.SYSTEM).slice();
  await session.setGlobal("fsMode", 1, GLOBALS.fsMode);
  const after = mock.records.get(CMD.SYSTEM);
  assert.equal(after[6], 1);
  assert.deepEqual([...after.subarray(7)], [...before.subarray(7)]);
});

test("pedal-side changes arrive as events and track the active slot", async () => {
  const { mock, session, events } = await connected();
  await mock.turnKnob(4, 1, 7);
  await mock.switchBlock(10, true);
  await mock.selectOnPedal(33);
  await mock.saveOnPedal();
  await new Promise((r) => setTimeout(r, 5));
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("param"));
  assert.ok(kinds.includes("block"));
  assert.ok(kinds.includes("patch"));
  assert.ok(kinds.includes("saved"));
  assert.ok(kinds.includes("names"));
  assert.equal(session.currentSlot, 33);
  assert.deepEqual(events.find((e) => e.kind === "param"), { kind: "param", fxid: parsePrst(mock.presets[0]).blocks[4].fxid, value: 7, block: 4, param: 1 });
});

test("a message without an ACK is sent again, then the request fails", async () => {
  const { mock, session } = await connected();
  mock.dropAcks = 1;
  const names = await session.readPresetNames();
  assert.equal(names.length, 200);
  mock.dropAcks = 5;
  await assert.rejects(() => session.readPresetNames(), /acknowledge/);
});

test("a silent pedal fails the hello", async () => {
  const session = new Gp150Session({ name: "x", send() {}, onMessage() {}, close() {} }, { timing: FAST });
  await assert.rejects(() => session.connect(), /connection request/);
});

// ------------------------------------------------------------------------ pushes during reads

/** A session on a simulator whose replies take a few ms, so a push can land while a read waits. */
async function slowConnected() {
  const mock = new MockGp150({ latencyMs: 5 });
  const session = new Gp150Session(mock.transport(), { timing: { ...FAST, ackTimeoutMs: 100, replyTimeoutMs: 500, uploadTimeoutMs: 1000 } });
  const events = [];
  session.addEventListener("message", (e) => events.push(e.message));
  await session.connect();
  return { mock, session, events };
}

test("a stored read takes its own reply, not a preset the pedal pushed meanwhile", async () => {
  const { mock, session, events } = await slowConnected();
  const [prst] = await Promise.all([session.readPreset(10), mock.selectOnPedal(150)]);
  assert.equal(parsePrst(prst).slot, 10);
  assert.ok(imagesMatch(prst, mock.presets[10]));
  await new Promise((r) => setTimeout(r, 30));
  const patches = events.filter((e) => e.kind === "patch");
  assert.equal(patches.length, 1);
  assert.equal(parsePrst(patches[0].prst).slot, 150);
  assert.equal(session.currentSlot, 150);
});

test("backupAll keeps every entry in its own slot when the pedal changes preset mid-backup", async () => {
  const { mock, session } = await slowConnected();
  let stop = false;
  const pushes = (async () => {
    for (let slot = 150; !stop; slot = slot === 150 ? 151 : 150) {
      await mock.selectOnPedal(slot);
      await new Promise((r) => setTimeout(r, 7));
    }
  })();
  const all = await session.backupAll();
  stop = true;
  await pushes;
  assert.equal(all.length, 200);
  for (const e of all) assert.equal(parsePrst(e.prst).slot, e.slot);
});

test("renamePreset keeps the slot's own sound when the pedal pushes another preset", async () => {
  const { mock, session } = await slowConnected();
  const before = mock.presets[10].slice();
  const other = mock.presets[150].slice();
  const [res] = await Promise.all([session.renamePreset(10, "X", { confirm: true }), mock.selectOnPedal(150)]);
  assert.equal(res.name, "X");
  assert.ok(imagesMatch(mock.presets[10], applyPatchEdits(before, { name: "X" })));
  assert.deepEqual([...mock.presets[150]], [...other]);
});

test("a write's verify read is not fooled by a push", async () => {
  const { mock, session } = await slowConnected();
  const prst = applyPatchEdits(mock.presets[0], { name: "Written" });
  // The push lands while the verify read waits, not during the import.
  const pushes = new Promise((r) => setTimeout(r, 12)).then(() => mock.selectOnPedal(150));
  const [res] = await Promise.all([session.writePreset(12, prst, { confirm: true }), pushes]);
  assert.equal(res.verified, true);
});

test("an edit-buffer read racing a push resolves with the pushed (current) patch", async () => {
  const { mock, session } = await slowConnected();
  const [eb] = await Promise.all([session.readEditBuffer(), mock.selectOnPedal(150)]);
  assert.equal(eb.slot, 150);
  assert.equal(parsePrst(eb.prst).slot, 150);
});
