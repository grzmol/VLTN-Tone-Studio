import { describe, expect, it } from "vitest";
import { DEFAULT_LYRICS_MODEL_ID, downloadMegabytes, findLyricsModel, LYRICS_MODELS, lyricsMinutes } from "./lyrics-models";

describe("lyrics models", () => {
  it("has unique ids and a default that exists", () => {
    const ids = LYRICS_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findLyricsModel(DEFAULT_LYRICS_MODEL_ID)?.id).toBe("small");
  });

  it("looks models up by id and ignores unknown values", () => {
    expect(findLyricsModel("turbo")?.repo).toBe("onnx-community/whisper-large-v3-turbo_timestamped");
    expect(findLyricsModel("distil-en")).toBeUndefined();
    expect(findLyricsModel(undefined)).toBeUndefined();
  });

  it("orders the sizes from Fast to Best, with WebGPU files larger than the WASM ones", () => {
    const wasm = LYRICS_MODELS.map((m) => m.bytes.wasm);
    expect([...wasm].sort((a, b) => a - b)).toEqual(wasm);
    for (const m of LYRICS_MODELS) expect(m.bytes.webgpu).toBeGreaterThan(m.bytes.wasm);
  });

  it("shows the download size for the runtime in megabytes", () => {
    const base = findLyricsModel("base")!;
    expect(downloadMegabytes(base, false)).toBe(77);
    expect(downloadMegabytes(base, true)).toBe(146);
  });
});

describe("lyrics time estimate", () => {
  it("grows with the model and the quality, and with the length of the song", () => {
    expect(lyricsMinutes("turbo", "max", 4)).toBeGreaterThan(lyricsMinutes("small", "fast", 4));
    expect(lyricsMinutes("base", "fast", 8)).toBeCloseTo(2 * lyricsMinutes("base", "fast", 4));
  });
});
