// The audience display's logic (spec 43), kept free of React and Electron. The performance screen turns its song and settings into a
// model (`audienceModel`) and sends it with song-position snapshots (`AudienceFeed`). The audience window turns the latest snapshot into
// the line on screen (`audienceTime`, `audienceIndex`). A snapshot is sent only when the audience's own clock would be wrong: a song
// change (including a gapless hand-over), a play or pause, a speed change, a seek, a jump or a loop, or once a second while playing.
import { AUDIENCE_LIMITS, type AudienceClock, type AudienceLine, type AudienceModel, type AudienceRotation, type AudienceUpdate } from "@shared/audience";
import { headingLabel, stageText, transpose } from "./chart";
import type { Chord } from "./chords";
import type { MidiMacro } from "./midi-macros";
import { performanceLines } from "./reader";

/** How often a playing song sends a snapshot anyway, so the audience window's clock never drifts for long. */
export const RESYNC_MS = 1000;
/** How far the audience's own clock may differ from the song before a snapshot is sent. A seek or a loop is always further than this. */
export const DRIFT_SECONDS = 0.15;

/** What the performance screen has in the song on screen, before it is turned into lines. */
export interface AudienceSongInput {
  songKey: string;
  title: string;
  nextTitle: string | null;
  chart: string;
  lyrics: string;
  chords: Chord[];
  macros: readonly MidiMacro[];
  /** Semitones the chart is shown at (the chart transpose plus any pitch the chords follow). */
  shift: number;
  /** Whether the chord names are written with flats, from the song key. */
  flats?: boolean;
  /** The PDF page on the performer's screen, when the PDF is what the reader shows. */
  pdf: { url: string; page: number } | null;
}

