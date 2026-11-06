// Speed and pitch, as the performance layer sees them (pure). A song plays at a rate `r` (0.5 to 1.5). At rate `r` a song second takes
// 1 / r audio seconds, so cues, lyrics and sections stay in song time while the clock and the MIDI tempo follow the effective BPM.
// The pitch is a separate setting that changes the sound and, when the chords follow it, the chord names. Neither one touches the
// song's own timeline, which is why the mapping lives here and not in the audio code.

/** The slowest and fastest rate a song may play at: 50% to 150% */
export const RATE_MIN = 0.5;
export const RATE_MAX = 1.5;
/** Pitch shift limits: whole semitones, plus a fine tune in cents */
export const PITCH_SEMITONES_MAX = 6;
export const PITCH_CENTS_MAX = 50;
/** The highest capo position a player can use */
export const CAPO_MAX = 7;

/** `value` as a rate, kept between RATE_MIN and RATE_MAX. A value that is not a number plays at the song's own speed. */
export function clampRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, value));
}

/** `value` as whole semitones within the shift limit. */
export function clampSemitones(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PITCH_SEMITONES_MAX, Math.max(-PITCH_SEMITONES_MAX, Math.round(value)));
}

/** `value` as a fine tune in cents within the limit. */
export function clampCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(PITCH_CENTS_MAX, Math.max(-PITCH_CENTS_MAX, Math.round(value)));
}

/** `value` as a capo position, from 0 (none) to CAPO_MAX. */
export function clampCapo(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(CAPO_MAX, Math.max(0, Math.round(value)));
}

/** The frequency ratio for a pitch shift: 1 at no shift, 2 for an octave up. */
export function pitchRatio(semitones: number, cents = 0): number {
  return 2 ** ((semitones + cents / 100) / 12);
}

/**
 * The tempo a player hears: the song's BPM times the rate. The clock, the count-in and a tempo message all use it, so a song at 80%
 * sends and counts at 80% of its written tempo. A missing or unusable BPM stays unusable (0).
 */
export function effectiveBpm(bpm: number, rate: number): number {
  return Number.isFinite(bpm) && bpm > 0 ? bpm * clampRate(rate) : 0;
}

/**
 * The semitones the chord names shift by on screen. The chords follow the pitch shift only when `applyPitch` is on. The capo then
 * lowers the shapes the player plays: a capo at 2 shows the chord two semitones below the sounding one.
 */
