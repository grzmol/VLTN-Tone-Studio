import { describe, expect, it } from "vitest";
import { detectKey, detectKeyFrom, effectiveSongKey, keyAudio, keyFromChroma, keyOfSong, KEY_NAMES, readKey, type KeyEstimate } from "./key";
import { evidenceIn, keyFramesOf, type KeyEvidence } from "../analysis/key-evidence";
import type { PcmAudio } from "../types";
const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
it.each(KEY_NAMES.map((name, i) => [name, i] as const))("matches both tonal profiles rooted on %s", (name, root) => {
  for (const [mode, profile] of [
    ["major", major],
    ["minor", minor],
  ] as const) {
    const chroma = Array.from({ length: 12 }, (_, i) => profile[(i - root + 12) % 12]);
    expect(keyFromChroma(chroma)?.name).toBe(`${name} ${mode}`);
  }
});
const signal: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(44100).fill(0.1)] };
const silent: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(44100)] };
it("prefers usable guitar then harmonic stems and finally the original mix", () => {
  expect(keyAudio({ guitar: signal, piano: signal }, signal)?.name).toBe("guitar");
  expect(keyAudio({ guitar: silent, piano: signal }, signal)?.name).toBe("piano");
  expect(keyAudio({ other: signal, bass: signal }, signal)?.name).toBe("other");
  expect(keyAudio({ bass: signal, vocals: signal }, signal)?.name).toBe("bass");
  expect(keyAudio({ drums: signal }, signal)?.name).toBe("original mix");
  expect(keyAudio(null, signal)?.name).toBe("original mix");
  expect(keyAudio({ guitar: silent }, silent)).toBeNull();
});
it("does not assign a key to silence, flat chroma, a single pitch or invalid data", () => {
  expect(detectKey(silent)).toBeNull();
  expect(keyFromChroma(new Float64Array(12).fill(1))).toBeNull();
  expect(keyFromChroma([1, ...Array(11).fill(0)])).toBeNull();
  expect(keyFromChroma([NaN, ...Array(11).fill(1)])).toBeNull();
});
function progression(chords: number[][], tuning = 440): PcmAudio {
  const sampleRate = 22050,
    seconds = 2;
  const pcm = Float32Array.from({ length: chords.length * sampleRate * seconds }, (_, i) => {
    const notes = chords[Math.floor(i / (sampleRate * seconds))];
    return notes.reduce((sum, midi) => sum + 0.12 * Math.sin((2 * Math.PI * tuning * 2 ** ((midi - 69) / 12) * i) / sampleRate), 0);
  });
  return { sampleRate, channels: [pcm, pcm.map((n) => -n)] };
}
it("estimates major and minor progressions from audio without stereo cancellation", () => {
  expect(
    detectKey(
      progression([
        [60, 64, 67],
        [65, 69, 72],
        [67, 71, 74],
        [60, 64, 67],
      ]),
    )?.name,
  ).toBe("C major");
  expect(
    detectKey(
      progression([
        [57, 60, 64],
        [62, 65, 69],
        [64, 68, 71],
        [57, 60, 64],
      ]),
    )?.name,
  ).toBe("A minor");
});

it("does not report a key for broadband noise", () => {
  let state = 12345;
  const channel = Float32Array.from({ length: 44100 * 3 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 2 ** 32 - 0.5) * 0.1;
  });
  expect(detectKey({ sampleRate: 44100, channels: [channel] })).toBeNull();
});

describe("effectiveSongKey", () => {
  const strong: KeyEstimate = { name: "A minor", tonic: 9, mode: "minor", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] };
  const tentative: KeyEstimate = { ...strong, name: "D major", confidence: "tentative" };
  it("uses the override over the library key and a strong estimate", () => {
    expect(effectiveSongKey("Bb major", "E major", strong)).toBe("Bb major");
  });
  it("uses the library key when there is no override", () => {
    expect(effectiveSongKey("", "Bb", strong)).toBe("Bb");
  });
  it("uses a strong automatic estimate only when nothing is saved", () => {
    expect(effectiveSongKey("", undefined, strong)).toBe("A minor");
    expect(effectiveSongKey("", undefined, tentative)).toBeUndefined();
  });
  it("is undefined when no key is known, so the chords keep their spelling", () => {
    expect(effectiveSongKey("", undefined, null)).toBeUndefined();
    expect(effectiveSongKey("", "", null)).toBeUndefined();
  });
});

/** Evidence with a fixed chroma, and optionally a bass and anchored chords. */
function evidence(chroma: number[], options: Partial<Omit<KeyEvidence, "chroma">> = {}): KeyEvidence {
  return { chroma: Float64Array.from(chroma), bass: null, chordTones: null, runs: [], ...options };
}
const diatonicC = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
const pitchClass = (pc: number) => Array.from({ length: 12 }, (_, i) => (i === pc ? 1 : 0));

it("reads a clear major or minor chroma from the evidence", () => {
  expect(detectKeyFrom(evidence(major.map((_, i) => major[(i - 0 + 12) % 12])))?.name).toBe("C major");
  expect(detectKeyFrom(evidence(Array.from({ length: 12 }, (_, i) => minor[(i - 9 + 12) % 12])))?.name).toBe("A minor");
});

it("uses the bass on the tonic to choose between keys that share their notes", () => {
  // C major and A minor have the same notes, so the chroma alone cannot choose; the bass note A is the tonic of A minor.
  const without = detectKeyFrom(evidence(diatonicC));
  const withBass = detectKeyFrom(evidence(diatonicC, { bass: Float64Array.from(pitchClass(9)) }));
  expect(withBass?.name).toBe("A minor");
  expect(without).not.toBeNull();
});

