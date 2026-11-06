// Chord templates for the chord analysis (spec 81). Each chord is a pattern over the twelve pitch classes: its own tones, plus the tones its
// second and third harmonics add (the fifth above a tone, and the major third two octaves up). The pattern is compared with a span's
// chroma by cosine similarity. A flat pattern stands for "no chord", so a spread-out chroma reads as N. The bass chroma adds a little to
// the root that the bass plays, and a slash name (C/G) is given only when the bass clearly plays a chord tone other than the root.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface ChordType {
  /** The suffix after the root in a chord name, as `parseChordName` reads it. */
  suffix: string;
  /** Semitones above the root that the chord sounds. */
  tones: readonly number[];
  /** Added to the score. Sevenths get a small penalty, so a seventh is only named when it is clearly the better match. */
  prior: number;
}

/** A seventh is only chosen when its extra note is clearly sounding. */
export const SEVENTH_PRIOR = -0.03;
/** How much the bass chroma at the root adds to a chord's score. */
export const BASS_WEIGHT = 0.15;
/** Added to the score of N. Zero means N needs a spread-out chroma to win. */
export const N_PRIOR = 0;
/** The bass note must hold this share of the bass chroma before a slash name is given. */
export const SLASH_SHARE = 0.45;

export const CHORD_TYPES: readonly ChordType[] = [
  { suffix: "", tones: [0, 4, 7], prior: 0 },
  { suffix: "m", tones: [0, 3, 7], prior: 0 },
  { suffix: "5", tones: [0, 7], prior: 0 },
  { suffix: "7", tones: [0, 4, 7, 10], prior: SEVENTH_PRIOR },
  { suffix: "maj7", tones: [0, 4, 7, 11], prior: SEVENTH_PRIOR },
  { suffix: "m7", tones: [0, 3, 7, 10], prior: SEVENTH_PRIOR },
  { suffix: "sus2", tones: [0, 2, 7], prior: 0 },
  { suffix: "sus4", tones: [0, 5, 7], prior: 0 },
  { suffix: "dim", tones: [0, 3, 6], prior: 0 },
  { suffix: "aug", tones: [0, 4, 8], prior: 0 },
];

/** One candidate: a root and a chord type, or the N state (`type` is -1). */
export interface ChordState {
  root: number;
  type: number;
}

/** Every root with every chord type, then N last. */
export const CHORD_STATES: readonly ChordState[] = [
  ...Array.from({ length: 12 * CHORD_TYPES.length }, (_, i) => ({ root: Math.floor(i / CHORD_TYPES.length), type: i % CHORD_TYPES.length })),
  { root: 0, type: -1 },
];
export const N_STATE = CHORD_STATES.length - 1;

const HARMONIC_THIRD = 0.33;
const HARMONIC_FIFTH = 0.2;

function unit(vector: Float64Array): Float64Array {
  const length = Math.hypot(...vector);
  return length ? vector.map((v) => v / length) : vector;
}

/** The template of a root and chord type, as a unit vector over the pitch classes. */
export function templateOf(root: number, type: ChordType): Float64Array {
  const vector = new Float64Array(12);
  for (const tone of type.tones) {
    const pitch = (root + tone) % 12;
    vector[pitch] += 1;
    vector[(pitch + 7) % 12] += HARMONIC_THIRD;
    vector[(pitch + 4) % 12] += HARMONIC_FIFTH;
  }
  return unit(vector);
}

/** The template of every state, in `CHORD_STATES` order. The N template is flat. */
export const TEMPLATES: readonly Float64Array[] = CHORD_STATES.map((state) =>
  state.type < 0 ? new Float64Array(12).fill(1 / Math.sqrt(12)) : templateOf(state.root, CHORD_TYPES[state.type]),
);

/**
 * The score of every state for a span: the cosine of its template with the treble chroma, plus the type's prior, plus the bass at the
 * root. A silent span (an all-zero chroma) scores N at 1 and every chord at 0.
 */
export function chordScores(treble: ArrayLike<number>, bass: ArrayLike<number> | null): Float64Array {
  const scores = new Float64Array(CHORD_STATES.length);
  let energy = 0,
    sum = 0;
  for (let i = 0; i < 12; i++) {
    energy += treble[i] * treble[i];
    sum += treble[i];
  }
  const length = Math.sqrt(energy);
  if (!length) {
    scores[N_STATE] = 1;
    return scores;
  }
  CHORD_STATES.forEach((state, s) => {
    if (state.type < 0) {
      // The cosine with a flat pattern is the sum over the root of the square root of 12, so a spread-out chroma scores high.
      scores[s] = sum / (length * Math.sqrt(12)) + N_PRIOR;
      return;
    }
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += treble[i] * TEMPLATES[s][i];
    scores[s] = dot / length + CHORD_TYPES[state.type].prior + (bass ? BASS_WEIGHT * bass[state.root] : 0);
  });
  return scores;
}

/** The index of the best-scoring state. */
export function bestState(scores: ArrayLike<number>): number {
  let best = 0;
  for (let s = 1; s < scores.length; s++) if (scores[s] > scores[best]) best = s;
  return best;
}

/**
 * The name of a chord state, in the syntax `parseChordName` reads: a root, a suffix, and a slash bass when the bass clearly plays a chord
 * tone other than the root (C/G). `bass` is the bass chroma of the span, or null.
 */
export function chordNameOf(state: ChordState, bass: ArrayLike<number> | null): string {
  if (state.type < 0) return "N";
  const type = CHORD_TYPES[state.type];
  const base = NOTE_NAMES[state.root] + type.suffix;
  if (!bass) return base;
  let loudest = 0;
  for (let p = 1; p < 12; p++) if (bass[p] > bass[loudest]) loudest = p;
  const interval = (loudest - state.root + 12) % 12;
  if (bass[loudest] < SLASH_SHARE || loudest === state.root || !type.tones.includes(interval)) return base;
  return `${base}/${NOTE_NAMES[loudest]}`;
}

/** The chord of a span: its name and its score. `bass` is the bass chroma of the span, or null when there is no bass audio. */
export function chordAt(treble: ArrayLike<number>, bass: ArrayLike<number> | null): { name: string; confidence: number } {
  const scores = chordScores(treble, bass);
  const best = bestState(scores);
  return { name: chordNameOf(CHORD_STATES[best], bass), confidence: Math.max(0, Math.min(1, scores[best])) };
}
