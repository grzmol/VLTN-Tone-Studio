import { describe, expect, it } from "vitest";
import { lyricsRunSkip } from "./lyrics-run";

const made = { chartSource: "transcribed" };

describe("lyricsRunSkip", () => {
  it("fills an empty chart", () => {
    expect(lyricsRunSkip("", {}, false)).toBeNull();
    expect(lyricsRunSkip("  ", {}, true)).toBeNull();
  });

  it("replaces a chart the run made for different audio, and keeps one it made for the same audio", () => {
    expect(lyricsRunSkip("old words", made, true)).toBeNull();
    expect(lyricsRunSkip("old words", made, false)).toBe("made");
  });

  it("never replaces the performer's chart, a timed paste, or a chart from before 0.9.2", () => {
    expect(lyricsRunSkip("mine", { chartSource: "user" }, true)).toBe("user");
    expect(lyricsRunSkip("pasted", { chartSource: "aligned" }, true)).toBe("pasted");
    expect(lyricsRunSkip("older", {}, true)).toBe("unknown");
  });
});
