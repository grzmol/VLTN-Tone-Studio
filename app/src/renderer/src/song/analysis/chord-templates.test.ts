import { describe, expect, it } from "vitest";
import { chromaFrames } from "./chroma";
import { BASS_WEIGHT, CHORD_STATES, CHORD_TYPES, N_STATE, chordAt, chordNameOf, chordScores } from "./chord-templates";

const RATE = 44100;

/**
 * Notes (MIDI numbers) sounding together, each with four harmonics at falling levels. `gains[i]` scales note i (default 1). Synthetic only.
 */
function sound(notes: number[], gains: number[] = [], seconds = 2): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  const levels = [1, 0.5, 0.33, 0.25];
  for (let i = 0; i < out.length; i++)
    notes.forEach((note, n) => {
      const hz = 440 * 2 ** ((note - 69) / 12);
      levels.forEach((level, k) => (out[i] += (0.1 * (gains[n] ?? 1) * level * Math.sin((2 * Math.PI * hz * (k + 1) * i) / RATE)) / notes.length));
    });
  return out;
}

/**
 * The chord name a synthetic chord is read as, from a span in the middle of it, with the bass audio when given. `gains` scales each note.
 */
function nameOf(notes: number[], bass?: number[], gains?: number[]): string {
  const harmony = { sampleRate: RATE, channels: [sound(notes, gains)] };
  const bassAudio = bass ? { sampleRate: RATE, channels: [sound(bass)] } : null;
  const { treble, bass: bassChroma } = chromaFrames(harmony, [{ start: 0.2, end: 1.5 }], bassAudio);
  return chordAt(treble[0], bassChroma ? bassChroma[0] : null).name;
}

describe("chord templates", () => {
  it("has every root with every chord type, then N", () => {
    expect(CHORD_STATES).toHaveLength(12 * CHORD_TYPES.length + 1);
    expect(N_STATE).toBe(CHORD_STATES.length - 1);
  });

  it("names synthetic chords with harmonics, across the chord types", () => {
    const cases: [number[], string, number[]?][] = [
      [[60, 64, 67], "C"],
      [[60, 63, 67], "Cm"],
      [[60, 64, 67, 70], "C7"],
      [[60, 64, 67, 71], "Cmaj7"],
      [[60, 63, 67, 70], "Cm7"],
      [[60, 62, 67], "Csus2"],
      // Csus4 and F5 share two notes, so the fourth's fifth is played louder to tell them apart.
      [[60, 65, 67], "Csus4", [1, 1, 2]],
      [[60, 63, 66], "Cdim"],
      [[60, 64, 68], "Caug"],
      [[69, 76], "A5"],
    ];
    for (const [notes, name, gains] of cases) expect(nameOf(notes, undefined, gains)).toBe(name);
  });

  it("reads a seventh that is barely sounding as the triad", () => {
    expect(nameOf([60, 64, 67, 70], undefined, [1, 1, 1, 0.15])).toBe("C");
  });

  it("does not call a power chord major or minor", () => {
    expect(nameOf([57, 64])).toBe("A5");
    expect(nameOf([57, 64])).not.toBe("A");
    expect(nameOf([57, 64])).not.toBe("Am");
  });

  it("names a C chord with G in the bass C/G", () => {
    expect(nameOf([60, 64, 67], [43])).toBe("C/G");
  });

  it("does not give a slash name for a bass note that is not in the chord", () => {
    // F under a C major chord is not a tone of C major, so the chord keeps its plain name.
    expect(nameOf([60, 64, 67], [41])).toBe("C");
  });

  it("reads silence as N", () => {
    expect(chordAt(new Float64Array(12), null).name).toBe("N");
  });

  it("raises a root's score when the bass plays the root", () => {
    const { treble } = chromaFrames({ sampleRate: RATE, channels: [sound([60, 64, 67])] }, [{ start: 0.2, end: 1.5 }]);
    const bassOnC = new Float32Array(12);
    bassOnC[0] = 1;
    const cIndex = CHORD_STATES.findIndex((state) => state.root === 0 && CHORD_TYPES[state.type]?.suffix === "");
    const without = chordScores(treble[0], null)[cIndex];
    const withBass = chordScores(treble[0], bassOnC)[cIndex];
    expect(withBass - without).toBeCloseTo(BASS_WEIGHT, 6);
  });

  it("gives a slash name only when the bass is clearly a chord tone other than the root", () => {
    const cMajor = CHORD_STATES.findIndex((state) => state.root === 0 && CHORD_TYPES[state.type]?.suffix === "");
    const underG = new Float64Array(12);
    underG[7] = 1;
    expect(chordNameOf(CHORD_STATES[cMajor], underG)).toBe("C/G");
    const faint = new Float64Array(12).fill(1 / 12);
    expect(chordNameOf(CHORD_STATES[cMajor], faint)).toBe("C");
  });
});
