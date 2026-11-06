import { describe, expect, it } from "vitest";
import { alignLyrics, alignWords, normaliseWord, pastedLines, substitutionCost, type TimedWord } from "./lyrics-align";

/** Words spread evenly from `start`, one every 0.5 s, the way the transcriber reports them. */
function heard(text: string, start: number): TimedWord[] {
  return text.split(" ").map((word, i) => ({ text: ` ${word}`, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
}

describe("normaliseWord", () => {
  it("compares words without case, accents or punctuation", () => {
    expect(normaliseWord("Don't,")).toBe("dont");
    expect(normaliseWord("Señor!")).toBe("senor");
    expect(normaliseWord("♪")).toBe("");
  });
});

describe("pastedLines", () => {
  it("keeps one line per lyric line and collapses blank runs into one section break", () => {
    expect(pastedLines("\n\nHold on\r\nI'm coming\n\n\nVerse two\n\n")).toEqual(["Hold on", "I'm coming", "", "Verse two"]);
  });

  it("returns nothing for blank text", () => {
    expect(pastedLines("  \n \n")).toEqual([]);
  });
});

describe("substitutionCost", () => {
  it("is free for the same word and cheap for a near miss", () => {
    expect(substitutionCost("love", "love")).toBe(0);
    expect(substitutionCost("goin", "going")).toBeLessThan(0.5);
  });

  it("refuses to pair unlike words", () => {
    expect(substitutionCost("cat", "dog")).toBeGreaterThan(1);
  });
});

describe("alignWords", () => {
  it("matches each sung word to its heard word, in order", () => {
    expect(alignWords(["a", "b", "c"], ["x", "a", "b", "y", "c"])).toEqual([1, 2, 4]);
  });

  it("leaves a sung word null when nothing was heard for it", () => {
    expect(alignWords(["a", "missing", "c"], ["a", "c"])).toEqual([0, null, 1]);
  });
});

describe("alignLyrics", () => {
  it("times each line from its first heard word and keeps the user's spelling", () => {
    const words = heard("hello there good morning", 1);
    const out = alignLyrics(["Hello there", "Good morning!"], words, 10);
    expect(out).toEqual([
      { time: 1, text: "Hello there", estimated: false },
      { time: 2, text: "Good morning!", estimated: false },
    ]);
  });

  it("tolerates a missing word, an extra word and a misspelling", () => {
    const words = [...heard("oh hello friend", 1), ...heard("goin home", 4)];
    const out = alignLyrics(["hello friend", "going home"], words, 10);
    expect(out.map((line) => [line.time, line.estimated])).toEqual([
      [1.5, false],
      [4, false],
    ]);
  });

  it("keeps a repeated chorus in order, on the occurrence that fits its neighbours", () => {
    const words = [...heard("love me stay", 1), ...heard("love me", 20)];
    const out = alignLyrics(["love me", "stay", "love me"], words, 30);
    expect(out.map((line) => line.time)).toEqual([1, 2, 20]);
  });

  it("places a line with no heard words between its timed neighbours and flags it", () => {
    const words = [...heard("one two", 0), ...heard("three four", 10)];
    const out = alignLyrics(["one two", "nothing heard xyz", "three four"], words, 12);
    expect(out[1]).toEqual({ time: 5, text: "nothing heard xyz", estimated: true });
    expect(out[2]).toEqual({ time: 10, text: "three four", estimated: false });
  });

  it("spreads trailing unheard lines up to the end of the vocals", () => {
    const out = alignLyrics(["one two", "unheard"], heard("one two", 0), 10);
    expect(out[1].estimated).toBe(true);
    expect(out[1].time).toBeGreaterThan(out[0].time);
    expect(out[1].time).toBeLessThan(10);
  });

  it("writes a blank line as a section break at the next line's time, and drops trailing breaks", () => {
    const words = [...heard("a b", 1), ...heard("c d", 5)];
    const out = alignLyrics(["a b", "", "c d", ""], words, 10);
    expect(out).toEqual([
      { time: 1, text: "a b", estimated: false },
      { time: 5, text: "", estimated: false },
      { time: 5, text: "c d", estimated: false },
    ]);
  });

  it("starts a line from its earliest matched word when the first word was misheard", () => {
    const words = [{ text: " xylophone", start: 1, end: 1.4 }, ...heard("there good", 1.5)];
    const out = alignLyrics(["hello there good"], words, 10);
    expect(out[0].estimated).toBe(false);
    expect(out[0].time).toBeCloseTo(1.1);
  });

  it("times a line whose only match is its last word, stepping back over the words before it", () => {
    const out = alignLyrics(["one two three four"], heard("mumble mumble mumble four", 1), 10);
    expect(out[0].estimated).toBe(false);
    expect(out[0].time).toBeCloseTo(1.3);
  });

  it("does not trust a line start that falls before the previous line, and places that line between its neighbours", () => {
    const words = [
      { text: " a", start: 1, end: 1.4 },
      { text: " i", start: 2, end: 2.4 },
    ];
    const out = alignLyrics(["a", "e f g h i"], words, 10);
    expect(out[0]).toEqual({ time: 1, text: "a", estimated: false });
    expect(out[1].estimated).toBe(true);
    expect(out[1].time).toBeGreaterThan(1);
    expect(out[1].time).toBeLessThan(10);
  });

  it("keeps every line's time at or after the one before it across the song", () => {
    const words = [...heard("one two three", 2), ...heard("four five", 6), ...heard("six", 9)];
    const out = alignLyrics(["one two", "three four", "five six", "seven"], words, 12);
    for (let i = 1; i < out.length; i++) expect(out[i].time).toBeGreaterThanOrEqual(out[i - 1].time);
    expect(out[3].estimated).toBe(true);
  });

  it("times lines with no sung words at all evenly across the vocals", () => {
    const out = alignLyrics(["♪ ♪", "♪"], [], 8);
    expect(out.every((line) => line.estimated)).toBe(true);
    expect(out[0].time).toBeLessThan(out[1].time);
  });
});
