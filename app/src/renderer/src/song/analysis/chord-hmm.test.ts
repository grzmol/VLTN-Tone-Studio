import { describe, expect, it } from "vitest";
import { CHORD_STATES, CHORD_TYPES, N_STATE } from "./chord-templates";
import { decodeChords, diatonicStates, parseKey } from "./chord-hmm";

/** The state of a root and suffix, such as (0, "") for C major. */
const stateOf = (root: number, suffix: string) => CHORD_STATES.findIndex((s) => s.root === root && s.type >= 0 && CHORD_TYPES[s.type].suffix === suffix);
const C = stateOf(0, ""),
  G = stateOf(7, ""),
  Am = stateOf(9, "m"),
  F = stateOf(5, ""),
  Fsharp = stateOf(6, "");

/** One span's scores: every state at a low base, then the given states set to their scores. */
function span(entries: [number, number][]): Float64Array {
  const scores = new Float64Array(CHORD_STATES.length).fill(0.2);
  for (const [state, score] of entries) scores[state] = score;
  return scores;
}

describe("chord HMM", () => {
  it("keeps a chord through a single noisy span", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => span(i === 3 ? [[Am, 0.92], [C, 0.9]] : [[C, 0.9]]));
    const { path } = decodeChords(frames, diatonicStates(null));
    expect(path.every((state) => state === C)).toBe(true);
  });

  it("keeps a real change of chord where the music changes", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => span(i < 4 ? [[C, 0.9]] : [[G, 0.9]]));
    const { path } = decodeChords(frames, diatonicStates(null));
    expect(path.slice(0, 4).every((state) => state === C)).toBe(true);
    expect(path.slice(4).every((state) => state === G)).toBe(true);
  });

  it("breaks a near tie toward the chord that belongs to the key", () => {
    // F and F# score almost the same; in C major only F belongs, so the change into the middle section is taken as F.
    const middle = span([
      [F, 0.6],
      [Fsharp, 0.61],
    ]);
    const frames = [span([[C, 0.9]]), span([[C, 0.9]]), span([[C, 0.9]]), middle, middle, middle, span([[C, 0.9]]), span([[C, 0.9]])];
    const { path } = decodeChords(frames, diatonicStates("C major"));
    expect(path.slice(3, 6)).toEqual([F, F, F]);
    const withoutKey = decodeChords(frames, diatonicStates(null)).path;
    expect(withoutKey.slice(3, 6)).toEqual([Fsharp, Fsharp, Fsharp]);
  });

  it("reads silence as N throughout", () => {
    const silent = [0, 1, 2].map(() => span([[N_STATE, 1]]));
    expect(decodeChords(silent, diatonicStates(null)).path).toEqual([N_STATE, N_STATE, N_STATE]);
  });

  it("gives a posterior between zero and one for every span, and no path for no spans", () => {
    const { path, posterior } = decodeChords([span([[C, 0.9]]), span([[C, 0.8]])], diatonicStates(null));
    expect(path).toEqual([C, C]);
    for (const p of posterior) {
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(decodeChords([], diatonicStates(null))).toEqual({ path: [], posterior: [] });
  });

  it("marks the triads and plain sevenths of the key's scale as diatonic", () => {
    const diatonic = diatonicStates("C major");
    expect(diatonic[C]).toBe(true);
    expect(diatonic[G]).toBe(true);
    expect(diatonic[Am]).toBe(true);
    expect(diatonic[Fsharp]).toBe(false);
    expect(diatonic[N_STATE]).toBe(false);
    expect(diatonicStates(null).every((d) => !d)).toBe(true);
  });

  it("reads a key name, and gives nothing for an unknown one", () => {
    expect(parseKey("A minor")).toEqual({ tonic: 9, mode: "minor" });
    expect(parseKey("Eb major")).toEqual({ tonic: 3, mode: "major" });
    expect(parseKey("H minor")).toBeNull();
    expect(parseKey(null)).toBeNull();
  });
});
