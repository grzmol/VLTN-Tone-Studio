import { describe, expect, it } from "vitest";
import {
  cleanLines,
  cleanText,
  isDangling,
  keepWordsWithin,
  LONGEST_LINE_WORDS,
  lyricsLrc,
  MAX_LINE_WORDS,
  songLines,
  stripMarkers,
  transcriptWords,
  windowWords,
} from "./lyrics";
import type { TimedWord } from "./lyrics-align";
import { ownedSpans, transcriptionWindows, type Region } from "./vocal-activity";

type Chunk = { text: string; timestamp: [number | null, number | null] };

describe("cleanText", () => {
  it("keeps generated text inert in the chart's MIDI-aware syntax", () => {
    expect(cleanText(" {midi:pc 1 0}\nhello ")).toBe("{midi :pc 1 0} hello");
  });
});

describe("transcriptWords", () => {
  it("keeps words inside the window, and drops blank words and words that start after it", () => {
    const words = transcriptWords(
      [
        { text: " hi", timestamp: [0.5, 0.9] },
        { text: " there", timestamp: [null, 1] },
        { text: " late", timestamp: [12, 12.5] },
        { text: " ", timestamp: [1, 1.2] },
      ],
      10,
    );
    expect(words).toEqual([
      { text: "hi", start: 0.5, end: 0.9 },
      { text: "there", start: 0.9, end: 1 },
    ]);
  });

  it("caps a word's end at the end of the vocals", () => {
    expect(transcriptWords([{ text: " end", timestamp: [9, 11] }], 10)).toEqual([{ text: "end", start: 9, end: 10 }]);
  });

  it("repairs a missing start from the word before and a missing end from the word after", () => {
    const words = transcriptWords(
      [
        { text: " a", timestamp: [0.2, null] },
        { text: " b", timestamp: [null, 0.9] },
        { text: " c", timestamp: [1, null] },
      ],
      10,
    );
    const rounded = words.map((word) => ({ text: word.text, start: Math.round(word.start * 100) / 100, end: Math.round(word.end * 100) / 100 }));
    expect(rounded).toEqual([
      { text: "a", start: 0.2, end: 0.6 },
      { text: "b", start: 0.6, end: 0.9 },
      { text: "c", start: 1, end: 1.4 },
    ]);
  });

  it("repairs a first word with no start from its end, so an opening word is not lost", () => {
    expect(
      transcriptWords(
        [
          { text: " Fire", timestamp: [null, 0.9] },
          { text: " burn", timestamp: [1, 1.4] },
        ],
        10,
      ),
    ).toEqual([
      { text: "Fire", start: 0.5, end: 0.9 },
      { text: "burn", start: 1, end: 1.4 },
    ]);
  });
});

describe("windowWords with a repaired start", () => {
  it("keeps a word whose repaired start falls before the overlap midpoint, when it really starts after it", () => {
    // Windows [0, 30] and [28, 58] share the midpoint 29. The second window's first word has no start: its end (29.35) is known.
    const spans = ownedSpans([
      { start: 0, end: 30 },
      { start: 28, end: 58 },
    ]);
    const heard = windowWords([{ text: " late", timestamp: [null, 1.35] }], 30, 28, spans[1]);
    expect(heard.map((word) => word.text)).toEqual(["late"]);
    expect(Math.abs(heard[0].start - 29.05)).toBeLessThan(0.2);
  });
});

describe("windowWords across overlapping windows", () => {
  // Words every 0.5 s from 13 s, each 0.3 s long: an opening verse of about 38 s.
  const song: TimedWord[] = Array.from({ length: 76 }, (_, i) => ({ text: `w${i}`, start: 13 + i * 0.5, end: 13.3 + i * 0.5 }));

  /** What the transcriber returns for one window: the words that start in it, relative to its start, with the first start missing. */
  function heardIn(window: Region): Chunk[] {
    const chunks: Chunk[] = song
      .filter((word) => word.start >= window.start && word.start < window.end)
      .map((word) => ({
        text: ` ${word.text}`,
        timestamp: [word.start - window.start, Math.min(word.end, window.end) - window.start],
      }));
    if (chunks.length) chunks[0].timestamp[0] = null;
    return chunks;
  }

  it("keeps every word once across the overlap, and the opening words at their times", () => {
    const windows = transcriptionWindows([{ start: 13, end: 51 }], 60);
    expect(windows).toHaveLength(2);
    const spans = ownedSpans(windows);
    const heard = windows.flatMap((window, i) => windowWords(heardIn(window), window.end - window.start, window.start, spans[i]));
    expect(heard.map((word) => word.text)).toEqual(song.map((word) => word.text));
    heard.forEach((word, i) => expect(Math.abs(word.start - song[i].start)).toBeLessThan(0.3));
    expect(heard[0].start).toBeGreaterThan(12.5);
  });
});

