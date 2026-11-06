import { describe, expect, it } from "vitest";
import { runStatusLine, runSummaryLine } from "./run-status";

describe("runStatusLine", () => {
  it("names the song, the step and its place in the run", () => {
    expect(runStatusLine({ title: "Song title", step: "chords", stepIndex: 2, steps: 8, waiting: false })).toBe("Analysing Song title: chords (3 of 8)");
  });

  it("says the run waits for playback to stop", () => {
    expect(runStatusLine({ title: "Song title", step: null, stepIndex: 0, steps: 0, waiting: true })).toBe("Analysing Song title: waiting for playback to stop");
  });

  it("reads a song with no name, and a run that has not begun a step", () => {
    expect(runStatusLine({ title: null, step: null, stepIndex: 0, steps: 0, waiting: false })).toBe("Analysing the song");
  });
});

describe("runSummaryLine", () => {
  it("gives the message after the song's name", () => {
    expect(runSummaryLine("Song title", "Tempo 98 BPM")).toBe("Song title analysed: Tempo 98 BPM");
    expect(runSummaryLine(null, null)).toBe("The song analysed");
  });
});