export function chordDisplayTranspose(semitones: number, capo: number, applyPitch: boolean): number {
  return (applyPitch ? clampSemitones(semitones) : 0) - clampCapo(capo);
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ROOT = /^([A-G])([#b]?)(.*)$/;

/**
 * Moves one note name (root, with an optional accidental) by `semitones`. `flats` picks the spelling of the result (true for flats, false
 * for sharps). Without it, a flat in the source is kept as a flat and anything else is spelled with sharps.
 */
function transposeNote(root: string, accidental: string, semitones: number, flats?: boolean): string {
  const index = (NOTE_INDEX[root] + (accidental === "#" ? 1 : accidental === "b" ? -1 : 0) + semitones + 1200) % 12;
  return (flats ?? accidental === "b") ? FLAT_NAMES[index] : SHARP_NAMES[index];
}

/** One chord symbol (no bass) moved by `semitones`. Quality text such as "m7" or "sus4" is kept as written. */
function transposeSymbol(symbol: string, semitones: number, flats?: boolean): string {
  const match = ROOT.exec(symbol);
  if (!match) return symbol;
  const [, root, accidental, quality] = match;
  return transposeNote(root, accidental, semitones, flats) + quality;
}

/**
 * A chord name moved by `semitones`, including a slash bass ("G/B" → "A/C#"). "N" (no chord) and names that do not parse are returned
 * unchanged, so nothing is ever invented. `flats` respells every note in the chosen style, even at zero semitones: "A#" in a flat key
 * becomes "Bb". Without it, a name is only moved and keeps its own spelling.
 */
export function transposeChordName(name: string, semitones: number, flats?: boolean): string {
  if (name === "N") return name;
  if (!semitones && flats === undefined) return name;
  const [symbol, bass, ...rest] = name.split("/");
  if (rest.length) return name;
  const moved = transposeSymbol(symbol, semitones, flats);
  return bass === undefined ? moved : `${moved}/${transposeSymbol(bass, semitones, flats)}`;
}

/**
 * Pitch classes (0 = C) of the keys written with flats when the key has no accidental of its own: F, Bb, Eb, Ab and Db major, and C, D,
 * Eb, F, G, Ab and Bb minor, which share their signature. Gb is written with a flat in the key name, and F# with a sharp, so pitch class 6
 * is left out: a key that moves onto F# is written with sharps.
 */
const FLAT_MAJOR_PITCHES = new Set([1, 3, 5, 8, 10]);
const FLAT_MINOR_PITCHES = new Set([0, 2, 3, 5, 7, 8, 10]);

/** The root, pitch class, minor flag and accidental of a key name such as "Bb", "A minor", "F#m" or "Eb major", or null when it does not parse. */
function keyParts(key: string): { pitch: number; minor: boolean; accidental: string } | null {
  const match = /^([A-G])([#b]?)(.*)$/.exec(key.trim());
  if (!match) return null;
  const pitch = (NOTE_INDEX[match[1]] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
  return { pitch, minor: /^\s*(min|minor|m)(?![a-z])/i.test(match[3]), accidental: match[2] };
}

/**
 * Whether the chord names of `key` are spelled with flats (true) or sharps (false). A key written with a flat or a sharp keeps that
 * spelling. Undefined when the key does not parse, so the chords keep their own spelling.
 */
export function flatsForKey(key: string | undefined): boolean | undefined {
  const parts = keyParts(key ?? "");
  if (!parts) return undefined;
  if (parts.accidental) return parts.accidental === "b";
  return (parts.minor ? FLAT_MINOR_PITCHES : FLAT_MAJOR_PITCHES).has(parts.pitch);
}

/** The pitch classes whose sharp and flat names are one note, C#/Db and F#/Gb. Only these depend on which side of the fifths the key is on. */
const ENHARMONIC_PITCHES = new Set([1, 6]);

/**
 * Which side of the circle of fifths a key sits on: 1 for sharps, -1 for flats, 0 for C or A minor, which have neither. The fifths count
 * is `7 × pitch` mod 12, read as a number from -5 to 6, so E major (4 sharps) is 4 and Bb major (2 flats) is -2.
 */
function keySide(parts: { pitch: number; minor: boolean; accidental: string }): number {
  if (parts.accidental) return parts.accidental === "b" ? -1 : 1;
  const fifths = ((parts.pitch + (parts.minor ? 3 : 0)) * 7) % 12;
  return fifths === 0 ? 0 : fifths > 6 ? -1 : 1;
}

/**
 * The spelling a song's chord names use once its key is moved by `steps`. The shifted key's pitch decides it, so A minor up a semitone is
 * Bb minor, written with flats, and C up a semitone is Db, with flats. Where the shifted pitch has two names, the song's own side of the
 * circle decides it: E major capo 3 shows C# with sharps, not Db. Undefined when no key is known.
 */
export function keySpelling(key: string | undefined, steps: number): boolean | undefined {
  const parts = keyParts(key ?? "");
  if (!parts) return undefined;
  if (!steps) return flatsForKey(key);
  const pitch = (((parts.pitch + steps) % 12) + 12) % 12;
  const side = keySide(parts);
  if (ENHARMONIC_PITCHES.has(pitch) && side !== 0) return side < 0;
  return (parts.minor ? FLAT_MINOR_PITCHES : FLAT_MAJOR_PITCHES).has(pitch);
}

/**
 * A chord name as the app writes it: a root A to G with an optional sharp or flat, then quality such as `m7`, `maj7`, `sus4`, `add9` or
 * `7b5`, and an optional bass after a slash. `N.C.` and `N` mean no chord. Words such as "Bass", "Dad" or "Chorus" do not match, so a
 * `[Chorus]` label is never moved.
 */
const CHORD_NAME = /^(?:[A-G](?:#|b)?(?:maj|min|m|M|dim|aug|sus|add|\+|°|ø|-|#|b|\d)*(?:\/[A-G](?:#|b)?)?|N\.?C\.?|N)$/;

/** Whether `token` is a chord name, so it can be moved or merged. */
export function isChordName(token: string): boolean {
  return CHORD_NAME.test(token);
}

/** A song's speed and pitch as the player and the reader use them. Stored in the song's options, next to its other performance options. */
export interface SpeedSettings {
  /** Playback rate, 0.5 to 1.5 */
  rate: number;
  /** Whole semitones of pitch shift */
  semitones: number;
  /** Fine tune in cents */
  cents: number;
  /** Capo position, 0 to 7. It lowers the chord shapes; it does not change the sound. */
  capo: number;
  /** Whether the chord names move with the pitch shift */
  applyToChords: boolean;
  /** Per-track choices where a track differs from its default (see `tracksFollowPitch`), keyed by track name */
  followsPitch: Record<string, boolean>;
}

export const DEFAULT_SPEED: SpeedSettings = { rate: 1, semitones: 0, cents: 0, capo: 0, applyToChords: false, followsPitch: {} };

/**
 * Whether a track is shifted in pitch by default. Drums and other click-like stems keep their pitch, so the pitch shift changes the
 * melodic tracks only. A track's own choice overrides this.
 */
export function defaultFollowsPitch(track: string): boolean {
  return track !== "drums";
}

/** Whether `track` follows the pitch shift: its own choice when it has one, the default otherwise. */
export function followsPitch(settings: Pick<SpeedSettings, "followsPitch">, track: string): boolean {
  return settings.followsPitch[track] ?? defaultFollowsPitch(track);
}

/** The speed settings with every value clamped. Anything missing or invalid falls back to the default; it never throws. */
export function clampSpeed(raw: Partial<SpeedSettings> | Record<string, unknown>): SpeedSettings {
  const source = raw as Record<string, unknown>;
  const followed: Record<string, boolean> = {};
  if (source.followsPitch && typeof source.followsPitch === "object") {
    for (const [track, value] of Object.entries(source.followsPitch as Record<string, unknown>)) {
      if (typeof value === "boolean" && /^[a-z][a-z0-9]{0,15}$/.test(track)) followed[track] = value;
    }
  }
  return {
    rate: clampRate(source.rate ?? source.speed),
    semitones: clampSemitones(source.semitones),
    cents: clampCents(source.cents),
    capo: clampCapo(source.capo),
    applyToChords: source.applyToChords === true,
    followsPitch: followed,
  };
}

/** A song's stored speed settings, read from its options. A missing or broken JSON is the default. */
export function speedFromOptions(json: string): SpeedSettings {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return clampSpeed(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {});
  } catch {
    return DEFAULT_SPEED;
  }
}

/** The keys the speed settings are stored under in a song's options. The capo is stored by the performance panel under the same name. */
export function speedOptions(speed: SpeedSettings): Record<string, unknown> {
  return { speed: speed.rate, semitones: speed.semitones, cents: speed.cents, applyToChords: speed.applyToChords, followsPitch: speed.followsPitch };
}