/** Words one after another, each 0.4 s long with a 0.1 s gap, from `start`. */
function run(text: string, start: number): TimedWord[] {
  return text.split(" ").map((word, i) => ({ text: word, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
}

describe("songLines", () => {
  it("starts a new line at a vocal gap and takes each line's first word as its time", () => {
    const words = [...run("hold still", 2), ...run("im coming", 6)];
    expect(lyricsLrc(songLines(words))).toBe("[00:02.00] hold still\n[00:06.00] im coming");
  });

  it("cuts a line at the maximum word count even without a gap", () => {
    const words = run(Array.from({ length: MAX_LINE_WORDS + 1 }, (_, i) => `w${i}`).join(" "), 0);
    const lines = songLines(words);
    expect(lines.map((line) => line.text.split(" ").length)).toEqual([MAX_LINE_WORDS, 1]);
  });

  it("starts a new line after a sentence end, even with no gap, and times each line from its own first word", () => {
    const words = [...run("Fire burn around me.", 0), ...run("Let it burn", 2)];
    expect(lyricsLrc(songLines(words))).toBe("[00:00.00] Fire burn around me.\n[00:02.00] Let it burn");
  });

  it("starts a new line after six words at a short gap, so phrases sung without pauses come apart", () => {
    const words = Array.from({ length: 9 }, (_, i) => ({ text: `w${i}`, start: i * 0.6, end: i * 0.6 + 0.3 }));
    expect(lyricsLrc(songLines(words))).toBe("[00:00.00] w0 w1 w2 w3 w4 w5\n[00:03.60] w6 w7 w8");
  });

  it("never gives two lines the same time, even when the transcriber starts a burst of words together", () => {
    const burst = Array.from({ length: 12 }, (_, i) => ({ text: `b${i}`, start: 5, end: 5.2 }));
    const lines = songLines(burst);
    expect(lines).toHaveLength(2);
    expect(lines[0].time).toBe(5);
    expect(lines[1].time).toBeGreaterThan(lines[0].time);
    expect(lines[1].text.split(" ")).toHaveLength(2);
  });
});

describe("cleanLines", () => {
  it("drops lines with no letters or digits and known hallucinations", () => {
    const lines = cleanLines([
      { time: 0, text: "♪" },
      { time: 1, text: "..." },
      { time: 2, text: "Thank you for watching." },
      { time: 3, text: "Subtitles by the Amara.org community" },
      { time: 4, text: "Real words" },
    ]);
    expect(lines).toEqual([{ time: 4, text: "Real words" }]);
  });

  it("drops a line that loops more than three times within ten seconds, and keeps it once the loop has passed", () => {
    const loop = [0, 1, 2, 3, 4].map((time) => ({ time, text: "na na na" }));
    expect(cleanLines(loop).map((line) => line.time)).toEqual([0, 1, 2]);
    expect(cleanLines([...loop.slice(0, 3), { time: 20, text: "na na na" }]).map((line) => line.time)).toEqual([0, 1, 2, 20]);
  });
});

describe("keepWordsWithin", () => {
  it("keeps words that start inside a region, with a little padding on each side", () => {
    const words = [
      { text: "a", start: 1, end: 1.1 },
      { text: "b", start: 5.2, end: 5.3 },
      { text: "c", start: 8, end: 8.1 },
    ];
    expect(keepWordsWithin(words, [{ start: 0.8, end: 5 }]).map((w) => w.text)).toEqual(["a", "b"]);
  });
});

/**
 * The CPU pass's first lines for "Burn", as the packaged build wrote them. Each line's words are spaced 0.4 s from the line's
 * time, since only the line times are known. "okay" follows "I'll be" at a short gap, as the phrase runs on.
 */
const BURN_LINES: [string, string][] = [
  ["00:12.80", "Wondering why so choking on darkness around your neck, baby"],
  ["00:18.68", "You'll never be perfect Your"],
  ["00:27.62", "are now filling up with smoke,"],
  ["00:30.90", "baby You should start living till I regret"],
  ["00:39.35", "When I see the sun less inside burning You cannot"],
  ["00:47.67", "ever give it up It may need sparks of anger"],
  ["00:54.89", "in your eyes shining You cannot always light it up"],
  ["01:05.30", "Fire burns around me, let it burn everyday I'll be"],
  ["01:13.10", "okay"],
  ["01:18.10", "♪ As much as I'm one out of there ♪"],
];

function burnWords(): TimedWord[] {
  const words: TimedWord[] = [];
  let previousEnd = 0;
  for (const [time, text] of BURN_LINES) {
    const [minutes, seconds] = time.split(":");
    let at = Number(minutes) * 60 + Number(seconds);
    if (text === "okay") at = previousEnd + 0.5;
    text.split(" ").forEach((word, k) => {
      const start = at + k * 0.4;
      words.push({ text: word, start, end: start + 0.3 });
      previousEnd = start + 0.3;
    });
  }
  return words;
}

describe("songLines on the Burn lines", () => {
  const lines = songLines(burnWords());

  it("ends no line on a dangling word, and no line carries a music marker", () => {
    for (const line of lines) expect(isDangling(line.text.split(" ").pop()!)).toBe(false);
    expect(lines.some((line) => line.text.includes("♪"))).toBe(false);
  });

  it("joins 'okay' to the line before it, and keeps every line within the longest", () => {
    const okay = lines.find((line) => line.text.endsWith("okay"))!;
    expect(okay.text).toBe("Fire burns around me, let it burn everyday I'll be okay");
    expect(lines.every((line) => line.text.split(" ").length <= LONGEST_LINE_WORDS)).toBe(true);
  });

  it("produces these lines from the packaged build's CPU pass", () => {
    expect(lyricsLrc(lines)).toBe(
      [
        "[00:12.80] Wondering why so choking on darkness around your neck, baby",
        "[00:18.68] You'll never be perfect Your are now filling up with smoke,",
        "[00:30.90] baby You should start living till I regret",
        "[00:39.35] When I see the sun less inside burning You cannot ever",
        "[00:48.07] give it up It may need sparks of anger",
        "[00:54.89] in your eyes shining You cannot always light it up",
        "[01:05.30] Fire burns around me, let it burn everyday I'll be okay",
        "[01:18.50] As much as I'm one out of there",
      ].join("\n"),
    );
  });
});

describe("stripMarkers", () => {
  it("removes note symbols and music markers, and keeps the sung words", () => {
    expect(stripMarkers("♪ As much as ♪")).toBe("As much as");
    expect(stripMarkers("[Music]")).toBe("");
    expect(stripMarkers("(instrumental)")).toBe("");
    expect(stripMarkers("♫")).toBe("");
    expect(stripMarkers("[Applause] yeah")).toBe("yeah");
  });

  it("keeps a sung parenthesis as words, and drops a parenthesis that is an annotation", () => {
    expect(stripMarkers("(let it burn)")).toBe("let it burn");
    expect(stripMarkers("(Oh, oh)")).toBe("Oh, oh");
    expect(stripMarkers("(instrumental)")).toBe("");
    expect(stripMarkers("(singing in French)")).toBe("");
    expect(stripMarkers("(laughs)")).toBe("");
    expect(stripMarkers("(♪)")).toBe("");
    expect(stripMarkers("(2x)")).toBe("2x");
  });

  it("drops a bracketed annotation of any words, across words, without shifting the next line", () => {
    const lines = songLines([
      { text: "hold", start: 1, end: 1.3 },
      { text: "still", start: 1.4, end: 1.7 },
      { text: "[singing", start: 3, end: 3.3 },
      { text: "in", start: 3.4, end: 3.5 },
      { text: "French]", start: 3.6, end: 3.9 },
      { text: "im", start: 5, end: 5.3 },
      { text: "coming", start: 5.4, end: 5.7 },
    ]);
    expect(lyricsLrc(lines)).toBe("[00:01.00] hold still\n[00:05.00] im coming");
  });

  it("keeps a sung parenthesis that spans words, and drops one that is an annotation across words", () => {
    expect(
      songLines([
        { text: "(let", start: 1, end: 1.3 },
        { text: "it", start: 1.4, end: 1.5 },
        { text: "burn)", start: 1.6, end: 1.9 },
      ]).map((line) => line.text),
    ).toEqual(["let it burn"]);
    expect(
      songLines([
        { text: "(singing", start: 1, end: 1.3 },
        { text: "in", start: 1.4, end: 1.5 },
        { text: "French)", start: 1.6, end: 1.9 },
        { text: "hi", start: 5, end: 5.3 },
      ]),
    ).toEqual([{ time: 5, text: "hi" }]);
  });

  it("drops a line that is only markers", () => {
    expect(
      songLines([
        { text: "[Music]", start: 0, end: 1 },
        { text: "♪", start: 1.1, end: 1.2 },
        { text: "hi", start: 5, end: 5.3 },
      ]),
    ).toEqual([{ time: 5, text: "hi" }]);
  });
});
