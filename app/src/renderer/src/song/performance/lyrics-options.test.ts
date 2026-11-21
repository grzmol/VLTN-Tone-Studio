import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LYRICS_CHOICE,
  fallbackRuntime,
  graphicsHeardNothing,
  rememberGraphicsHeardNothing,
  findLyricsQuality,
  hasWebGpuAdapter,
  loadLyricsChoice,
  loadLyricsOnAnalysis,
  runtimeFor,
  saveLyricsChoice,
  saveLyricsOnAnalysis,
  wasmThreads,
} from "./lyrics-options";
import { lyricsOptions } from "./lyrics-song-options";
import { clearSettingsCache } from "./settings";

beforeEach(() => {
  localStorage.clear();
  clearSettingsCache();
});

describe("lyrics choice", () => {
  it("starts from the defaults and remembers what was saved", () => {
    expect(loadLyricsChoice()).toEqual({ model: "small", quality: "fast" });
    saveLyricsChoice({ model: "turbo", quality: "max" });
    expect(loadLyricsChoice()).toEqual({ model: "turbo", quality: "max" });
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("gp5.song.lyrics.v1", "{not json");
    expect(loadLyricsChoice()).toEqual(DEFAULT_LYRICS_CHOICE);
  });

  it("falls back per field when a model was removed or the stored value is the old shape", () => {
    localStorage.setItem("gp5.song.lyrics.v1", JSON.stringify({ model: "distil-en", quality: "balanced" }));
    expect(loadLyricsChoice()).toEqual({ model: "small", quality: "balanced" });
    localStorage.setItem("gp5.song.lyrics.v1", JSON.stringify({ language: "english" }));
    expect(loadLyricsChoice()).toEqual(DEFAULT_LYRICS_CHOICE);
  });
});

describe("lyricsOptions", () => {
  it("combines the remembered choice with the song's own language", () => {
    saveLyricsChoice({ model: "base", quality: "balanced" });
    localStorage.setItem("song:options", JSON.stringify({ lyricsLanguage: "dutch", shift: 2 }));
    expect(lyricsOptions("song")).toEqual({ model: "base", quality: "balanced", language: "dutch" });
  });

  it("uses automatic language for unknown or corrupt song options", () => {
    localStorage.setItem("song:options", JSON.stringify({ lyricsLanguage: "klingon" }));
    expect(lyricsOptions("song").language).toBe("auto");
    localStorage.setItem("song:options", "{bad");
    expect(lyricsOptions("song").language).toBe("auto");
  });
});

describe("WebGPU choice", () => {
  it("counts WebGPU only when an adapter really comes back", async () => {
    expect(await hasWebGpuAdapter(undefined)).toBe(false);
    expect(await hasWebGpuAdapter({ requestAdapter: async () => null })).toBe(false);
    expect(await hasWebGpuAdapter({ requestAdapter: async () => ({}) })).toBe(true);
    expect(
      await hasWebGpuAdapter({
        requestAdapter: async () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(false);
  });

  it("falls back from WebGPU to WASM once and never beyond", () => {
    expect(fallbackRuntime({ device: "webgpu", dtype: "fp16" })).toEqual({ device: "wasm", dtype: "q8" });
    expect(fallbackRuntime({ device: "wasm", dtype: "q8" })).toBeUndefined();
  });
});

describe("quality, device and threads", () => {
  it("maps each quality to a beam width", () => {
    expect(findLyricsQuality("fast")?.beams).toBe(1);
    expect(findLyricsQuality("balanced")?.beams).toBe(3);
    expect(findLyricsQuality("max")?.beams).toBe(5);
    expect(findLyricsQuality("turbo")).toBeUndefined();
  });

  it("uses WebGPU with fp16 files when available, otherwise WASM with q8", () => {
    expect(runtimeFor(true)).toEqual({ device: "webgpu", dtype: "fp16" });
    expect(runtimeFor(false)).toEqual({ device: "wasm", dtype: "q8" });
  });

  it("uses more WASM threads only when cross-origin isolated, capped at four", () => {
    expect(wasmThreads(false, 12)).toBe(1);
    expect(wasmThreads(true, 12)).toBe(4);
    expect(wasmThreads(true, 2)).toBe(2);
    expect(wasmThreads(true, 0)).toBe(1);
  });
});

describe("transcribe lyrics when analysing", () => {
  it("is off by default and remembers the choice", () => {
    expect(loadLyricsOnAnalysis()).toBe(false);
    saveLyricsOnAnalysis(true);
    expect(loadLyricsOnAnalysis()).toBe(true);
    saveLyricsOnAnalysis(false);
    expect(loadLyricsOnAnalysis()).toBe(false);
  });
});

describe("graphics acceleration memory", () => {
  const KEY = "gp5.lyrics.graphics-empty.v1";

  it("remembers the model and app version, and recalls them", () => {
    localStorage.removeItem(KEY);
    expect(graphicsHeardNothing("small", "1.0.0")).toBe(false);
    rememberGraphicsHeardNothing("small", "1.0.0");
    expect(graphicsHeardNothing("small", "1.0.0")).toBe(true);
    expect(graphicsHeardNothing("base", "1.0.0")).toBe(false);
  });

  it("clears the record when the app version changes, so the next run tries graphics acceleration again", () => {
    rememberGraphicsHeardNothing("small", "1.0.0");
    expect(graphicsHeardNothing("small", "1.1.0")).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does not break when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(graphicsHeardNothing("small", "1.0.0")).toBe(false);
    expect(() => rememberGraphicsHeardNothing("small", "1.0.0")).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
