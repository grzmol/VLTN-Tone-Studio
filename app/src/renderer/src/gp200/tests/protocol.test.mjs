import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CMD,
  GLOBALS_RECORD_TAG,
  PATCH_SETTING,
  REC,
  Reassembler,
  SysexAssembler,
  dangerOf,
  dangerOfMessage,
  decodeFrame,
  decodeMessage,
  decodeRecord,
  decodeGlobals,
  encode,
  encodeFrames,
  encodeGlobals,
  fromHex,
  rec,
  slotLabel,
  tlv,
  toHex,
  walkTlv,
} from "../lib/protocol.mjs";
import { encodePatchImage } from "../lib/prst.mjs";
import { checkGp200SnapTone, crc16Modbus } from "../lib/snaptone.mjs";
import { VECTORS } from "./vectors.mjs";

const hex = (b) => toHex(b, "");
const set = (...records) => ({ cmd: CMD.SET, payload: Uint8Array.from(records.flatMap((r) => [...r])) });
const irSamples = (payload) => Array.from({ length: 1024 }, (_, i) => new DataView(payload.buffer, payload.byteOffset + 28 + 4 * i, 4).getInt32(0, true));
const snapPayload = () => {
  const v = VECTORS.snaptone_upload_slot5;
  const p = new Uint8Array(v.payloadBytes);
  p.set(fromHex(v.payload));
  return p;
};
const snapBlob = () => snapPayload().slice(28, 28 + 0x1288);

