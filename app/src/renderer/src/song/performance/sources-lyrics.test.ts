import { describe, expect, it } from "vitest";
import { defaultChordSource } from "./sources";
import { cleanLines, lyricsLrc, songLines, transcriptWords } from "./lyrics";
import { parseChart } from "./chart";

const sound = { sampleRate: 44100, channels: [new Float32Array(1000).fill(0.1)] };
const silence = { sampleRate: 44100, channels: [new Float32Array(1000)] };
describe("chord source selection", () => {
  it("prefers guitar and falls back when absent or silent", () => {
    expect(defaultChordSource({ guitar: sound, piano: sound, other: sound })).toBe("guitar");
    expect(defaultChordSource({ guitar: silence, piano: sound, other: sound })).toBe("piano");
    expect(defaultChordSource({ other: sound, vocals: sound })).toBe("other");
    expect(defaultChordSource({ guitar: silence })).toBe("");
    expect(defaultChordSource(null)).toBe("");
  });
});
describe("lyrics track", () => {
  it("keeps a repeated line in later verses", () => {
    expect(cleanLines([0, 20, 40].map((time) => ({ time, text: "Sing again" }))).map((s) => s.time)).toEqual([0, 20, 40]);
  });
  it("drops words past the end of the vocals and keeps transcription from becoming MIDI commands", () => {
    const result = songLines(
      transcriptWords(
        [
          { text: "Second\nline", timestamp: [2, 3] },
          { text: "{midi:pc 1 5}", timestamp: [0, 1] },
          { text: "past end", timestamp: [10, 11] },
        ],
        10,
      ),
    );
    // The one-word line at a 1 s gap joins the line after it: the markers are neutralised, not sent.
    expect(result).toEqual([{ time: 0, text: "{midi :pc 1 5} Second line" }]);
    expect(parseChart(lyricsLrc(result)).every((c) => c.messages.length === 0)).toBe(true);
  });
  it("exports timestamps across minute boundaries without invalid seconds", () => {
    const output = lyricsLrc([{ time: 59.999, text: "Next minute" }]);
    expect(output).toBe("[01:00.00] Next minute");
    expect(parseChart(output)[0].time).toBe(60);
  });
});
