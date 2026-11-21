import assert from "node:assert/strict";
import { test } from "node:test";
import { CMD, SLOTS, Reassembler, decodeFrame, decodeMessage, decodeNames, packetize, query, rename, setPatchSettings } from "../lib/protocol.mjs";
import { GP150_CATALOG } from "../lib/catalog-data.mjs";
import { MockGp150 } from "../lib/mock-device.mjs";
import { Gp150Session } from "../lib/session.mjs";
import { NAM_VECTORS } from "./vectors.mjs";

const bytes = (hex) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (data) => Buffer.from(data).toString("hex");

test("captured NAM query, 18-packet reply, rename and both mode records re-encode byte for byte", () => {
  for (const [kind, vector] of Object.entries(NAM_VECTORS)) {
    const asm = new Reassembler();
    let done;
    for (const frame of vector.frames) done = asm.push(decodeFrame(bytes(frame))) ?? done;
    assert.equal(hex(done.bytes), vector.bytes);
    assert.equal(decodeMessage(done.bytes).crcOk, true);
    assert.deepEqual(packetize(done.bytes, vector.seq, kind !== "reply").map(hex), vector.frames);
  }
  assert.equal(hex(packetize(query(CMD.NAM_NAMES), NAM_VECTORS.query.seq)[0]), NAM_VECTORS.query.frames[0]);
  assert.equal(hex(packetize(rename(CMD.NAM_RENAME, 9, "Nam09"), NAM_VECTORS.rename.seq)[0]), NAM_VECTORS.rename.frames[0]);
  for (const [key, mode] of [
    ["modeNam", 1],
    ["modeSnapTone", 0],
  ]) {
    const vector = NAM_VECTORS[key];
    const msg = decodeMessage(bytes(vector.bytes));
    assert.equal(msg.payload[10], mode);
    assert.equal(hex(setPatchSettings(msg.payload.subarray(4))), vector.bytes);
  }
});

test("captured NAM list has None at 0, wire records 1-100 and independent empty flags", () => {
  const msg = decodeMessage(bytes(NAM_VECTORS.reply.bytes));
  const names = decodeNames(CMD.NAM_NAMES, msg.payload);
  assert.equal(names.length, 101);
  assert.deepEqual(names[0], { slot: 0, empty: true, name: "None" });
  assert.deepEqual(names[1], { slot: 1, empty: false, name: "Archon100" });
  assert.deepEqual(names[7], { slot: 7, empty: true, name: "NAM Slot 7" });
  assert.equal(names.at(-1).slot, 100);
});

test("NAM session lists and renames without changing SnapTones or the active preset", async () => {
  const mock = new MockGp150();
  const session = new Gp150Session(mock.transport(), { timing: { frameGapMs: 0, ackTimeoutMs: 100, replyTimeoutMs: 300 } });
  try {
    await session.connect();
    // Firmware pads the reply through 100. Even an occupied-looking reserved record must not become an editable slot.
    mock.namNames[21] = { name: "Reserved record", empty: false };
    const before = mock.editBuffer.slice();
    const list = await session.readNamNames();
    assert.equal(list.length, 20);
    assert.equal(list[0].slot, 1);
    assert.equal(list.at(-1).slot, 20);
    await session.renameListSlot("nam", 1, "New NAM", { confirm: true });
    await session.renameListSlot("nam", 20, "Last NAM", { confirm: true });
    const after = await session.readNamNames();
    assert.equal(after[0].name, "New NAM");
    assert.equal(after.at(-1).name, "Last NAM");
    assert.equal(after.at(-1).empty, true);
    assert.equal(mock.snapToneNames[1].name, "Factory 1");
    assert.deepEqual(mock.editBuffer, before);
    assert.throws(() => session.renameListSlot("nam", 1, "No confirm"), /confirm/);
    const beforeInvalid = mock.received.length;
    for (const slot of [0, 21, 100, 101, -1, 1.5, NaN]) assert.throws(() => session.renameListSlot("nam", slot, "Bad", { confirm: true }), /outside/);
    assert.equal(mock.received.length, beforeInvalid);
    assert.equal(
      mock.received.some((m) => m.cmd === CMD.NAM_UPLOAD),
      false,
    );
  } finally {
    await session.close();
  }
});

test("native NAM capacity matches the captured catalog's selectable model addresses, not its padded names reply", () => {
  const models = GP150_CATALOG.modules.find((m) => m.module === "NS").algs.filter((m) => m.code >>> 24 === 0x10);
  assert.equal(models.length, 20);
  assert.equal(SLOTS.NAMS, models.length);
  assert.deepEqual(
    models.map((m) => m.code),
    Array.from({ length: 20 }, (_, i) => 0x10000000 + i),
  );
});