/** Every RE vector rebuilt from the codec's own builders (independent of the vector bytes). */
const BUILDERS = {
  read_patch_slot5: () => encode.readStored(5),
  read_editbuffer_cur5: () => encode.readEditBuffer(5),
  param_amp_p0_60: () => encode.param(5, { block: 3, paramId: 0, fxid: 0x07000055, value: 60 }),
  module_on_amp: () => encode.blockEnabled(5, 3, true),
  model_change_amp_07000055: () => encode.model(5, 3, 0x07000055),
  chain_reorder_default: () => encode.chain(5, { sendPos: 4, returnPos: 4, order: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
  patch_volume_50: () => encode.patchSetting(5, PATCH_SETTING.VOL, 50),
  patch_pan_target6: () => encode.patchSetting(5, PATCH_SETTING.PAN, 0),
  patch_tempo_120: () => set(rec.patchSetting(PATCH_SETTING.TEMPO, 120)),
  rename_slot5: () => encode.patchName(5, "My Patch"),
  author_slot5: () => encode.author(5, "Me"),
  note_slot5: () => encode.note(5, "hello"),
  style_name_idx2: () => encode.setStyleName(2, "Rock"),
  module_focus_amp: () => encode.focus(5, 3),
  qa1_amp_param0: () => encode.quickAccess(5, 0, 3, 0),
  ctrl1_mask_amp_dly: () => encode.ctrl(5, 0, 0, (1 << 3) | (1 << 8)),
  exp1a_p0_amp_gain: () => encode.exp(5, { key: 0, block: 3, param: 0, max: 100, min: 0 }),
  exp1a_p0_max80: () => encode.expRange(5, "max", 0, 80),
  save_current_to_slot5: () => encode.save(5, "My Patch"),
  save_to_slot5_e280: () => encode.save(5, ""),
  move_patch_5_to_9: () => encode.move(5, 9),
  move_commit: () => encode.moveCommit(),
  favorite_add_slot5: () => encode.favourite(5, true),
  delete_reset_slot5: () => encode.deletePatch(5),
  ir_upload_slot0: () => encode.userIr(0, "TEST IR", irSamples(fromHex(VECTORS.ir_upload_slot0.payload))),
  ir_rename_slot0: () => encode.irRename(0, "My Cab"),
  ir_delete_slot0: () => set(rec.system(0x17, 0)),
  ir_name_query_slot0: () => encode.irName(0),
  ir_ack_rx_slot0_ok: () => set(rec.uploadResult(REC.IR_RESULT, 0, 1)),
  snaptone_upload_slot5: () => encode.snapTone(5, "SNAP TEST", snapBlob()),
  snaptone_rename_slot5: () => encode.snapToneRename(5, "Brown Sound"),
  snaptone_delete_slot5: () => set(rec.system(0x29, 5)),
  snaptone_name_query_slot5: () => encode.snapToneName(5),
  snaptone_ack_rx_slot5_ok: () => set(rec.uploadResult(REC.SNAPTONE_RESULT, 5, 1)),
  drum_play: () => encode.drumPlay(true),
  drum_stop: () => encode.drumPlay(false),
  drum_rhythm_3: () => encode.drum(0, 3),
  drum_id1_50: () => encode.drum(1, 50),
  drum_bpm_120: () => encode.drum(2, 120),
  identity_query: () => encode.identity(),
  identity_reply_gp200: () => set(rec.identityReply(1, 2)),
  identity_reply_lt: () => set(rec.identityReply(1, 3)),
  state_dump_req: () => encode.stateDump(),
  q1000_zero_token: () => encode.drumState(),
  ir_name_q_slot0: () => encode.irName(0),
  fs_mode_stomp: () => encode.global(0x18, 1),
  "input_level_-6dB": () => encode.global(0x01, -6),
  select_slot5: () => encode.select(5),
  geq_band1_freq_250: () => encode.globalEq(8, 250),
  geq_level_60: () => encode.globalEq(30, 60),
  geq_on: () => encode.global(0x1e, 1),
  fs1_hold_tuner_patchmode: () => encode.fsFunction(0, 1, 7),
  core_identity_query: () => encode.identity(),
  core_select_slot5: () => encode.select(5),
};
/** Vectors checked by dedicated tests below. */
const SPECIAL = ["param_amp_p0_60_oss_display", "full_patch_write_slot5", "core_software_state_query", "core_software_state_reply_normal_gp200", "DANGER_firmware_jump_do_not_send"];

test("all 59 RE vectors are covered", () => {
  assert.equal(Object.keys(VECTORS).length, 59);
  for (const name of Object.keys(VECTORS)) assert.ok(BUILDERS[name] || SPECIAL.includes(name), `no check for ${name}`);
});

test("builders reproduce every vector byte for byte (payload, LEN, frames)", () => {
  for (const [name, build] of Object.entries(BUILDERS)) {
    const v = VECTORS[name];
    const msg = build();
    const payload = hex(msg.payload);
    assert.equal(msg.cmd, v.cmd, `${name} cmd`);
    if (name === "snaptone_upload_slot5") assert.equal(payload.replace(/(00)+$/, ""), v.payload, name);
    else assert.equal(payload, v.payload, `${name} payload`);
    if (v.len !== null) assert.equal(msg.payload.length, v.len, `${name} LEN`);
    const frames = encodeFrames(msg).map(hex);
    assert.equal(frames.length, v.frameCount, `${name} frame count`);
    if (v.frames) assert.deepEqual(frames, v.frames, `${name} frames`);
    else {
      assert.equal(frames[0], v.firstFrame, `${name} first frame`);
      assert.equal(frames.at(-1), v.lastFrame, `${name} last frame`);
      assert.deepEqual(frames.map((f) => f.slice(0, 26)), v.frameHeaders, `${name} frame headers`);
    }
  }
});

test("every vector frame decodes and reassembles to its payload", () => {
  for (const [name, v] of Object.entries(VECTORS)) {
    if (!v.frames || v.len === null || name.startsWith("DANGER")) continue;
    const r = new Reassembler();
    let out = null;
    for (const f of v.frames) out = r.push(decodeFrame(fromHex(f))) ?? out;
    assert.equal(hex(out.payload), v.payload, name);
    assert.equal(out.cmd, v.cmd, name);
  }
  const ir = VECTORS.ir_upload_slot0;
  const frames = encodeFrames({ cmd: CMD.SET, payload: fromHex(ir.payload) });
  const r = new Reassembler();
  const msg = frames.map((f) => r.push(decodeFrame(f))).at(-1);
  assert.equal(hex(msg.payload), ir.payload);
});

test("OSS 'display' junk in 0x0005 decodes to the same edit", () => {
  const strip = ({ payload }) => decodeMessage({ cmd: CMD.SET, payload: fromHex(payload) }).records[0];
  assert.deepEqual(strip(VECTORS.param_amp_p0_60_oss_display), strip(VECTORS.param_amp_p0_60));
  assert.deepEqual(strip(VECTORS.param_amp_p0_60), { kind: "param", block: 3, paramId: 0, fxid: 0x07000055, value: 60 });
});

test("SOFTWARE_STATE query and reply are address frames", () => {
  assert.deepEqual(encodeFrames(encode.softwareState()).map(hex), VECTORS.core_software_state_query.frames);
  const reply = decodeFrame(fromHex(VECTORS.core_software_state_reply_normal_gp200.frames[0]));
  assert.equal(reply.kind, "address");
  assert.equal(reply.address, "softwareState");
  assert.deepEqual([...reply.data], [1, 2]);
});

test("full write: preamble + image with the slot set, LEN 1184, the RE frame headers", () => {
  const v = VECTORS.full_patch_write_slot5;
  const msg = encode.fullWrite(5, encodePatchImage({ name: "Synthetic", slot: 0 }));
  assert.equal(msg.payload.length, v.len);
  assert.equal(hex(msg.payload.subarray(0, 16)), v.payload);
  assert.deepEqual(encodeFrames(msg).map((f) => hex(f).slice(0, 26)), v.frameHeaders);
  const recs = walkTlv(msg.payload.subarray(16));
  assert.equal(recs.find((r) => r.type === REC.INFO).data[0], 5, "0x0002 slot");
  assert.equal(recs.find((r) => r.type === REC.CHAIN).data[0], 5, "0x0008 slot");
});

test("danger guard: the firmware jump, updater frames, destructive ids and 0x1007 writes never pass", () => {
  const [jumpPrelude, jump] = VECTORS.DANGER_firmware_jump_do_not_send.frames;
  assert.equal(hex(encodeFrames(set(tlv(REC.FIRMWARE_JUMP)))[0]), jumpPrelude);
  for (const f of [jumpPrelude, jump, ...VECTORS.ir_delete_slot0.frames, ...VECTORS.snaptone_delete_slot5.frames]) assert.ok(dangerOf(fromHex(f)), f);
  assert.ok(dangerOf([0xf0, 0x7e, 0x48, 0x01, 0xf7]));
  assert.ok(dangerOfMessage(set(rec.system(0x27, 0))));
  assert.ok(dangerOfMessage(set(rec.globals(new Uint8Array(72)))));
  assert.ok(dangerOfMessage({ cmd: CMD.SET, address: [0x12, 0, 0x20, 0] }));
  for (const safe of [encode.select(5), encode.global(0x18, 1), encode.readStored(3), encode.softwareState()]) assert.equal(dangerOfMessage(safe), null);
  assert.equal(dangerOf([0xb0, 0, 1]), null);
});

test("RX keeps the low nibble unmasked; flush frames; chunk reassembly rules", () => {
  const f = decodeFrame([0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32, 0x12, 1, 0, 0, 0, 0x01, 0x1f, 0xf7]);
  assert.equal(f.data[0], 0x1f, "(1 << 4) | 0x1F");
  assert.equal(decodeFrame([0xf0, 0x21, 0x25, 0x7e, 0x47, 0x50, 0x2d, 0x32, 0x03, 0, 0, 0, 0, 0xf7]).kind, "flush");
  assert.equal(decodeFrame([0xf0, 0x41, 0x10, 0xf7]), null);

  const payload = Uint8Array.from({ length: 400 }, (_, i) => i & 0xff);
  const frames = encodeFrames({ cmd: CMD.SET, payload }, 185).map(decodeFrame);
  let t = 0;
  const r = new Reassembler({ now: () => t });
  assert.equal(r.push(frames[1]), null, "a chunk before OFF 0 is dropped");
  assert.equal(r.push(frames[0]), null);
  assert.equal(r.push(frames[0]), null, "OFF 0 restarts");
  t = 700;
  assert.equal(r.push(frames[1]), null, "stale after 600 ms");
  t = 800;
  r.push(frames[0]);
  r.push(frames[1]);
  assert.deepEqual(r.push(frames[2]).payload, payload);

  const host = new Reassembler({ shortChunkEnds: 183 });
  const q = encodeFrames({ cmd: CMD.QUERY, payload: rec.focus(3), len: 16 }).map(decodeFrame);
  assert.equal(host.push(q[0]).payload.length, 8, "a short host chunk ends the message");
});

test("SysexAssembler joins fragments and passes short messages", () => {
  const a = new SysexAssembler();
  const frame = encodeFrames(encode.select(5))[0];
  assert.deepEqual(a.push(frame.subarray(0, 7)), []);
  assert.deepEqual(a.push([0xf8]), [], "a real-time byte inside SysEx is dropped");
  const [whole] = a.push(frame.subarray(7));
  assert.deepEqual(whole, frame);
  assert.deepEqual(a.push([0xb0, 7, 100]), [Uint8Array.of(0xb0, 7, 100)]);
});

test("device records decode: globals, names, results, dirty, select echo", () => {
  const g = decodeGlobals(encodeGlobals({ currentSlot: 42, values: { inputLevel: -6, displayMode: 2, fsMode: 1 } }));
  assert.equal("firmware" in g, false);
  assert.equal(g.currentSlot, 42);
  assert.equal(g.values.inputLevel, -6);
  assert.equal(g.values.displayMode, 2);
  assert.equal(g.values.fsMode, 1);
  const dec = (r) => decodeRecord(walkTlv(r)[0]);
  assert.deepEqual(dec(rec.nameEntry(REC.IR_NAME, 3, 1, 99, "Cab")), { kind: "irName", slot: 3, flag: 1, sum: 99, name: "Cab" });
  assert.deepEqual(dec(rec.uploadResult(REC.SNAPTONE_RESULT, 5, 0)), { kind: "snapToneResult", slot: 5, status: 0, ok: false });
  assert.deepEqual(dec(rec.status(1, 1)), { kind: "dirty", dirty: true });
  assert.deepEqual(dec(rec.system(0, 200)), { kind: "patchChanged", slot: 200 });
  assert.deepEqual(dec(rec.system(0x01, -6)), { kind: "global", id: 1, name: "inputLevel", value: -6 });
  assert.deepEqual(dec(rec.patchSetting(PATCH_SETTING.PAN, -10)), { kind: "patchSetting", target: 6, value: -10 });
});

test("upload vectors: checksums and the SnapTone blob", () => {
  const ir = VECTORS.ir_upload_slot0;
  const samples = irSamples(fromHex(ir.payload));
  assert.deepEqual(samples.slice(0, 8), ir.first8Samples);
  assert.equal(new DataView(fromHex(ir.payload).buffer).getUint32(8, true), ir.pcmByteSum);
  const blob = snapBlob();
  assert.equal(checkGp200SnapTone(blob), null);
  assert.equal(crc16Modbus(blob.subarray(12)), VECTORS.snaptone_upload_slot5.blobCrc16);
  assert.equal(blob.reduce((s, x) => s + x, 0), VECTORS.snaptone_upload_slot5.blobByteSum);
  assert.equal(crc16Modbus(new TextEncoder().encode("123456789")), 0x4b37);
  assert.throws(() => rec.userIr(0, "x", [0x800000]), RangeError, "samples are 24-bit");
  assert.throws(() => rec.userIr(0, "x", new Array(1025).fill(0)), RangeError, "at most 1024 samples");
});

test("slot labels", () => {
  assert.equal(slotLabel(0), "01-A");
  assert.equal(slotLabel(5), "02-B");
  assert.equal(slotLabel(254), "64-C");
  assert.equal(slotLabel(255), "64-D");
});

test("0x1007 from a GP-200JR on firmware 1.8.0 (issue #136): settings and current slot, no firmware version", () => {
  const frame = decodeFrame(fromHex("F021257E47502D32124E06000000070100040800000000000600010000060400000000000000000000000000000000000000000000000100000001000000010000000000000000000000000000000200000000000000000000000000000F0F0F0F0004000000000000000000000000000000050000000000000000000000000000000B0307010700000000000000000000000000000000000000000000000100000001000000020100000800000001000007080000050000000609030801000100000400000B08000100010000000001000006000000000000000000000000000000040100070C0000000000000800030F00000000090A04020C030F050608030F0000000000000000000000000A000401080F0C020305030F0000000000000000000000000800030F00000000060304030C0D0C0C060C04000000000000000C00000000000800030F0000080001030404080F0C020305030F0000000000000000000000000800030F000006000C0C0404080F0C020305030F000000000800F7"));
  assert.equal(frame.off, 0);
  assert.equal(frame.len, 846);
  const [record] = walkTlv(frame.data);
  assert.equal(record.type, REC.GLOBALS);
  assert.deepEqual([...frame.data.slice(4, 8)], [...GLOBALS_RECORD_TAG]);
  const g = decodeRecord(record);
  assert.equal(g.kind, "globals");
  assert.equal(g.currentSlot, 100);
  assert.equal("firmware" in g, false);
});
