// @vitest-environment node
import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { transformSync } from "esbuild";
import { Worker } from "node:worker_threads";

/** TypeScript source to plain JavaScript, imports kept (Node 26 dropped stripTypeScriptTypes' transform mode). */
const toJs = (source: string) => transformSync(source, { loader: "ts", format: "esm" }).code;

it("runs the production scheduler in a separate thread while the host thread is blocked", async () => {
  const engine = toJs(await readFile(new URL("./midi-scheduler.ts", import.meta.url), "utf8")).replace(
    /import[^;]+from ['"]\.\/(midi-chase|midi-pedal-order|speed|timecode)['"];?/g,
    "",
  );
  const chase = toJs(await readFile(new URL("./midi-chase.ts", import.meta.url), "utf8")).replace(
    /import[^;]+from ['"]\.\/chart['"];?/,
    "",
  );
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
    "parentPort.on('message',data=>self.onmessage({data}));",
    chase,
    pedalOrder,
    speed,
    timecode,
    engine,
    entry,
    "parentPort.postMessage({ready:true});",
  ].join("\n");
  const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent(source)));
  const messages: { reply?: { type: string; messages?: unknown[] }; at: number }[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("message", () => resolve());
    });
    worker.on("message", (data) => messages.push(data));
    const start = performance.timeOrigin + performance.now();
    worker.postMessage({
      type: "start",
      at: start,
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
