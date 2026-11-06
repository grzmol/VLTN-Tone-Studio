import { describe, expect, it } from "vitest";
import { WASM_RUNTIME, WEBGPU_RUNTIME } from "./lyrics-options";
import { diagnosticOf, heardEnough, noSingingMessage, preferredRuntime, runPass, transcribeAll, type LoadRecogniser, type WindowInput } from "./lyrics-passes";

const RATE = 16000;
type Chunk = { text: string; timestamp: [number | null, number | null] };
type Output = Chunk[] | Error;

/** Two windows of 30 s, the second starting at 28 s and owning song time from 29 s on. */
const input: WindowInput = {
  pieces: [new Float32Array(30 * RATE), new Float32Array(30 * RATE)],
  starts: [0, 28],
  spans: [
    { start: -Infinity, end: 29 },
    { start: 29, end: Infinity },
  ],
};

/** `count` words in a window, a word every 0.5 s from 1 s, in window-relative time. */
function sung(count: number): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({ text: ` w${i}`, timestamp: [1 + i * 0.5, 1.3 + i * 0.5] as [number, number] }));
}

/**
 * A fake pipeline per runtime. `outputs[device]` is called once per window (by call number), and returns the chunks for that window,
 * or throws when it returns an Error.
 */
function fakeLoad(outputs: Partial<Record<"webgpu" | "wasm", (call: number) => Output>>) {
  const loaded: string[] = [];
  const disposed: string[] = [];
  const load: LoadRecogniser = async (runtime) => {
    loaded.push(runtime.device);
    let call = 0;
    return {
      run: async () => {
        const output = outputs[runtime.device]!(call++);
        if (output instanceof Error) throw output;
        return { chunks: output };
      },
      dispose: async () => {
        disposed.push(runtime.device);
      },
    };
  };
  return { load, loaded, disposed };
}

function hooks() {
  const statuses: string[] = [];
  const pieces: number[] = [];
  return {
    statuses,
    pieces,
    hooks: { onStatus: (status: string) => statuses.push(status), onPiece: (index: number) => pieces.push(index) },
  };
}

describe("heardEnough", () => {
  it("asks for at least one word per 30 s of window audio", () => {
    expect(heardEnough(2, 60)).toBe(true);
    expect(heardEnough(1, 60)).toBe(false);
    expect(heardEnough(0, 0)).toBe(true);
  });
});

describe("transcribeAll", () => {
  it("runs the CPU pass and uses its words when WebGPU returns no chunks", async () => {
    const fake = fakeLoad({ webgpu: () => [], wasm: () => sung(4) });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(pass.runtime).toEqual(WASM_RUNTIME);
    expect(pass.words.length).toBe(8);
    expect(pass.rawWords).toBe(8);
    expect(fake.loaded).toEqual(["webgpu", "wasm"]);
    expect(fake.disposed).toEqual(["webgpu", "wasm"]);
    expect(h.statuses).toEqual(["No words from graphics acceleration; transcribing again on the CPU"]);
  });

  it("returns an empty result with its diagnostic when both passes hear nothing", async () => {
    const fake = fakeLoad({ webgpu: () => [], wasm: () => [] });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(pass.words).toEqual([]);
    expect(diagnosticOf(pass, input.pieces.length)).toEqual({ runtime: "wasm", parts: 2, rawWords: 0, keptWords: 0, cpuRetry: true });
    expect(noSingingMessage(diagnosticOf(pass, input.pieces.length))).toBe(
      "No singing found in the vocals (2 parts, 0 words heard on the CPU). Import or type lyrics, or retry transcription.",
    );
  });

  it("does not run the CPU when WebGPU hears enough", async () => {
    const fake = fakeLoad({ webgpu: () => sung(4), wasm: () => sung(9) });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(pass.runtime).toEqual(WEBGPU_RUNTIME);
    expect(pass.words.length).toBe(8);
    expect(fake.loaded).toEqual(["webgpu"]);
    expect(h.statuses).toEqual([]);
  });

  it("runs the CPU when WebGPU hears fewer than one word per 30 s", async () => {
    // Two windows make 60 s, so two words are needed. WebGPU keeps one.
    const fake = fakeLoad({ webgpu: (call) => (call === 0 ? sung(1) : []), wasm: () => sung(2) });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(pass.runtime).toEqual(WASM_RUNTIME);
    expect(fake.loaded).toEqual(["webgpu", "wasm"]);
  });

  it("uses the CPU when WebGPU throws, as before", async () => {
    const fake = fakeLoad({ webgpu: () => new Error("no device"), wasm: () => sung(4) });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(pass.runtime).toEqual(WASM_RUNTIME);
    expect(pass.words.length).toBe(8);
    expect(h.statuses).toEqual(["Graphics acceleration unavailable, using the CPU"]);
    expect(fake.disposed).toEqual(["webgpu", "wasm"]);
  });

  it("does not retry when the CPU is already the preferred runtime", async () => {
    const fake = fakeLoad({ wasm: () => [] });
    const h = hooks();
    const pass = await transcribeAll(fake.load, input, WASM_RUNTIME, h.hooks);
    expect(pass.words).toEqual([]);
    expect(fake.loaded).toEqual(["wasm"]);
    expect(h.statuses).toEqual([]);
  });

  it("reports each part of the pass it runs", async () => {
    const fake = fakeLoad({ webgpu: () => sung(4) });
    const h = hooks();
    await transcribeAll(fake.load, input, WEBGPU_RUNTIME, h.hooks);
    expect(h.pieces).toEqual([0, 1]);
  });
});