it("breaks a tie between relatives by the tonic chord at the anchors", () => {
  // A chroma between G major and E minor (44% of the G profile), so the two are within the relative margin.
  const rotate = (profile: number[], tonic: number) => Array.from({ length: 12 }, (_, i) => profile[(i - tonic + 12) % 12]);
  const tie = rotate(major, 7).map((v, i) => 0.44 * v + 0.56 * rotate(minor, 4)[i]);
  const runs = [
    { root: 4, quality: "minor" as const, tones: [0, 3, 7], seconds: 2, anchor: true },
    { root: 7, quality: "major" as const, tones: [0, 4, 7], seconds: 2, anchor: false },
    { root: 4, quality: "minor" as const, tones: [0, 3, 7], seconds: 2, anchor: true },
  ];
  // With no chords to decide it, the profiles keep G major on top.
  expect(detectKeyFrom(evidence(tie))?.name).toBe("G major");
  // The first and last chords are E minor, so E minor wins.
  expect(detectKeyFrom(evidence(tie, { runs }))?.name).toBe("E minor");
});

it("lists the relative key among the alternatives when it is near", () => {
  // The C major scale is as much A minor, so the relative key is near the top and is listed.
  const estimate = detectKeyFrom(evidence(diatonicC));
  expect(estimate?.name).toBe("C major");
  expect(estimate?.alternatives).toContain("A minor");
});

/** Chords of two seconds each, as the chord detector names them, over the progression's audio. */
function namedAudio(names: string[], notes: number[][]) {
  return { audio: progression(notes), chords: names.map((name, i) => ({ time: i * 2, name, confidence: 1 })), duration: names.length * 2 };
}

it("finds G major from a I-V-vi-IV loop in G on audio", () => {
  const song = namedAudio(
    ["G", "D", "Em", "C"],
    [
      [55, 59, 62, 67],
      [62, 66, 69],
      [64, 67, 71],
      [60, 64, 67],
    ],
  );
  const frames = keyFramesOf(song.audio, null, song.chords, []);
  expect(detectKeyFrom(evidenceIn(frames, 0, song.duration))?.name).toBe("G major");
});

it("reads G major with a Mixolydian flavour from G, F, C, G", () => {
  const song = namedAudio(
    ["G", "F", "C", "G"],
    [
      [55, 59, 62],
      [53, 57, 60],
      [48, 52, 55, 60],
      [55, 59, 62],
    ],
  );
  const estimate = detectKeyFrom(evidenceIn(keyFramesOf(song.audio, null, song.chords, []), 0, song.duration));
  expect(estimate?.name).toBe("G major");
  expect(estimate?.flavour).toBe("mixolydian");
});

it("does not add a flavour to a plain major progression", () => {
  const song = namedAudio(
    ["G", "D", "Em", "C"],
    [
      [55, 59, 62, 67],
      [62, 66, 69],
      [64, 67, 71],
      [60, 64, 67],
    ],
  );
  expect(detectKeyFrom(evidenceIn(keyFramesOf(song.audio, null, song.chords, []), 0, song.duration))?.flavour).toBeUndefined();
});

it("reads A minor with a Dorian flavour from Am, D, Am, D", () => {
  const song = namedAudio(
    ["Am", "D", "Am", "D"],
    [
      [57, 60, 64],
      [62, 66, 69],
      [57, 60, 64],
      [62, 66, 69],
    ],
  );
  const estimate = detectKeyFrom(evidenceIn(keyFramesOf(song.audio, null, song.chords, []), 0, song.duration));
  expect(estimate?.name).toBe("A minor");
  expect(estimate?.flavour).toBe("dorian");
});

it("reads the key of a song tuned to A=432", () => {
  const loop = [
    [55, 59, 62, 67],
    [62, 66, 69],
    [64, 67, 71],
    [60, 64, 67],
  ];
  const song = namedAudio(["G", "D", "Em", "C"], loop);
  const tuned = { ...song.audio, channels: [progression(loop, 432).channels[0]] };
  expect(keyOfSong({ harmony: tuned, bass: null, chords: song.chords, sections: [] })?.name).toBe("G major");
});

it("tells E minor from its relative G major by the first and last chords, on audio", () => {
  const song = namedAudio(
    ["Em", "C", "G", "D", "Em"],
    [
      [64, 67, 71],
      [60, 64, 67],
      [55, 59, 62, 67],
      [62, 66, 69],
      [64, 67, 71],
    ],
  );
  expect(keyOfSong({ harmony: song.audio, bass: null, chords: song.chords, sections: [] })?.name).toBe("E minor");
});

it("reports only the section in another key, a whole tone up, when the song's key is given", () => {
  // A verse in G (eight seconds), then a last section in A (I, IV, vi, V).
  const verse = [
    [55, 59, 62, 67],
    [62, 66, 69],
    [64, 67, 71],
    [60, 64, 67],
  ];
  const last = [
    [57, 61, 64],
    [62, 66, 69],
    [54, 57, 61],
    [52, 56, 59],
  ];
  const song = namedAudio(["G", "D", "Em", "C", "A", "D", "F#m", "E"], [...verse, ...last]);
  const sections = [
    { start: 0, end: 8 },
    { start: 8, end: 16 },
  ];
  const reading = readKey({ harmony: song.audio, bass: null, chords: song.chords, sections, songKey: "G major" });
  expect(reading.keySections.map((entry) => [entry.sectionId, entry.key.name])).toEqual([["1", "A major"]]);
  // With no song key to compare with, no section is reported.
  expect(readKey({ harmony: song.audio, bass: null, chords: song.chords, sections }).keySections).toEqual([]);
});
