// The short buffers that go with a generated part (spec 136): the drummer's count-in, and the exit bar of each vamp. They are not the
// song's length, so they are packed end to end into one track beside the part ("Drums extras (generated)"), and a manifest in the song's
// options says where each one is. The track is kept out of the player (extraKeysIn, playable.ts): the session plays the extras itself, at
// the moments it needs them. Pure: no store and no audio context.

import type { PcmAudio } from "../types";

/** The names of the extras tracks. The song store writes them. */
export const EXTRAS_NAMES = { drums: "Drums extras (generated)", bass: "Bass extras (generated)" } as const;
export type ExtrasPart = keyof typeof EXTRAS_NAMES;

/** The key the song's `generatedParts` record keeps a part's extras track under. */
export const EXTRAS_RECORD_KEY = { drums: "drumsExtras", bass: "bassExtras" } as const satisfies Record<ExtrasPart, string>;

/** The drummer's count: its audio, and the song time its first frame plays at (negative: ahead of the song). */
export interface CountInAudio {
  audio: PcmAudio;
  start: number;
}

/** A vamp's exit bar: the audio that replaces the vamp's last bar on its last pass, and the song times of that bar. */
export interface ExitAudio {
  audio: PcmAudio;
  from: number;
  to: number;
}

/** What a part's extras hold, as audio. */
export interface PartExtras {
  countIn?: CountInAudio;
  /** By section id. */
  exits: Record<string, ExitAudio>;
}

/** Where one extra sits in the packed track, in frames. */
interface Span {
  at: number;
  frames: number;
}

/** What the song's options keep for a part's extras. */
export interface ExtrasManifest {
  sampleRate: number;
  countIn?: Span & { start: number };
  exits: Record<string, Span & { from: number; to: number }>;
}

export const hasExtras = (extras: PartExtras): boolean => extras.countIn !== undefined || Object.keys(extras.exits).length > 0;

/** The extras as one stereo track, with the manifest that finds them again. Null when there are none. */
export function packExtras(extras: PartExtras): { audio: PcmAudio; manifest: ExtrasManifest } | null {
  if (!hasExtras(extras)) return null;
  const items: { audio: PcmAudio; place: (span: Span) => void }[] = [];
  const manifest: ExtrasManifest = { sampleRate: (extras.countIn?.audio ?? Object.values(extras.exits)[0].audio).sampleRate, exits: {} };
  if (extras.countIn) {
    const { audio, start } = extras.countIn;
    items.push({ audio, place: (span) => (manifest.countIn = { ...span, start }) });
  }
  for (const [id, exit] of Object.entries(extras.exits)) {
    items.push({ audio: exit.audio, place: (span) => (manifest.exits[id] = { ...span, from: exit.from, to: exit.to }) });
  }
  const total = items.reduce((sum, item) => sum + item.audio.channels[0].length, 0);
  const channels = [new Float32Array(total), new Float32Array(total)];
  let at = 0;
  for (const item of items) {
    const frames = item.audio.channels[0].length;
    channels[0].set(item.audio.channels[0], at);
    channels[1].set(item.audio.channels[1] ?? item.audio.channels[0], at);
    item.place({ at, frames });
    at += frames;
  }
  return { audio: { sampleRate: manifest.sampleRate, channels }, manifest };
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseSpan(value: unknown, frames: number): (Span & Record<string, unknown>) | null {
  if (!isRecord(value) || !isFiniteNumber(value.at) || !isFiniteNumber(value.frames)) return null;
  if (!Number.isInteger(value.at) || !Number.isInteger(value.frames) || value.at < 0 || value.frames <= 0 || value.at + value.frames > frames) return null;
  return value as Span & Record<string, unknown>;
}

/**
 * Cuts the extras out of their packed track. A manifest entry that is damaged, or that reaches past the track, is left out, so a part that
 * lost its extras plays as it did before they existed.
 */
export function unpackExtras(track: PcmAudio, manifest: unknown): PartExtras {
  const extras: PartExtras = { exits: {} };
  if (!isRecord(manifest) || manifest.sampleRate !== track.sampleRate) return extras;
  const frames = track.channels[0].length;
  const cut = (span: Span): PcmAudio => ({
    sampleRate: track.sampleRate,
    channels: track.channels.map((channel) => channel.slice(span.at, span.at + span.frames)),
  });
  const count = parseSpan(manifest.countIn, frames);
  if (count && isFiniteNumber(count.start)) extras.countIn = { audio: cut(count), start: count.start };
  if (isRecord(manifest.exits)) {
    for (const [id, entry] of Object.entries(manifest.exits)) {
      const span = parseSpan(entry, frames);
      if (id === "__proto__" || !span || !isFiniteNumber(span.from) || !isFiniteNumber(span.to) || !(span.to > span.from)) continue;
      extras.exits[id] = { audio: cut(span), from: span.from, to: span.to };
    }
  }
  return extras;
}

/** The track keys of the extras a song's options record, so the player is built without them. */
export function extraKeysIn(options: Record<string, unknown>): string[] {
  const saved = options.generatedParts;
  if (!isRecord(saved)) return [];
  return Object.values(EXTRAS_RECORD_KEY).flatMap((name) => (typeof saved[name] === "string" ? [saved[name]] : []));
}

/** A part's extras as the session holds them: the track the part plays on, and what the extras hold. */
export interface LoadedExtras {
  track: string;
  extras: PartExtras;
}

/**
 * The extras of a song's generated parts, read from its saved options and its stems. A part with no extras track, a missing track or a
 * damaged manifest has none, and plays as it did before extras existed.
 */
export function loadExtras(
  options: Record<string, unknown>,
  stems: Readonly<Record<string, PcmAudio | undefined>> | null,
): Partial<Record<ExtrasPart, LoadedExtras>> {
  const loaded: Partial<Record<ExtrasPart, LoadedExtras>> = {};
  const saved = options.generatedParts;
  const manifests = options.bandExtras;
  if (!stems || !isRecord(saved) || !isRecord(manifests)) return loaded;
  for (const part of ["drums", "bass"] as const) {
    const track = saved[part];
    const packed = saved[EXTRAS_RECORD_KEY[part]];
    if (typeof track !== "string" || typeof packed !== "string" || !stems[track] || !stems[packed]) continue;
    const extras = unpackExtras(stems[packed], manifests[part]);
    if (hasExtras(extras)) loaded[part] = { track, extras };
  }
  return loaded;
}
