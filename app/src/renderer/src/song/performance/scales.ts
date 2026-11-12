// Scale maths for the solo-scale neck diagram: which notes of a scale lie where on a guitar neck, and the "box" positions players learn.
// Pure functions only. The root is a pitch class (0 = C), and string 0 is the low E.
import { KEY_NAMES } from "./key";
import { keyParts } from "./speed";

/** The scales a player can pick. */
export type ScaleId = "minorPentatonic" | "majorPentatonic" | "blues" | "naturalMinor" | "major" | "dorian" | "mixolydian" | "harmonicMinor";

/** A scale: its name, the semitones of each note above the root, and a degree label (R, b3, 5 …) for each of them. */
export interface ScaleDef {
  id: ScaleId;
  name: string;
  intervals: number[];
  degrees: string[];
}

/** The eight scales, in the order the picker lists them. */
export const SCALES: ScaleDef[] = [
  { id: "minorPentatonic", name: "Minor pentatonic", intervals: [0, 3, 5, 7, 10], degrees: ["R", "b3", "4", "5", "b7"] },
  { id: "majorPentatonic", name: "Major pentatonic", intervals: [0, 2, 4, 7, 9], degrees: ["R", "2", "3", "5", "6"] },
  { id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10], degrees: ["R", "b3", "4", "b5", "5", "b7"] },
  { id: "naturalMinor", name: "Natural minor", intervals: [0, 2, 3, 5, 7, 8, 10], degrees: ["R", "2", "b3", "4", "5", "b6", "b7"] },
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11], degrees: ["R", "2", "3", "4", "5", "6", "7"] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10], degrees: ["R", "2", "b3", "4", "5", "6", "b7"] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10], degrees: ["R", "2", "3", "4", "5", "6", "b7"] },
  { id: "harmonicMinor", name: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11], degrees: ["R", "2", "b3", "4", "5", "b6", "7"] },
];

/** The definition of a scale. */
export function scaleDef(id: ScaleId): ScaleDef {
  return SCALES.find((scale) => scale.id === id) ?? SCALES[0];
}

/** Standard tuning as MIDI notes, low E first: E2 A2 D3 G3 B3 E4. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

/** The highest fret the diagram shows. */
export const FRET_COUNT = 22;

/** Optional overrides for the neck, for other tunings or shorter necks. */
export interface NeckOptions {
  /** Open-string MIDI notes, low string first. Defaults to standard tuning. */
  tuning?: number[];
  /** Highest fret. Defaults to FRET_COUNT. */
  fretCount?: number;
}

/** One scale note on the neck. */
export interface NeckNote {
  /** 0 is the low E string */
  string: number;
  /** 0 is the open string */
  fret: number;
  /** Pitch class, 0 = C */
  pc: number;
  /** The degree label, such as "R", "b3" or "5" */
  degree: string;
  /** True for the scale's root note */
  root: boolean;
}

