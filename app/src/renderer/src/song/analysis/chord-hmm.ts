// Smooths the chord estimates over a song with a hidden Markov model, decoded by Viterbi. Each span's template scores are the emissions;
// a chord stays with high probability from one span to the next, and a change is more likely into a chord that belongs to the song's key.
// So a single noisy span does not flip the chord, while a real change on a beat is kept. Pure, so the worker and the tests share it.

import { CHORD_STATES, CHORD_TYPES, type ChordState } from "./chord-templates";

/** The chance a chord carries on into the next span. Spans are beats, so a chord that lasts about four beats stays about 0.75 of the time. */
export const STAY_PROBABILITY = 0.8;
/** A change into a diatonic chord is this many times as likely as a change into any other. */
export const KEY_TRANSITION_WEIGHT = 2;
/** Scores are divided by this before they become probabilities. Smaller values make the estimate firmer. */
export const EMISSION_TEMPERATURE = 0.05;

const NATURAL = new Map<string, number>([
  ["C", 0],
  ["D", 2],
  ["E", 4],
  ["F", 5],
  ["G", 7],
  ["A", 9],
  ["B", 11],
]);
/** The scale degrees of a major or a natural minor key, from its tonic. */
const SCALES: Record<"major" | "minor", readonly number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
/** The chord types that belong to a key: the triads of its scale, and the sevenths that are plain. */
const DIATONIC_SUFFIXES = new Set(["", "m", "dim", "7", "maj7", "m7"]);

/** The tonic and mode of a key name such as "A minor" or "Eb major", or null for anything else. */
export function parseKey(name: string | null | undefined): { tonic: number; mode: "major" | "minor" } | null {
  const match = /^([A-G])(#|b)? (major|minor)$/.exec(name ?? "");
  if (!match) return null;
  const tonic = (((NATURAL.get(match[1]) ?? 0) + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0)) % 12 + 12) % 12;
  return { tonic, mode: match[3] as "major" | "minor" };
}

/** Whether each chord state belongs to the key: its root is on the key's scale, and its type is a plain triad or seventh. None when the key is unknown. */
export function diatonicStates(key: string | null | undefined, states: readonly ChordState[] = CHORD_STATES): boolean[] {
  const parsed = parseKey(key);
  return states.map((state) => {
    if (!parsed || state.type < 0) return false;
    const degree = (state.root - parsed.tonic + 12) % 12;
    return SCALES[parsed.mode].includes(degree) && DIATONIC_SUFFIXES.has(CHORD_TYPES[state.type].suffix);
  });
}

/**
 * The most likely chord state for every span, given each span's template scores. `scores[t][s]` is the score of state `s` at span `t`.
 * `diatonic[s]` says whether a state belongs to the key. Returns the state of each span, and how sure the emissions were of that state.
 */
export function decodeChords(scores: readonly Float64Array[], diatonic: readonly boolean[]): { path: number[]; posterior: number[] } {
  const frames = scores.length;
  const states = CHORD_STATES.length;
  if (!frames) return { path: [], posterior: [] };
  // Emission log-probabilities: each span's scores, softmaxed at the temperature.
  const logEmission = scores.map((row) => {
    const scaled = Array.from(row, (v) => v / EMISSION_TEMPERATURE);
    const top = Math.max(...scaled);
    const normaliser = top + Math.log(scaled.reduce((sum, v) => sum + Math.exp(v - top), 0));
    return scaled.map((v) => v - normaliser);
  });
  // A change into state s is spread over the states, with the diatonic ones weighted up.
  const weight = diatonic.map((d) => (d ? KEY_TRANSITION_WEIGHT : 1));
  const totalWeight = weight.reduce((a, b) => a + b, 0);
  const logChange = weight.map((w) => Math.log(((1 - STAY_PROBABILITY) * w) / totalWeight));
  const logStay = Math.log(STAY_PROBABILITY);

  let delta = Float64Array.from(logEmission[0]);
  const back: Int32Array[] = [];
  for (let t = 1; t < frames; t++) {
    // The best and second-best previous states, so a change from the best state can use the runner-up when it is the same state.
    let first = 0,
      second = -1;
    for (let s = 1; s < states; s++) {
      if (delta[s] > delta[first]) {
        second = first;
        first = s;
      } else if (second < 0 || delta[s] > delta[second]) second = s;
    }
    const next = new Float64Array(states),
      pointers = new Int32Array(states);
    for (let s = 0; s < states; s++) {
      const stay = delta[s] + logStay;
      const fromOther = first !== s ? first : second;
      const change = delta[fromOther] + logChange[s];
      if (stay >= change) {
        next[s] = stay + logEmission[t][s];
        pointers[s] = s;
      } else {
        next[s] = change + logEmission[t][s];
        pointers[s] = fromOther;
      }
    }
    delta = next;
    back.push(pointers);
  }
  const path = new Array<number>(frames);
  let state = 0;
  for (let s = 1; s < states; s++) if (delta[s] > delta[state]) state = s;
  path[frames - 1] = state;
  for (let t = frames - 1; t > 0; t--) {
    state = back[t - 1][state];
    path[t - 1] = state;
  }
  return { path, posterior: path.map((s, t) => Math.exp(logEmission[t][s])) };
}
