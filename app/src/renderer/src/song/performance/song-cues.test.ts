import { describe, expect, it } from "vitest";
import { songCues } from "./song-cues";
import { encodeMidiFile } from "./smf";

/** A format 0 file with one note-on at tick 96 (half a second at 120 BPM) and one program change at tick 192. */
const file = encodeMidiFile("lead.mid", new Uint8Array([
  77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 11, 96, 0x90, 60, 90, 96, 0xc0, 4, 0, 0xff, 0x2f, 0,
]));
const macros = [{ code: "GP_LEAD", label: "Lead", commands: ["pc 16 12"] }];

describe("songCues", () => {
  it("returns the chart cues when there is no MIDI file", () => {
    const result = songCues("[00:01] {midi:pc 1 2}", macros, null);
    expect(result.error).toBe("");
    expect(result.cues.map((c) => c.time)).toEqual([1]);
  });
  it("merges the MIDI file's messages with the chart by time", () => {
    const result = songCues("[00:00.25] {midi:pc 1 2}\n[00:02] {midi:$GP_LEAD}", macros, file);
    expect(result.error).toBe("");
    expect(result.cues.map((c) => [c.time, c.fromFile ? "file" : "chart"])).toEqual([
      [0.25, "chart"],
      [0.5, "file"],
      [1, "file"],
      [2, "chart"],
    ]);
  });
  it("reports a malformed macro in the chart, and blocks the cues", () => {
    const result = songCues("[00:01] {midi:$NOPE}", macros, null);
    expect(result).toEqual({ cues: [], error: expect.stringMatching(/Unknown macro \$NOPE/), part: "chart" });
  });
  it("reports a MIDI file that cannot be read, named by the file", () => {
    const bad = { name: "broken.mid", data: btoa("not a midi file") };
    const result = songCues("[00:01] {midi:pc 1 2}", macros, bad);
    expect(result.cues).toEqual([]);
    expect(result.part).toBe("midi-file");
    expect(result.error).toMatch(/^broken\.mid: This is not a standard MIDI file/);
  });
});
