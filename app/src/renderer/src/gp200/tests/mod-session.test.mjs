import assert from "node:assert/strict";
import { test } from "node:test";
import { MockGp200 } from "../lib/mock-device.mjs";
import { NOTIFY, encodeSceneRecord, encodeSettingsRecord, floatToBits } from "../lib/mod-service.mjs";
import { fromHex } from "../lib/protocol.mjs";
import { Gp200Session } from "../lib/session.mjs";
import { MOD_VECTORS as V } from "./mod-service-vectors.mjs";

const fast = { multiChunkPauseMs: 40, selectSettleMs: 5, replyTimeoutMs: 300, globalsPushMs: 300, uploadTimeoutMs: 2000, saveTimeoutMs: 500 };

async function setup(mockOpts = {}) {
  const dev = new MockGp200({ deafMs: 20, ...mockOpts });
  const s = new Gp200Session(dev.transport(), { timing: fast });
  await s.connect();
  return { dev, s };
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

test("a stock pedal stays silent: one timeout, no mod, nothing else changes", async () => {
  const { dev, s } = await setup();
  const t0 = Date.now();
  assert.equal(await s.modHello(), null);
  assert.ok(Date.now() - t0 < 2 * fast.replyTimeoutMs); // no resends
  assert.equal(s.mod, null);
  await assert.rejects(async () => s.readSceneList(), (e) => e.code === "mod");
  assert.deepEqual(dev.violations, []);
  await s.close();
});

test("HELLO, list and read the scenes the pedal holds", async () => {
  const scene0 = fromHex(V.records[2]); // owner 2 = slot 0
  const { dev, s } = await setup({ mod: { scenes: { 0: scene0 } } });
  const h = await s.modHello();
  assert.deepEqual([h.name, h.letter, h.version, h.firmwareTag], ["cenas", "C", "0.8.4", "V182"]);
  assert.deepEqual(h.scenes, { used: 1, free: 41, total: 42 });
  const list = await s.readSceneList();
  assert.deepEqual(list.records.map((r) => [r.slot, r.owner, r.format]), [[0, 2, 3]]);
  const r = await s.readScenes(0);
  assert.deepEqual(r.bytes, scene0);
  assert.equal(r.record.scenes[0].name, "P2 ON");
  assert.equal((await s.readScenes(5)).bytes, null); // no scenes
  assert.deepEqual((await s.readScenes(null, { index: 0 })).bytes, scene0); // by record-store index
  assert.deepEqual(dev.violations, []);
  await s.close();
});

test("write scenes in chunks with read-back, then delete", async () => {
  const { dev, s } = await setup({ mod: true });
  await s.modHello();
  await assert.rejects(async () => s.writeScenes(3, { scenes: [] }), (e) => e.code === "unsafe"); // needs confirm
  const big = { name: "BIG", params: Array.from({ length: 165 }, (_, i) => ({ block: i % 11, slot: Math.floor(i / 11), bits: floatToBits(i) })) };
  const { bytes } = await s.writeScenes(3, { scenes: [big, { name: "SOLO", volume: 80, params: big.params.slice(0, 20) }] }, { confirm: true });
  assert.ok(bytes.length > 1020); // two chunks
  assert.deepEqual(dev.modScenes(3), bytes);
  assert.equal((await s.readScenes(3)).record.scenes[1].name, "SOLO");
  await s.deleteScenes(3, { confirm: true });
  assert.equal(dev.modScenes(3), null);
  assert.deepEqual(dev.violations, []);
  await s.close();
});

test("the pedal's refusals come back as mod errors with the status", async () => {
  const { s } = await setup({ mod: true });
  await s.modHello();
  const otherOwner = encodeSceneRecord({ owner: 9, scenes: [{ name: "X", volume: 1 }] });
  await assert.rejects(s.writeScenes(0, otherOwner, { confirm: true }), (e) => e.code === "mod" && e.status === 6);
  const torn = otherOwner.slice();
  torn[torn.length - 1] ^= 0xff;
  await assert.rejects(s.writeScenes(0, torn, { confirm: true }), (e) => e.code === "length"); // never sent
  await s.close();
});

test("notifications after HELLO: scene changes and writes on the pedal", async () => {
  const { dev, s } = await setup({ mod: true });
  dev.setSceneMode(true); // before HELLO: silent
  const first = nextMessage(s, "modNotify");
  await s.modHello();
  // right after HELLO the pedal says where it is: scene mode on, the base playing
  const hello = await first;
  assert.deepEqual([hello.events, hello.sceneMode, hello.activeScene], [NOTIFY.SCENE, true, null]);
  const got = nextMessage(s, "modNotify");
  dev.selectScene(2);
  const n = await got;
  assert.deepEqual([n.events, n.sceneMode, n.activeScene, n.slot], [NOTIFY.SCENE, true, 2, 0]);
  const back = nextMessage(s, "modNotify");
  await s.writeScenes(0, { scenes: [{ name: "A", volume: 5 }] }, { confirm: true });
  const w = await back;
  assert.equal(w.events, NOTIFY.RECORD | NOTIFY.SCENE);
  assert.equal(w.activeScene, null); // the active preset went back to its base
  await s.close();
});

test("mod settings and guests", async () => {
  const guests = { 7: [{ fxid: 0x08000001, fromBlock: 8, fromPos: 1, sliceKb: 1379 }] };
  const { s } = await setup({ mod: { guests, settings: encodeSettingsRecord({ tapTempo: "preset" }) } });
  await s.modHello();
  assert.deepEqual(await s.readModSettings(), { tapTempo: "preset", stored: true });
  await s.writeModSettings({ tapTempo: "global" }, { confirm: true });
  assert.deepEqual(await s.readModSettings(), { tapTempo: "global", stored: true });
  assert.deepEqual(await s.modGuests("MOD"), guests[7]);
  assert.deepEqual(await s.modGuests("AMP"), []);
  await s.close();
});
