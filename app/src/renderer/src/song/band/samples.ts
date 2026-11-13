// Samples for the generated drum and bass parts (spec 50). The FLAC files and samples/map.json ship with the app; their licences are in
// NOTICE.md next to this file. Loading decodes every file once and keeps the result in memory. The pickers are pure, so the generators
// and their tests can use them without any audio.
//
// Handing the samples to the band worker (commit 5b): the decoded channels are Float32Arrays in the main thread. Posting them to the
// worker copies them, and transferring them detaches them from this cache. So the worker should own its own copy: it can fetch the
// URLs from `sampleFileUrls()` and decode them with `decodeTrack` itself, so the main thread never holds the audio that the worker plays.

import { decodeTrack } from "../codec/flac-client";
import type { PcmAudio } from "../types";
import sampleMapJson from "./samples/map.json";

/** A velocity range, inclusive at both ends. */
export type VelocityRange = [number, number];

export interface DrumLayer {
  velocity: VelocityRange;
  /** The velocity the sample was recorded at. Its gain is velocity / nominal. */
  nominal: number;
  /** Semitones to play the sample up or down. Only the GM 47 (mid tom) layers set it. */
  transpose: number;
  /** One recording per round-robin take. A layer with a single take has one entry. */
  takes: PcmAudio[];
}

export interface BassSample {
  /** The MIDI note the sample was recorded at. */
  root: number;
  layer: "p" | "f";
  velocity: VelocityRange;
  audio: PcmAudio;
}

export interface SampleSet {
  /** Drum layers by GM pitch, sorted by velocity. */
  drums: Map<number, DrumLayer[]>;
  bass: BassSample[];
}

/** One drum layer in map.json: `file` for a single take, or `files` for round-robin takes. */
export interface DrumLayerEntry {
  file?: string;
  files?: string[];
  velocity: VelocityRange;
  nominal: number;
  transpose?: number;
}

/** The files of a drum layer entry, one per take. */
export function takeFiles(layer: DrumLayerEntry): string[] {
  return layer.files ?? (layer.file ? [layer.file] : []);
}

/** What samples/map.json holds. File paths are relative to samples/. */
export interface SampleMap {
  sampleRate: number;
  drums: Record<string, { name: string; layers: DrumLayerEntry[] }>;
  bass: { file: string; root: number; layer: "p" | "f"; velocity: VelocityRange }[];
}

export interface DrumPick {
  audio: PcmAudio;
  gain: number;
  transpose: number;
}

export interface BassPick {
  audio: PcmAudio;
  playbackRate: number;
}

function fail(message: string): never {
  throw new Error(`Invalid sample map: ${message}`);
}

/** Checks the parsed map.json and returns it typed. Throws with the first problem it finds. */
export function readSampleMap(value: unknown): SampleMap {
  const map = value as Partial<SampleMap> | null;
  if (!map || typeof map !== "object") fail("not an object");
  if (!Number.isFinite(map.sampleRate) || (map.sampleRate ?? 0) <= 0) fail("sampleRate");
  if (!map.drums || typeof map.drums !== "object") fail("drums");
  if (!Array.isArray(map.bass)) fail("bass");
  const isRange = (r: unknown): r is VelocityRange => Array.isArray(r) && r.length === 2 && r.every(Number.isInteger);
  const isTakeList = (layer: DrumLayerEntry): boolean =>
    layer.files !== undefined ? Array.isArray(layer.files) && layer.files.length > 0 && layer.files.every((f) => typeof f === "string") : typeof layer.file === "string";
  for (const [pitch, entry] of Object.entries(map.drums ?? {})) {
    if (!/^\d+$/.test(pitch) || !Array.isArray(entry.layers) || entry.layers.length === 0) fail(`drum ${pitch}`);
    for (const layer of entry.layers)
      if (!isTakeList(layer) || !isRange(layer.velocity) || !Number.isFinite(layer.nominal)) fail(`drum ${pitch} layer`);
  }
  for (const sample of map.bass ?? []) {
    if (typeof sample.file !== "string" || !Number.isInteger(sample.root) || (sample.layer !== "p" && sample.layer !== "f") || !isRange(sample.velocity)) {
      fail(`bass ${sample.file}`);
    }
  }
  return map as SampleMap;
}

/** The bundled map. Read once at import; a malformed file fails the first test run, not the first song. */
export const SAMPLE_MAP: SampleMap = readSampleMap(sampleMapJson);

const clampVelocity = (velocity: number): number => Math.min(127, Math.max(1, Math.round(velocity)));

