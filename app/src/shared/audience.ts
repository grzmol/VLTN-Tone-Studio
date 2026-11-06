// The audience display's contract (spec 43). The performance screen sends an update to the main process, which forwards it to the
// audience window. The audience window never talks back: it only reads these updates, and runs its own clock between them.
import { HostError } from "./ipc";

/** Upper bounds on what one update may carry. The performance screen clips to them, and the main process refuses anything above them. */
export const AUDIENCE_LIMITS = {
  lines: 2000,
  lineText: 400,
  heading: 200,
  chords: 12,
  chordName: 24,
  title: 200,
  songKey: 300,
  url: 500,
  position: 10_000_000,
  page: 10_000,
  rateMin: 0.1,
  rateMax: 4,
  fontMin: 0.5,
  fontMax: 2,
} as const;

/** The audience window's picture: the lyrics, the PDF page, or the logo while no song is on. */
export type AudienceScreen = "logo" | "lyrics" | "pdf";
export type AudienceRotation = 0 | 90 | 180 | 270;
export const AUDIENCE_ROTATIONS: readonly AudienceRotation[] = [0, 90, 180, 270];

/** One lyric line as shown to the audience. `time` is null for an untimed line; `heading` is set for a section label such as `[Verse]`. */
export interface AudienceLine {
  time: number | null;
  heading: string | null;
  /** Lyric text with its emphasis and colour markup, chords removed and transposed to the performance key. Empty for a heading. */
  text: string;
  /** Chord names on this line, transposed to the performance key. */
  chords: string[];
}

/** What the audience window shows, as far as it changes with the song or the audience settings. */
export interface AudienceModel {
  songKey: string | null;
  screen: AudienceScreen;
  blackout: boolean;
  /** Black while the song is stopped at its start: between the songs of a set, and before a song is played. */
  blackBetweenSongs: boolean;
  title: string;
  /** The next song of the playlist, or null at the end of the set. */
  nextTitle: string | null;
  /** True when the chart has timestamps. An untimed chart is shown as a block of text, without following the song. */
  timed: boolean;
  lines: AudienceLine[];
  showChords: boolean;
  fontScale: number;
  rotation: AudienceRotation;
  /** The PDF page on the performer's screen, when the PDF is the chart shown. `url` is the song's library file. */
  pdf: { url: string; page: number } | null;
}

/**
 * The song position at a moment, so the audience window can run its own clock. `songPosition` is the position at `at` (a wall-clock
 * time in milliseconds, from the sending window). While `playing`, the position moves on at `rate`.
 */
export interface AudienceClock {
  songKey: string | null;
  songPosition: number;
  at: number;
  rate: number;
  playing: boolean;
}

/** One message from the performance screen. A null part means "unchanged since the last update". */
export interface AudienceUpdate {
  model: AudienceModel | null;
  clock: AudienceClock | null;
}

/** The audience window's latest state: both parts are null until the performance screen has sent them. */
export type AudienceState = AudienceUpdate;

/** The latest state with an update applied. A null part of the update keeps what was there. */
export function mergeAudienceState(state: AudienceState, update: AudienceUpdate): AudienceState {
  return { model: update.model ?? state.model, clock: update.clock ?? state.clock };
}

