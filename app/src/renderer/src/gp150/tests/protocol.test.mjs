import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CMD,
  CONTROL,
  GLOBAL_EQ,
  P,
  Reassembler,
  crc8,
  decodeNames,
  nameField,
  u32le,
  decodeFrame,
  decodeMessage,
  decodeParam,
  eqRecord,
  eqValues,
  hello,
  ack,
  nextSeq,
  packetize,
  query,
  readGlobal,
  readPatch,
  rename,
  resendRequest,
  setBlockOn,
  setGlobalRecord,
  setKnobs,
  setModel,
  setParam,
  writeGlobal,
} from "../lib/protocol.mjs";
import { EDIT_BUFFER_REPLY, FRAMES } from "./vectors.mjs";

const hex = (b) => Buffer.from(b).toString("hex");
const bytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
/** The logical message carried by a single-packet frame. */
const messageOf = (frameHex) => decodeFrame(bytes(frameHex)).data;

test("crc8 is CRC-8 poly 0x31, init 0 (check value of 123456789)", () => {
  assert.equal(crc8(Buffer.from("123456789")), 0xa2);
});

test("hello, ACK and the pedal's replies decode as control frames", () => {
  const [hostHello, pedalHello, , pedalAck] = FRAMES.connect;
  assert.equal(hex(hello()), hostHello);
  assert.deepEqual({ ...decodeFrame(bytes(pedalHello)), extra: null }, { kind: "control", type: CONTROL.HELLO_REPLY, arg: 3, seq: 0, index: 0, extra: null });
  assert.equal(hex(ack(0)), pedalAck);
  assert.equal(hex(ack(1)), FRAMES.connect[5]);
});

test("a frame with a wrong check byte or a non-nibble data byte is refused", () => {
  const good = bytes(FRAMES.connect[2]);
  const badCheck = good.slice();
  badCheck[2] ^= 1;
  assert.equal(decodeFrame(badCheck), null);
  const badNibble = good.slice();
  badNibble[12] = 0x10;
  assert.equal(decodeFrame(badNibble), null);
});

test("queries are built byte for byte like Suite's", () => {
  assert.equal(hex(packetize(query(CMD.STATE), 0)[0]), FRAMES.connect[2]);
  // the edit-buffer read of usb-connect (slot 0xFFFF, mode 1) and a select (select-patch-103: slot 102, mode 0)
  assert.deepEqual([...readPatch(0xffff, false).subarray(8)], [0x11, 0x30, 2, 0, 0xff, 0xff, 1]);
  assert.deepEqual([...readPatch(102, true).subarray(8)], [0x11, 0x30, 2, 0, 0x66, 0, 0]);
});

test("live edits are built byte for byte like Suite's", () => {
  assert.equal(hex(setParam(8, 0, 0x01000004, 19)), hex(messageOf(FRAMES.paramModDepth19)));
  assert.equal(hex(setModel(9, 0x0b00001d)), hex(messageOf(FRAMES.modelDly)));
  assert.equal(hex(setBlockOn(3, false)), hex(messageOf(FRAMES.blockNsOff)));
  assert.equal(hex(setKnobs([0, 0x0d, 4])), hex(messageOf(FRAMES.knobsPreBpmAmp)));
  assert.equal(hex(rename(CMD.IR_RENAME, 4, "MdrnHiGain")), hex(messageOf(FRAMES.irRename)));
});

test("frames carry the message number Suite used", () => {
  assert.equal(hex(packetize(setParam(8, 0, 0x01000004, 19), 118)[0]), FRAMES.paramModDepth19);
  assert.equal(hex(packetize(setKnobs([0, 0x0d, 4]), 101)[0]), FRAMES.knobsPreBpmAmp);
});

test("a param report decodes to model, value, module and param", () => {
  const m = decodeMessage(messageOf(FRAMES.paramModDepth19));
  assert.deepEqual(decodeParam(m.payload), { fxid: 0x01000004, value: 19, block: 8, param: 0 });
});

test("the pedal's 10-packet edit-buffer reply reassembles and re-encodes exactly", () => {
  const asm = new Reassembler();
  let done = null;
  for (const f of EDIT_BUFFER_REPLY.frames) done = asm.push(decodeFrame(bytes(f))) ?? done;
  assert.equal(hex(done.bytes), EDIT_BUFFER_REPLY.bytes);
  const msg = decodeMessage(done.bytes);
  assert.equal(msg.crcOk, true);
  assert.equal(msg.cmd, CMD.PATCH);
  assert.equal(msg.p, P.QUERY);
  // the pedal numbers its packets from 1
  assert.deepEqual(packetize(done.bytes, done.seq, false).map(hex), EDIT_BUFFER_REPLY.frames);
});

test("a packet that skips ahead is not added to its message", () => {
  const asm = new Reassembler();
  const [first, , third] = EDIT_BUFFER_REPLY.frames.map((f) => decodeFrame(bytes(f)));
  assert.equal(asm.push(first), null);
  assert.equal(asm.push(third), null);
  assert.deepEqual(asm.pending(first.seq), { offset: 119, total: 1136 });
});

test("resend requests have Suite's layout", () => {
  assert.equal(hex(resendRequest(7, 30, 3451, 119)), FRAMES.resend);
});

test("message numbers wrap from 127 to 1", () => {
  assert.equal(nextSeq(0), 1);
  assert.equal(nextSeq(126), 127);
  assert.equal(nextSeq(127), 1);
});

test("the factory reset is never built", () => {
  assert.throws(() => setGlobalRecord(CMD.FACTORY_RESET, [0]));
});

test("settings read and write within their record, signed where the pedal stores dB", () => {
  const io = Uint8Array.from([0xf7, 0xff, 1, 0, 0, 0, 0, 0, 0x32, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(readGlobal(io, "inputLevel"), -9);
  assert.equal(readGlobal(io, "micLevel"), 50);
  const next = writeGlobal(io, "inputLevel", 14);
  assert.deepEqual([...next.subarray(0, 2)], [14, 0]);
  assert.deepEqual([...next.subarray(2)], [...io.subarray(2)]);
  const sys = new Uint8Array(24);
  assert.equal(writeGlobal(sys, "fsMode", 1)[6], 1);
});

test("Global EQ: the switch is a u32, the rest f32", () => {
  const values = Array.from({ length: GLOBAL_EQ.VALUES }, (_, i) => (i === 0 ? 1 : i * 1.5));
  const rec = eqRecord(values);
  assert.deepEqual([...rec.subarray(0, 4)], [1, 0, 0, 0]);
  assert.deepEqual(eqValues(rec), values);
});

test("preset names: the slot is the list position, not the u32 the pedal sends (#140)", () => {
  const entries = [114, 121, 1].flatMap((id, i) => [...u32le(id), ...nameField(`Preset ${i}`)]);
  const names = decodeNames(CMD.PRESET_NAMES, Uint8Array.from([0, 0, 0, 0, ...entries]));
  assert.deepEqual(names.map((n) => [n.slot, n.name]), [[0, "Preset 0"], [1, "Preset 1"], [2, "Preset 2"]]);
});