/** The layer whose range holds the velocity, or the nearest one when no range does. */
function layerFor<T extends { velocity: VelocityRange }>(layers: readonly T[], velocity: number): T | undefined {
  let best: T | undefined;
  let bestDistance = Infinity;
  for (const layer of layers) {
    const [low, high] = layer.velocity;
    const distance = velocity < low ? low - velocity : velocity > high ? velocity - high : 0;
    if (distance < bestDistance) {
      best = layer;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
}

/**
 * The layer and gain for one drum hit. `take` is the hit's number among the hits of this pitch: hit n plays take n of the layer, wrapping
 * around, so the same notes always give the same audio. A GM pitch with no layers throws; the tests check every pitch the styles use has some.
 */
export function pickDrumSample(set: SampleSet, pitch: number, velocity: number, take = 0): DrumPick {
  const layers = set.drums.get(pitch);
  const layer = layers && layerFor(layers, clampVelocity(velocity));
  if (!layer) throw new Error(`No drum sample for GM pitch ${pitch}.`);
  return { audio: layer.takes[take % layer.takes.length], gain: clampVelocity(velocity) / layer.nominal, transpose: layer.transpose };
}

/** Within this many velocity steps of a layer boundary a drum hit plays both neighbouring layers. */
export const DRUM_CROSSFADE_STEPS = 6;

/** One drum layer that sounds, with its weight in the mix. */
export interface DrumLayerMix {
  pick: DrumPick;
  weight: number;
}

/**
 * The layers a drum hit plays. Normally the one layer that holds the velocity. Within DRUM_CROSSFADE_STEPS of a boundary between two
 * layers, both play with equal-power weights (the same curve as pickBassLayers), so a velocity crossing a boundary does not step. Both
 * layers use the same take number.
 */
export function pickDrumLayers(set: SampleSet, pitch: number, velocity: number, take = 0): DrumLayerMix[] {
  const v = clampVelocity(velocity);
  const layers = set.drums.get(pitch);
  const main = layers && layerFor(layers, v);
  if (!layers || !main) throw new Error(`No drum sample for GM pitch ${pitch}.`);
  const index = layers.indexOf(main);
  // The boundary lies between a layer's last velocity and the next layer's first.
  const side = v - main.velocity[0] < main.velocity[1] + 1 - v ? -1 : 1;
  const other = layers[index + side];
  const boundary = side === 1 ? main.velocity[1] + 0.5 : main.velocity[0] - 0.5;
  const distance = Math.abs(v - boundary);
  if (!other || distance >= DRUM_CROSSFADE_STEPS) return [{ pick: pickDrumSample(set, pitch, v, take), weight: 1 }];
  // The other layer's share grows from 0 at the edge of the zone to one half at the boundary itself.
  const toOther = 0.5 * (1 - distance / DRUM_CROSSFADE_STEPS);
  const angle = (toOther * Math.PI) / 2;
  const pickOf = (layer: DrumLayer): DrumPick => ({ audio: layer.takes[take % layer.takes.length], gain: v / layer.nominal, transpose: layer.transpose });
  return [
    { pick: pickOf(main), weight: Math.cos(angle) },
    { pick: pickOf(other), weight: Math.sin(angle) },
  ];
}

/** The root of the sample nearest the note. Throws when no bass samples are loaded. */
function nearestBassRoot(set: SampleSet, midi: number): number {
  let root: number | undefined;
  for (const sample of set.bass) {
    if (root === undefined || Math.abs(sample.root - midi) < Math.abs(root - midi)) root = sample.root;
  }
  if (root === undefined) throw new Error("No bass samples are loaded.");
  return root;
}

/** The nearest root, its layer for the velocity, and the rate that moves the sample to the note (equal temperament). */
export function pickBassSample(set: SampleSet, midi: number, velocity: number): BassPick {
  const root = nearestBassRoot(set, midi);
  const sample = layerFor(
    set.bass.filter((s) => s.root === root),
    clampVelocity(velocity),
  );
  if (!sample) throw new Error(`No bass layer for root ${root}.`);
  return { audio: sample.audio, playbackRate: 2 ** ((midi - root) / 12) };
}

/** Below this velocity a bass note is the soft layer alone. */
export const BASS_CROSSFADE_FROM = 66;
/** Above this velocity a bass note is the hard layer alone. Between the two, both layers sound. */
export const BASS_CROSSFADE_TO = 86;

/** One bass layer that sounds, with its weight in the mix. */
export interface BassLayerMix {
  pick: BassPick;
  weight: number;
}

/**
 * The layers a bass note plays. Below BASS_CROSSFADE_FROM only the soft (p) layer, above BASS_CROSSFADE_TO only the hard (f) layer, and
 * between them both, with equal-power weights so the level does not dip at the middle. A root with only one layer plays that layer alone,
 * as pickBassSample does.
 */
export function pickBassLayers(set: SampleSet, midi: number, velocity: number): BassLayerMix[] {
  const v = clampVelocity(velocity);
  const root = nearestBassRoot(set, midi);
  const playbackRate = 2 ** ((midi - root) / 12);
  const soft = set.bass.find((s) => s.root === root && s.layer === "p");
  const hard = set.bass.find((s) => s.root === root && s.layer === "f");
  if (!soft || !hard || v <= BASS_CROSSFADE_FROM || v >= BASS_CROSSFADE_TO) {
    return [{ pick: pickBassSample(set, midi, v), weight: 1 }];
  }
  const t = (v - BASS_CROSSFADE_FROM) / (BASS_CROSSFADE_TO - BASS_CROSSFADE_FROM);
  const angle = (t * Math.PI) / 2;
  return [
    { pick: { audio: soft.audio, playbackRate }, weight: Math.cos(angle) },
    { pick: { audio: hard.audio, playbackRate }, weight: Math.sin(angle) },
  ];
}

/**
 * Builds the set from the map and a decoded audio file for each path. Kept apart from the fetching so it runs in tests with stub audio.
 * Drum layers are sorted by velocity, and the transpose defaults to 0.
 */
export function sampleSetFrom(map: SampleMap, audioFor: (file: string) => PcmAudio): SampleSet {
  const drums = new Map<number, DrumLayer[]>();
  for (const [pitch, entry] of Object.entries(map.drums)) {
    const layers = entry.layers.map((layer) => ({
      velocity: layer.velocity,
      nominal: layer.nominal,
      transpose: layer.transpose ?? 0,
      takes: takeFiles(layer).map(audioFor),
    }));
    drums.set(
      Number(pitch),
      layers.sort((a, b) => a.velocity[0] - b.velocity[0]),
    );
  }
  const bass = map.bass.map((sample) => ({ root: sample.root, layer: sample.layer, velocity: sample.velocity, audio: audioFor(sample.file) }));
  return { drums, bass };
}

// Vite emits each FLAC as an asset and gives its URL (the same pattern as the Gp5 fixtures and the capture clips).
const SAMPLE_URLS = import.meta.glob("./samples/**/*.flac", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** The bundled URL of each sample, by its path in map.json (for example `drums/kick-v1-rr1.flac`). */
export function sampleFileUrls(): Map<string, string> {
  const urls = new Map<string, string>();
  for (const [path, url] of Object.entries(SAMPLE_URLS)) urls.set(path.replace("./samples/", ""), url);
  return urls;
}

/** Decodes the files a few at a time, so the codec does not start every worker at once. */
const DECODE_BATCH = 8;

/** Every sample file the map names, once each. */
function sampleFiles(): string[] {
  return [...new Set([...Object.values(SAMPLE_MAP.drums).flatMap((e) => e.layers.flatMap(takeFiles)), ...SAMPLE_MAP.bass.map((s) => s.file)])];
}

async function decodeAll(files: string[], urls: ReadonlyMap<string, string>, decode: (file: ArrayBuffer) => Promise<PcmAudio>): Promise<Map<string, PcmAudio>> {
  const decoded = new Map<string, PcmAudio>();
  for (let i = 0; i < files.length; i += DECODE_BATCH) {
    const batch = files.slice(i, i + DECODE_BATCH);
    const audio = await Promise.all(
      batch.map(async (file) => {
        const url = urls.get(file);
        if (!url) throw new Error(`Sample ${file} is missing from the app.`);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load sample ${file}.`);
        return decode(await response.arrayBuffer());
      }),
    );
    batch.forEach((file, index) => decoded.set(file, audio[index]));
  }
  return decoded;
}

/**
 * Fetches and decodes every sample from `urls`, without caching. `decode` is the codec: the renderer passes `decodeTrack`, which runs a
 * worker, and the band worker passes `decodeFlac`, which it can call directly. Either way the caller decides what to keep.
 */
export async function loadSampleSetWith(urls: ReadonlyMap<string, string>, decode: (file: ArrayBuffer) => Promise<PcmAudio>): Promise<SampleSet> {
  const decoded = await decodeAll(sampleFiles(), urls, decode);
  return sampleSetFrom(SAMPLE_MAP, (file) => {
    const audio = decoded.get(file);
    if (!audio) throw new Error(`Sample ${file} was not decoded.`);
    return audio;
  });
}

let loaded: Promise<SampleSet> | undefined;

/** Loads and decodes every sample once, then returns the same set on every call. A failed load is retried on the next call. */
export function loadSampleSet(): Promise<SampleSet> {
  loaded ??= loadSampleSetWith(sampleFileUrls(), decodeTrack).catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

/** The velocity a metronome hit is played at: the medium layer of every drum sample. */
const CLICK_VELOCITY = 90;

const clickSamples = new Map<number, Promise<PcmAudio>>();

/**
 * One drum sample's audio by GM pitch (the medium layer), fetched and decoded once. The metronome uses it for its drum sounds. A failed
 * load is retried on the next call.
 */
export function loadDrumSample(pitch: number): Promise<PcmAudio> {
  const cached = clickSamples.get(pitch);
  if (cached) return cached;
  const layers = SAMPLE_MAP.drums[String(pitch)]?.layers ?? [];
  const layer = layers.find((l) => CLICK_VELOCITY >= l.velocity[0] && CLICK_VELOCITY <= l.velocity[1]) ?? layers[0];
  const file = layer && takeFiles(layer)[0];
  if (!file) return Promise.reject(new Error(`No drum sample for note ${pitch}.`));
  const load = (async () => {
    const url = sampleFileUrls().get(file);
    if (!url) throw new Error(`Sample ${file} is missing from the app.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load sample ${file}.`);
    return decodeTrack(await response.arrayBuffer());
  })().catch((error: unknown) => {
    clickSamples.delete(pitch);
    throw error;
  });
  clickSamples.set(pitch, load);
  return load;
}
