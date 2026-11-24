import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MockGp150 } from "../lib/mock-device.mjs";
import { NAMB_LENGTH, NAM_WEIGHT_COUNT, NamError, namTextToNamb, namToNamb } from "../lib/namb.mjs";
import { CMD, decodeMessage, packetize, upload } from "../lib/protocol.mjs";
import { Gp150Session } from "../lib/session.mjs";

// Facts from majabojarska/Valeton-GP180-Rev-Eng@11edfe5 (GPL-3.0): captured Suite uploads and cached converted models.
const vectors = JSON.parse(readFileSync(new URL("./fixtures/nam-upload-vectors.json", import.meta.url), "utf8"));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const FAST = { frameGapMs: 0, helloTimeoutMs: 50, ackTimeoutMs: 30, replyTimeoutMs: 100, uploadTimeoutMs: 200, resends: 1 };

test("converted models match the cached converted files", () => {
  assert.ok(vectors.cached.length >= 5);
  for (const c of vectors.cached) {
    const namb = namToNamb(c.nam);
    assert.equal(namb.length, NAMB_LENGTH, c.label);
    assert.equal(sha(namb), c.nambSha256, c.label);
  }
});

test("captured NAM uploads are rebuilt byte for byte, message and frames", () => {
  assert.equal(vectors.uploads.length, 3);
  for (const c of vectors.uploads) {
    const msg = upload(CMD.NAM_UPLOAD, c.slot, c.name, namToNamb(c.nam));
    assert.equal(sha(msg), c.messageSha256, c.label);
    const frames = packetize(msg, c.seq, true).map((f) => Buffer.from(f).toString("hex"));
    assert.equal(sha(frames.join("\n")), c.framesSha256, c.label);
    const decoded = decodeMessage(msg);
    assert.equal(decoded.crcOk, true);
    assert.equal(decoded.cmd, CMD.NAM_UPLOAD);
    // both record command fields are the SnapTone upload record
    assert.equal(decoded.payload[0] | (decoded.payload[1] << 8), CMD.SNAPTONE_UPLOAD);
    assert.equal(decoded.payload[8] | (decoded.payload[9] << 8), CMD.SNAPTONE_UPLOAD);
  }
  const full = vectors.uploads.find((c) => c.nambHex);
  assert.equal(Buffer.from(namToNamb(full.nam)).toString("hex"), full.nambHex);
});

test("IR and SnapTone uploads keep their own record command", () => {
  for (const cmd of [CMD.IR_UPLOAD, CMD.SNAPTONE_UPLOAD]) {
    const decoded = decodeMessage(upload(cmd, 3, "x", new Uint8Array(4)));
    assert.equal(decoded.payload[0] | (decoded.payload[1] << 8), cmd);
    assert.equal(decoded.payload[8] | (decoded.payload[9] << 8), cmd);
  }
});

const good = () => structuredClone(vectors.uploads[0].nam);
const refusal = (mutate, pattern) => {
  const nam = good();
  mutate(nam);
  assert.throws(() => namToNamb(nam), (e) => e instanceof NamError && /A2 Lite NAM files only/.test(e.message) && pattern.test(e.message));
};

test("anything that is not an A2 Lite NAM file is refused with a clear message", () => {
  refusal((n) => (n.version = "0.5.4"), /version/);
  refusal((n) => (n.architecture = "WaveNet"), /Architecture/);
  refusal((n) => (n.config.submodels[0].model.architecture = "LSTM"), /architecture/);
  refusal((n) => (n.config.submodels[0].model.sample_rate = 44100), /Sample rate/);
  refusal((n) => n.config.submodels[0].model.weights.pop(), /weights/);
  refusal((n) => (n.config.submodels[0].model.weights[5] = "x"), /invalid/);
  refusal((n) => delete n.config.submodels, /submodels/);
  assert.throws(() => namToNamb(null), NamError);
  assert.throws(() => namTextToNamb("not json"), /A2 Lite NAM files only/);
  assert.equal(NAM_WEIGHT_COUNT, 1871);
});

test("session uploads into NAM slots 1-20, lists the new name and refuses other slots", async () => {
  const mock = new MockGp150();
  const session = new Gp150Session(mock.transport(), { timing: FAST });
  await session.connect();
  const data = namToNamb(good());
  const entry = await session.uploadNam(20, "My Amp", data, { confirm: true });
  assert.deepEqual(entry, { slot: 20, name: "My Amp", empty: false });
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.uploads[0].cmd, CMD.NAM_UPLOAD);
  assert.equal(mock.uploads[0].data.length, 8192);
  assert.deepEqual([...mock.uploads[0].data.subarray(0, NAMB_LENGTH)], [...data]);
  assert.equal((await session.readNamNames()).find((e) => e.slot === 20).name, "My Amp");
  for (const slot of [0, 21, 100, 1.5]) await assert.rejects(session.uploadNam(slot, "x", data, { confirm: true }), RangeError);
  await assert.rejects(session.uploadNam(1, "x", data, {}), { code: "unsafe" });
  assert.equal(mock.uploads.length, 1);
});