describe("runPass", () => {
  it("counts the chunks the transcriber returned, before the windows keep their words", async () => {
    // Each window returns three words. Window 2 starts at song 28 s, so its words at 1 s, 1.5 s and 2 s fall at 29 s and later, which it owns.
    const fake = fakeLoad({ wasm: () => sung(3) });
    const pass = await runPass(fake.load, WASM_RUNTIME, input, () => {});
    expect(pass.rawWords).toBe(6);
    expect(pass.words.length).toBe(6);
  });

  it("disposes the recogniser when a window fails", async () => {
    const fake = fakeLoad({ wasm: () => new Error("boom") });
    await expect(runPass(fake.load, WASM_RUNTIME, input, () => {})).rejects.toThrow("boom");
    expect(fake.disposed).toEqual(["wasm"]);
  });
});

describe("noSingingMessage", () => {
  it("says the words were dropped when the transcriber returned some but none were kept", () => {
    expect(noSingingMessage({ runtime: "webgpu", parts: 14, rawWords: 5, keptWords: 0, cpuRetry: true })).toContain(
      "The transcriber returned 5 words, but none were kept.",
    );
    expect(noSingingMessage({ runtime: "webgpu", parts: 14, rawWords: 5, keptWords: 0, cpuRetry: true })).toContain("on the graphics acceleration");
  });
});

describe("preferredRuntime", () => {
  it("starts on WebGPU only when there is an adapter that has not heard nothing here before", () => {
    expect(preferredRuntime(true, false)).toEqual(WEBGPU_RUNTIME);
    expect(preferredRuntime(true, true)).toEqual(WASM_RUNTIME);
    expect(preferredRuntime(false, false)).toEqual(WASM_RUNTIME);
  });
});

describe("cpuRetry in the diagnostic", () => {
  it("is set only when the CPU pass ran after an empty graphics pass", async () => {
    const retried = await transcribeAll(fakeLoad({ webgpu: () => [], wasm: () => sung(4) }).load, input, WEBGPU_RUNTIME, hooks().hooks);
    expect(diagnosticOf(retried, 2).cpuRetry).toBe(true);
    const direct = await transcribeAll(fakeLoad({ wasm: () => sung(4) }).load, input, WASM_RUNTIME, hooks().hooks);
    expect(diagnosticOf(direct, 2).cpuRetry).toBe(false);
    const heard = await transcribeAll(fakeLoad({ webgpu: () => sung(4) }).load, input, WEBGPU_RUNTIME, hooks().hooks);
    expect(diagnosticOf(heard, 2).cpuRetry).toBe(false);
  });
});
