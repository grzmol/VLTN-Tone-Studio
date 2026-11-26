// @vitest-environment node
import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import { Worker } from "node:worker_threads";

/** TypeScript source to plain JavaScript, imports kept (Node 26 dropped stripTypeScriptTypes' transform mode). */
const toJs = (source: string) => transformSync(source, { loader: "ts", format: "esm" }).code;

async function createSchedulerWorker() {
  const engine = toJs(await readFile(new URL("./midi-scheduler.ts", import.meta.url), "utf8")).replace(
    /import[^;]+from ['"]\.\/(midi-chase|midi-pedal-order|speed|timecode)['"];?/g,
    "",
  );
  const chase = toJs(await readFile(new URL("./midi-chase.ts", import.meta.url), "utf8")).replace(/import[^;]+from ['"]\.\/chart['"];?/, "");
  // These have no imports; the scheduler reads their clamp, frame encoding and pedal order, so the worker needs them too.
  const pedalOrder = toJs(await readFile(new URL("./midi-pedal-order.ts", import.meta.url), "utf8"));
  const speed = toJs(await readFile(new URL("./speed.ts", import.meta.url), "utf8"));
  const timecode = toJs(await readFile(new URL("./timecode.ts", import.meta.url), "utf8"));
  const entry = toJs(await readFile(new URL("./midi-scheduler-worker.ts", import.meta.url), "utf8")).replace(
    /import[^;]+from ['"]\.\/midi-scheduler['"];?/,
    "",
  );
  const source = [
    "import {parentPort} from 'node:worker_threads';",
    "const self={postMessage:reply=>parentPort.postMessage({reply,at:performance.timeOrigin+performance.now()})};",
    "parentPort.on('message',data=>{if(data.testDelay)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,data.testDelay);self.onmessage({data});});",
    chase,
    pedalOrder,
    speed,
    timecode,
    engine,
    entry,
    "parentPort.postMessage({ready:true});",
  ].join("\n");
  const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent(source)));
  await new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", () => resolve());
  });
  return worker;
}

async function calibrate(worker: Worker) {
  const sent = performance.timeOrigin + performance.now();
  return new Promise<{ rendererAt: number; workerAt: number }>((resolve) => {
    const receive = (data: { reply?: { type: string; at: number; workerNow: number } }) => {
      if (data.reply?.type !== "clock" || data.reply.at !== sent) return;
      worker.off("message", receive);
      resolve({ rendererAt: (sent + performance.timeOrigin + performance.now()) / 2, workerAt: data.reply.workerNow });
    };
    worker.on("message", receive);
    worker.postMessage({ type: "clock", at: sent });
  });
}

it("runs the production scheduler in a separate thread while the host thread is blocked", async () => {
  const worker = await createSchedulerWorker();
  const messages: { reply?: { type: string; messages?: unknown[] }; at: number }[] = [];
  try {
    const clock = await calibrate(worker);
    worker.on("message", (data) => messages.push(data));
    const start = performance.timeOrigin + performance.now();
    worker.postMessage({
      type: "start",
      at: start,
      clock,
      config: { cues: [{ time: 0.1, text: "", messages: [[192, 1]] }], position: 0, duration: 1, origin: start, bpm: 120, clock: false, tempo: null },
    });
    // Deliberately block this test's host thread; production code never does this.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 180);
    const resumed = performance.timeOrigin + performance.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const batch = messages.find((m) => m.reply?.type === "batch");
    expect(batch).toBeDefined();
    expect(batch!.at).toBeLessThan(resumed - 30);
  } finally {
    await worker.terminate();
  }
}, 10000);

it("queues repeat state for its actual boundary even when the start message takes 160 ms to arrive", async () => {
  const worker = await createSchedulerWorker();
  let timer: ReturnType<typeof setInterval> | undefined;
  const batches: { at: number; reply: { type: string; messages?: { due: number; label: string; bytes: number[] }[] } }[] = [];
  try {
    const clock = await calibrate(worker);
    worker.on("message", (data) => {
      if (data.reply?.type === "batch") batches.push(data);
    });
    const start = performance.timeOrigin + performance.now(),
      origin = start + 300,
      jumpAt = start + 650;
    worker.postMessage({
      type: "start",
      at: start,
      clock,
      testDelay: 160,
      config: { cues: [{ time: 0, text: "", messages: [[192, 5]] }], position: 0, duration: 10, origin, bpm: 120, clock: false, tempo: null, lookahead: 0.2 },
    });
    worker.postMessage({ type: "plan", cap: 0.35, jump: { at: jumpAt, position: 0.5 } });
    timer = setInterval(() => {
      const at = performance.timeOrigin + performance.now();
      const position = at < origin ? 0 : at < jumpAt ? (at - origin) / 1000 : 0.5 + (at - jumpAt) / 1000;
      worker.postMessage({ type: "sync", at, position });
    }, 30);
    await new Promise((resolve) => setTimeout(resolve, 850));
    const chased = batches.flatMap((batch) =>
      (batch.reply.messages ?? []).filter((m) => m.label === "Chase state" && m.due === jumpAt).map((message) => ({ message, queued: batch.at })),
    );
    expect(chased).toHaveLength(1);
    expect(chased[0].message.bytes).toEqual([192, 5]);
    expect(chased[0].queued).toBeLessThan(jumpAt);
  } finally {
    clearInterval(timer);
    await worker.terminate();
  }
}, 10000);