/** A box position: its notes and the lowest and highest fret they use. */
export interface ScalePosition {
  /** 1-based position number */
  number: number;
  fromFret: number;
  toFret: number;
  notes: NeckNote[];
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/** The note at a fret, or null when the pitch class is not in the scale. */
function neckNote(string: number, fret: number, tuning: number[], rootPc: number, scale: ScaleDef): NeckNote | null {
  const pc = mod12(tuning[string] + fret);
  const index = scale.intervals.indexOf(mod12(pc - rootPc));
  if (index < 0) return null;
  return { string, fret, pc, degree: scale.degrees[index], root: index === 0 };
}

/** Every note of the scale from the open strings up to the last fret, low string first and each string in fret order. */
export function scaleNotesOnNeck(root: number, scale: ScaleId, options: NeckOptions = {}): NeckNote[] {
  const tuning = options.tuning ?? STANDARD_TUNING;
  const fretCount = options.fretCount ?? FRET_COUNT;
  const def = scaleDef(scale);
  const notes: NeckNote[] = [];
  for (let string = 0; string < tuning.length; string++) {
    for (let fret = 0; fret <= fretCount; fret++) {
      const note = neckNote(string, fret, tuning, mod12(root), def);
      if (note) notes.push(note);
    }
  }
  return notes;
}

/**
 * The boxes of a scale: five for a pentatonic scale (two notes per string) and seven for a seven-note scale (three per string). Position n
 * starts on scale degree n on the low string. The blues scale uses the minor pentatonic boxes plus its b5 wherever that fret lies inside the box.
 */
export function scalePositions(root: number, scale: ScaleId, options: NeckOptions = {}): ScalePosition[] {
  const tuning = options.tuning ?? STANDARD_TUNING;
  const rootPc = mod12(root);
  const def = scaleDef(scale);
  const walked = scale === "blues" ? scaleDef("minorPentatonic") : def;
  const perString = walked.intervals.length === 5 ? 2 : 3;
  const positions: ScalePosition[] = [];

  for (let n = 1; n <= walked.intervals.length; n++) {
    const first = n - 1;
    const startPc = mod12(rootPc + walked.intervals[first]);
    const startPitch = tuning[0] + mod12(startPc - tuning[0]);
    // The scale's notes in pitch order, from the start note upward
    const pitchAt = (k: number): number => {
      const index = first + k;
      return startPitch + walked.intervals[index % walked.intervals.length] + 12 * Math.floor(index / walked.intervals.length) - walked.intervals[first];
    };

    const pitches: number[][] = [];
    for (let string = 0; string < tuning.length; string++) {
      pitches.push(Array.from({ length: perString }, (_, i) => pitchAt(string * perString + i)));
    }
    const lowest = Math.min(...pitches.map((row, string) => row[0] - tuning[string]));
    const shift = lowest < 0 ? 12 : 0;

    const notes: NeckNote[] = [];
    pitches.forEach((row, string) => {
      for (const pitch of row) {
        const note = neckNote(string, pitch - tuning[string] + shift, tuning, rootPc, def);
        if (note) notes.push(note);
      }
    });
    const frets = notes.map((note) => note.fret);
    const fromFret = Math.min(...frets);
    const toFret = Math.max(...frets);

    if (scale === "blues") {
      for (let string = 0; string < tuning.length; string++) {
        for (let fret = fromFret; fret <= toFret; fret++) {
          const note = neckNote(string, fret, tuning, rootPc, def);
          if (note && note.degree === "b5") notes.push(note);
        }
      }
      notes.sort((a, b) => a.string - b.string || a.fret - b.fret);
    }
    positions.push({ number: n, fromFret, toFret, notes });
  }
  return positions;
}

/** The same position 12 frets higher, or null when any note would pass the last fret. */
export function octaveUp(position: ScalePosition, fretCount = FRET_COUNT): ScalePosition | null {
  if (position.toFret + 12 > fretCount) return null;
  return {
    number: position.number,
    fromFret: position.fromFret + 12,
    toFret: position.toFret + 12,
    notes: position.notes.map((note) => ({ ...note, fret: note.fret + 12 })),
  };
}

/** The scale the panel opens with for a song key. */
export interface DefaultSoloScale {
  scale: ScaleId;
  /** Root pitch class, as the song sounds */
  root: number;
  /** For a major key, the key whose relative minor this is, such as "A major" */
  relativeOf?: string;
}

/**
 * The default solo scale for a song key: the minor pentatonic. A minor key uses its own tonic. A major key uses its relative minor (the
 * 6th degree), which has the same notes as the major key's major pentatonic, so nothing clashes. Null when no key is known.
 */
export function defaultSoloScale(songKey: string | undefined): DefaultSoloScale | null {
  const parts = keyParts(songKey ?? "");
  if (!parts) return null;
  if (parts.minor) return { scale: "minorPentatonic", root: parts.pitch };
  return { scale: "minorPentatonic", root: mod12(parts.pitch + 9), relativeOf: `${KEY_NAMES[parts.pitch]} major` };
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** The name of a pitch class, spelled with flats or sharps. */
export function noteName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** The solo scale choice saved with a song. Missing fields mean "follow the song key" and the minor pentatonic. */
export interface SoloScaleChoice {
  scale?: ScaleId;
  /** Root pitch class as the song sounds, before the pitch shift and capo */
  root?: number;
}

/** Reads the saved choice (`options.soloScale`), dropping anything that is not valid. */
export function parseSoloScale(value: unknown): SoloScaleChoice {
  if (typeof value !== "object" || value === null) return {};
  const raw = value as Record<string, unknown>;
  const choice: SoloScaleChoice = {};
  const scale = SCALES.find((def) => def.id === raw.scale);
  if (scale) choice.scale = scale.id;
  if (typeof raw.root === "number" && Number.isInteger(raw.root) && raw.root >= 0 && raw.root <= 11) choice.root = raw.root;
  return choice;
}