function invalid(what: string): never {
  throw new HostError("invalid", `Audience display: ${what}.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.length > max) invalid(`${what} must be text up to ${max} characters`);
  return value as string;
}

function nullableText(value: unknown, max: number, what: string): string | null {
  return value === null ? null : text(value, max, what);
}

function finite(value: unknown, min: number, max: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(`${what} is out of range`);
  return value as number;
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") invalid(`${what} must be true or false`);
  return value as boolean;
}

function parseLine(value: unknown): AudienceLine {
  if (!isObject(value)) invalid("a lyric line must be an object");
  const chords = value.chords;
  if (!Array.isArray(chords) || chords.length > AUDIENCE_LIMITS.chords) invalid(`a line can have up to ${AUDIENCE_LIMITS.chords} chords`);
  return {
    time: value.time === null ? null : finite(value.time, -AUDIENCE_LIMITS.position, AUDIENCE_LIMITS.position, "a line time"),
    heading: nullableText(value.heading, AUDIENCE_LIMITS.heading, "a heading"),
    text: text(value.text, AUDIENCE_LIMITS.lineText, "a lyric line"),
    chords: chords.map((chord) => text(chord, AUDIENCE_LIMITS.chordName, "a chord name")),
  };
}

function parsePdf(value: unknown): AudienceModel["pdf"] {
  if (value === null) return null;
  if (!isObject(value)) invalid("the PDF must be an object or null");
  const url = text(value.url, AUDIENCE_LIMITS.url, "the PDF address");
  if (!url.startsWith("app://library/") && !url.startsWith("blob:")) invalid("the PDF must come from the song library");
  const page = finite(value.page, 1, AUDIENCE_LIMITS.page, "the PDF page");
  return { url, page: Math.floor(page) };
}

function parseModel(value: unknown): AudienceModel {
  if (!isObject(value)) invalid("the model must be an object");
  const screen = value.screen;
  if (screen !== "logo" && screen !== "lyrics" && screen !== "pdf") invalid("the screen is not one the audience knows");
  if (!Array.isArray(value.lines) || value.lines.length > AUDIENCE_LIMITS.lines) invalid(`a chart has up to ${AUDIENCE_LIMITS.lines} lines`);
  const rotation = value.rotation;
  if (!AUDIENCE_ROTATIONS.includes(rotation as AudienceRotation)) invalid("the rotation must be 0, 90, 180 or 270");
  return {
    songKey: nullableText(value.songKey, AUDIENCE_LIMITS.songKey, "the song key"),
    screen,
    blackout: flag(value.blackout, "blackout"),
    blackBetweenSongs: flag(value.blackBetweenSongs, "blackBetweenSongs"),
    title: text(value.title, AUDIENCE_LIMITS.title, "the title"),
    nextTitle: nullableText(value.nextTitle, AUDIENCE_LIMITS.title, "the next title"),
    timed: flag(value.timed, "timed"),
    lines: value.lines.map(parseLine),
    showChords: flag(value.showChords, "showChords"),
    fontScale: finite(value.fontScale, AUDIENCE_LIMITS.fontMin, AUDIENCE_LIMITS.fontMax, "the font size"),
    rotation: rotation as AudienceRotation,
    pdf: parsePdf(value.pdf),
  };
}

function parseClock(value: unknown): AudienceClock {
  if (!isObject(value)) invalid("the clock must be an object");
  return {
    songKey: nullableText(value.songKey, AUDIENCE_LIMITS.songKey, "the song key"),
    songPosition: finite(value.songPosition, 0, AUDIENCE_LIMITS.position, "the song position"),
    at: finite(value.at, 0, Number.MAX_SAFE_INTEGER, "the clock time"),
    rate: finite(value.rate, AUDIENCE_LIMITS.rateMin, AUDIENCE_LIMITS.rateMax, "the playback rate"),
    playing: flag(value.playing, "playing"),
  };
}

/**
 * Checks an update from the renderer before anything is sent on. Every field is checked for type, size and range, so a broken
 * performance screen can at worst show a wrong picture; it cannot send a path or an address the audience window should not load.
 * Throws a HostError ("invalid") for anything else.
 */
export function parseAudienceUpdate(input: unknown): AudienceUpdate {
  if (!isObject(input)) invalid("the update must be an object");
  return {
    model: input.model === null || input.model === undefined ? null : parseModel(input.model),
    clock: input.clock === null || input.clock === undefined ? null : parseClock(input.clock),
  };
}

/** The browser build's channel between the performance tab and its audience pop-up. Desktop uses the audience IPC instead. */
export const AUDIENCE_CHANNEL = "vltn-audience";
