import { describe, expect, it } from "vitest";
import { audioBytes, memoryLines, songFootprint } from "./memory-estimate";

describe("audioBytes", () => {
  it("is 4 bytes per sample per channel: a minute of stereo at 44.1 kHz is about 21 MB", () => {
    expect(audioBytes([{ channels: 2, frames: 44100 * 60 }])).toBe(2 * 44100 * 60 * 4);
    expect(audioBytes([])).toBe(0);
  });
});

describe("songFootprint", () => {
  const t = (frames: number, key?: object) => ({ channels: 2, frames, key });
  it("sums each holder", () => {
    const f = songFootprint({ store: [t(10)], player: [t(10), t(10)], prepared: [t(5)], renders: [t(1)] });
    expect(f).toEqual({ store: 80, player: 160, prepared: 40, renders: 8, total: 288 });
  });
  it("counts a buffer shared between holders once", () => {
    const shared = {};
    const f = songFootprint({ store: [t(10, shared)], player: [t(10, shared)], prepared: [], renders: [] });
    expect(f.total).toBe(80);
    expect(f.player).toBe(0);
  });
});

describe("memoryLines", () => {
  const footprint = songFootprint({ store: [{ channels: 2, frames: 44100 * 60 * 5 }], player: [], prepared: [], renders: [] });
  it("reads as one sentence with no warning when there is room", () => {
    const { text, warning } = memoryLines({ workingSetKb: 2 * 1048576, peakWorkingSetKb: 2.5 * 1048576, totalKb: 16 * 1048576, freeKb: 8 * 1048576 }, footprint);
    expect(text).toBe("Memory: app 2.0 GB (peak 2.5 GB), this song's audio 0.1 GB, free on this Mac 8.0 GB");
    expect(warning).toBe("");
  });
  it("warns when free memory is under 1.5 GB or the app is over 3.5 GB", () => {
    expect(memoryLines({ workingSetKb: 1048576, peakWorkingSetKb: 1048576, totalKb: 8 * 1048576, freeKb: 1048576 }, footprint).warning).toContain("Free memory is low");
    expect(memoryLines({ workingSetKb: 4 * 1048576, peakWorkingSetKb: 4 * 1048576, totalKb: 16 * 1048576, freeKb: 8 * 1048576 }, footprint).warning).toContain("a lot of memory");
  });
  it("still shows the song's audio when the host cannot measure", () => {
    expect(memoryLines(null, footprint)).toEqual({ text: "Memory: this song's audio 0.1 GB", warning: "" });
  });
});