/** The audience settings the performer chooses. They are part of the model, so changing one sends a new model. */
export interface AudienceSettingsInput {
  showChords: boolean;
  fontScale: number;
  rotation: AudienceRotation;
  blackout: boolean;
  blackBetweenSongs: boolean;
}

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
/** A chord written above the words, as the reader matches it. The audience shows chord names on their own row, so the words lose them. */
const chordToken = /\[([A-G][#b]?[^\]\s]*|N)\]/g;

/** The lines as the audience reads them: the reader's text rules (stage text, headings, transpose) and no MIDI cues. */
function audienceLines(lines: ReturnType<typeof performanceLines>, shift: number, flats?: boolean): AudienceLine[] {
  return lines.slice(0, AUDIENCE_LIMITS.lines).map((line) => {
    const shown = stageText(line.text);
    const heading = headingLabel(shown);
    return {
      time: Number.isFinite(line.time) ? line.time : null,
      heading: heading ? clip(heading, AUDIENCE_LIMITS.heading) : null,
      text: heading !== null ? "" : clip(transpose(shown, shift, flats).replace(chordToken, ""), AUDIENCE_LIMITS.lineText),
      chords: line.chords
        .filter((chord) => chord.name !== "N")
        .slice(0, AUDIENCE_LIMITS.chords)
        .map((chord) => clip(transpose(`[${chord.name}]`, shift, flats).slice(1, -1), AUDIENCE_LIMITS.chordName)),
    };
  });
}

/** Turns the song on screen and the audience settings into the model the audience window shows. Pure: the same inputs give the same model. */
export function audienceModel(song: AudienceSongInput | null, settings: AudienceSettingsInput): AudienceModel {
  const fontScale = Math.min(AUDIENCE_LIMITS.fontMax, Math.max(AUDIENCE_LIMITS.fontMin, settings.fontScale));
  const base = {
    blackout: settings.blackout,
    blackBetweenSongs: settings.blackBetweenSongs,
    showChords: settings.showChords,
    fontScale,
    rotation: settings.rotation,
  };
  if (!song) return { ...base, songKey: null, screen: "logo", title: "", nextTitle: null, timed: false, lines: [], pdf: null };
  const lines = audienceLines(performanceLines(song.chart, song.lyrics, song.chords, song.macros), song.shift, song.flats);
  return {
    ...base,
    songKey: clip(song.songKey, AUDIENCE_LIMITS.songKey),
    screen: song.pdf ? "pdf" : "lyrics",
    title: clip(song.title, AUDIENCE_LIMITS.title),
    nextTitle: song.nextTitle ? clip(song.nextTitle, AUDIENCE_LIMITS.title) : null,
    timed: lines.some((line) => line.time !== null),
    lines,
    pdf: song.pdf ? { url: song.pdf.url, page: Math.max(1, Math.floor(song.pdf.page)) } : null,
  };
}

/**
 * True when the audience screen is black: a blackout, or black between songs while the song is stopped at its start. Before the first
 * update there is nothing to show, so the screen is black too.
 */
export function audienceBlank(model: AudienceModel | null, clock: AudienceClock | null): boolean {
  if (!model || model.blackout) return true;
  return model.blackBetweenSongs && (!clock || (!clock.playing && clock.songPosition === 0));
}

/** The song position the audience should show at `now` (a wall-clock time in milliseconds), from the latest snapshot. Never negative. */
export function audienceTime(clock: AudienceClock, now: number): number {
  const elapsed = clock.playing ? Math.max(0, now - clock.at) / 1000 : 0;
  return Math.max(0, clock.songPosition + elapsed * clock.rate);
}

/** Index of the timed line that is on screen (the last one that has started), or -1 before the first. */
export function audienceIndex(model: AudienceModel, clock: AudienceClock | null, now: number): number {
  if (!model.timed) return -1;
  const position = clock ? audienceTime(clock, now) : 0;
  return model.lines.findLastIndex((line) => line.time !== null && line.time <= position);
}

/** The first line after `index` that has words or a heading, or null at the end of the chart. */
export function audienceNextLine(model: AudienceModel, index: number): AudienceLine | null {
  return model.lines.slice(index + 1).find((line) => line.text !== "" || line.heading !== null) ?? null;
}

/** The state the performance screen samples the song at. `songKey` tells a new song (or a gapless hand-over) from a seek. */
export interface ClockSample {
  songKey: string | null;
  position: number;
  playing: boolean;
  rate: number;
}

/**
 * Decides when a clock snapshot is needed. It returns the snapshot to send, or null when the audience's own clock already agrees with
 * the song. The rules: a new song, a play or pause, a speed change, a position that is off the audience's clock by more than
 * DRIFT_SECONDS (a seek, a jump, a loop), and while playing, once every RESYNC_MS.
 */
export class AudienceSync {
  private last: AudienceClock | null = null;

  next(sample: ClockSample, now: number): AudienceClock | null {
    const last = this.last;
    const due =
      !last ||
      last.songKey !== sample.songKey ||
      last.playing !== sample.playing ||
      last.rate !== sample.rate ||
      (sample.playing && now - last.at >= RESYNC_MS) ||
      Math.abs(sample.position - audienceTime(last, now)) > DRIFT_SECONDS;
    if (!due) return null;
    this.last = { songKey: sample.songKey, songPosition: Math.max(0, sample.position), at: now, rate: sample.rate, playing: sample.playing };
    return this.last;
  }

  /** Forgets the last snapshot, so the next sample is sent in full. */
  reset(): void {
    this.last = null;
  }
}

/**
 * The performance screen's side of the audience: it keeps the model and the clock snapshot, and calls `send` only when either changes.
 * `send` gets an update with a null part for whatever did not change.
 */
export class AudienceFeed {
  private sync = new AudienceSync();
  private modelJson: string | null = null;
  private lastSample: ClockSample | null = null;

  constructor(
    private send: (update: AudienceUpdate) => void,
    private now: () => number = () => Date.now(),
  ) {}

  /** Passes on a new model (when its content changed) and the latest clock sample (when the clock needs a snapshot). */
  update(sample: ClockSample | null, model: AudienceModel | null = null): void {
    const modelChanged = model !== null && JSON.stringify(model) !== this.modelJson;
    if (modelChanged) this.modelJson = JSON.stringify(model);
    if (sample) this.lastSample = sample;
    const clock = sample ? this.sync.next(sample, this.now()) : null;
    if (modelChanged || clock) this.send({ model: modelChanged ? model : null, clock });
  }

  /** The performance screen is going away: the audience's clock stops where the song is. */
  stop(): void {
    if (!this.lastSample) return;
    const { songKey, position, rate } = this.lastSample;
    this.sync.reset();
    this.send({ model: null, clock: { songKey, songPosition: Math.max(0, position), at: this.now(), rate, playing: false } });
  }
}
