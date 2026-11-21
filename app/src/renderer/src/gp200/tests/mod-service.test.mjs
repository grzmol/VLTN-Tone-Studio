import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOTIFY,
  OP,
  STATUS,
  decodeGuests,
  decodeHello,
  decodeRecordChunk,
  decodeSceneList,
  decodeSceneRecord,
  decodeServiceData,
  decodeSettingsRecord,
  encodeRequest,
  encodeSceneRecord,
  encodeSettingsRecord,
  floatToBits,
  SceneRecordError,
  withModService,
} from "../lib/mod-service.mjs";
import { fromHex } from "../lib/protocol.mjs";
import { MOD_VECTORS as V } from "./mod-service-vectors.mjs";

const hex = (s) => fromHex(s);

test("requests are byte-identical to the firmware project's", () => {
  assert.deepEqual(encodeRequest({ op: OP.HELLO, seq: 1 }), hex(V.hello.request));
  assert.deepEqual(encodeRequest({ op: OP.SCENE_LIST, seq: 2 }), hex(V.sceneList.request));
  assert.deepEqual(encodeRequest({ op: OP.SCENE_READ, seq: 3, arg: 0 }), hex(V.sceneRead.request));
  assert.deepEqual(encodeRequest({ op: OP.GUESTS, seq: 4, arg: 7 }), hex(V.guestsMod.request));
});

test("HELLO from the firmware", () => {
  const r = decodeServiceData(hex(V.hello.reply));
  assert.equal(r.kind, "modService");
  assert.deepEqual([r.op, r.seq, r.status], [OP.HELLO, 1, STATUS.OK]);
  const h = decodeHello(r.payload);
  assert.deepEqual([h.name, h.letter, h.version, h.firmwareTag], ["cenas", "C", "0.7.0", "V182"]);
  assert.equal(h.features, 0x7f);
  assert.ok(h.has.SCENES_WRITE && h.has.NOTIFY && h.has.GUESTS);
  assert.deepEqual(h.scenes, { used: 1, free: 41, total: 42 });
  assert.deepEqual([h.maxRecord, h.maxFormat], [0x54c, 3]);
});

test("scene list, scene read and the record it carries", () => {
  const list = decodeSceneList(decodeServiceData(hex(V.sceneList.reply)).payload);
  assert.equal(list.records.length, 1);
  const [e] = list.records;
  assert.deepEqual({ slot: e.slot, index: e.index, format: e.format, scenes: e.scenes }, { slot: 0, index: 0, format: 1, scenes: 0b10 });
  const chunk = decodeRecordChunk(decodeServiceData(hex(V.sceneRead.reply)).payload);
  assert.equal(chunk.ref, e.owner);
  assert.equal(chunk.size, e.size);
  assert.equal(chunk.bytes.length, chunk.size);
  const rec = decodeSceneRecord(chunk.bytes);
  assert.equal(rec.owner, e.owner);
  assert.equal(rec.scenes[0], null);
  assert.equal(rec.scenes[1].name, "CENA B");
  assert.equal(rec.scenes[1].bpm, 140);
  assert.deepEqual(encodeSceneRecord(rec), chunk.bytes); // round trip, byte for byte
});

test("guests of MOD", () => {
  const g = decodeGuests(decodeServiceData(hex(V.guestsMod.reply)).payload);
  assert.equal(g.length, 96);
  assert.ok(g.every((x) => x.fromBlock !== 7));
  assert.ok(g.some((x) => x.sliceKb > 0)); // big delays play in the MOD slice
});

test("errors and notifications", () => {
  const bad = decodeServiceData(hex(V.badVersion.reply));
  assert.deepEqual([bad.seq, bad.status], [5, STATUS.VERSION]);
  const n = withModService({ kind: "unknown", type: 0x200c, data: hex(V.notifyScene.reply) });
  assert.equal(n.kind, "modNotify");
  assert.equal(n.events, NOTIFY.SCENE);
  assert.deepEqual([n.sceneMode, n.activeScene, n.savedScenes, n.slot], [true, 2, 0b10, 0]);
  assert.equal(decodeServiceData(Uint8Array.from([0x34, 0x12, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null); // not ours
  const other = { kind: "unknown", type: 0x1234, data: new Uint8Array() };
  assert.equal(withModService(other), other);
});

test("scene records of formats 1-3 match the reference serializer", () => {
  for (const [i, h] of V.records.entries()) {
    const bytes = hex(h);
    const rec = decodeSceneRecord(bytes);
    assert.equal(rec.format, i + 1);
    assert.deepEqual(encodeSceneRecord(rec), bytes, `format ${i + 1}`);
  }
  const [r1, r2, r3] = V.records.map((h) => decodeSceneRecord(hex(h)));
  assert.deepEqual([r1.scenes[0].name, r1.scenes[0].volume, r1.scenes[0].params[0]], ["LEAD", 62, { block: 3, slot: 0, bits: floatToBits(7.5) }]);
  assert.equal(r1.scenes[3].name, "CENA D");
  assert.equal(r2.scenes[1].reserve[3].fxid, 0x0700003a);
  assert.equal(r3.pre2.fxid, 3);
  assert.deepEqual([r3.scenes[0].pre2, r3.scenes[2].pre2], [true, false]);
});

test("encoder picks the lowest format, drops empty scenes, refuses what the pedal would", () => {
  const plain = decodeSceneRecord(encodeSceneRecord({ owner: 9, scenes: [{ name: "A", volume: 50 }, { name: "EMPTY" }] }));
  assert.equal(plain.format, 1);
  assert.equal(plain.scenes[1], null);
  assert.throws(() => encodeSceneRecord({ owner: 1, scenes: [] }), RangeError);
  assert.throws(() => encodeSceneRecord({ owner: 9, scenes: [{ pre2: true }] }), SceneRecordError);
  const huge = { name: "BIG", params: Array.from({ length: 165 }, (_, i) => ({ block: i % 11, slot: Math.floor(i / 11), bits: 0 })) };
  assert.throws(() => encodeSceneRecord({ owner: 9, scenes: [huge, huge] }), /a record holds/);
  const bytes = Uint8Array.from(hex(V.records[0]));
  bytes[bytes.length - 1] ^= 0xff;
  assert.throws(() => decodeSceneRecord(bytes), /checksum/);
});

test("settings record", () => {
  const b = encodeSettingsRecord({ tapTempo: "global" });
  assert.equal(b.length, 20);
  assert.deepEqual(decodeSettingsRecord(b), { tapTempo: "global" });
  assert.deepEqual(decodeSettingsRecord(encodeSettingsRecord()), { tapTempo: "preset" });
});
