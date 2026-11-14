// The band pipeline (spec 50, commit 5b): generates the drum and bass notes of a song, then renders the parts the request asks for. Pure:
// the band worker calls these with the decoded samples, and the tests call them with stub samples. The same request, with the same seed,
// gives the same audio.

import type { BandSettings, SectionPlan } from "./arrangement";
import { monoSum, onsetStrength, type BeatGrid } from "./beat-grid";
import { endBeforeNext, generateBass } from "./bass";
import { countInOf } from "./count-in";
import type { BandKey } from "./bass-phrases";
import { drumOnsets, followDrummer } from "./drummer-timing";
import { generateDrums } from "./drums";
import { ENDING_TAIL, HOLD_BARS, SLOW_TEMPO } from "./ending";
import { beatLevelsDb, followFeel, type Feel } from "./feel";
import type { ChordAtBeat } from "./harmony";
import { humanise } from "./humanise";
import { loudnessOf, matchLoudness, STEM_SILENT_LUFS, targetLoudness, type LevelKind, type LevelReport, type PartLevels } from "./level";
import type { NoteEvent } from "./note";
import { RENDER_RATE, renderPart } from "./render";
import type { SampleSet } from "./samples";
import { barBeats, beatSpan } from "./timing";
import { EXIT_TAIL, WRAP_TAIL, vampBars, withoutVamps, type VampBar } from "./vamp";
import type { PcmAudio } from "../types";
import type { Section } from "../performance/sections";

/**
 * The audio that follow-my-playing reads, and the name the panel shows for it ("guitar", "piano", "other" or "mix"). Only the mono sum
 * is sent to the worker, so the client sums it before it posts the request.
 */
export interface BandFollow {
  source: string;
  audio: PcmAudio;
}

/** Everything a job needs. It is plain data, so it can be sent to the worker as it is. */
export interface BandRequest {
  grid: BeatGrid;
  harmony: ChordAtBeat[];
  plans: SectionPlan[];
  settings: BandSettings;
  seed: number;
  /** The song's length in frames at RENDER_RATE. The parts are rendered to exactly this length. */
  lengthFrames: number;
  /**
   * The song's keys, in song seconds, covering the song (one entry when it has one key). The bass keeps its fills in them. An empty list
   * means no key is known, and the fills use the chord's own scale.
   */
  keys: BandKey[];
  /** The song's trim end in seconds, when it has one. The ending goes on the last full bar before it (ending.ts). */
  trimEnd?: number;
  parts: { drums: boolean; bass: boolean };
  /** Where the worker fetches each sample file, by its path in map.json. */
  sampleUrls: Record<string, string>;
  /** The stem that follow-my-playing reads, when the setting is on. */
  follow?: BandFollow;
  /**
   * The song's source mix, mono (a plain average, not scaled). Its beat levels decide stops and hits when follow-my-playing is on, and its
   * loudness is the level the generated parts are set to (level.ts).
   */
  mix?: PcmAudio;
  /**
   * The original drums and bass stems, mono, when the split has them. A generated part is matched to its stem's loudness, and to the song
   * less an offset when there is no stem.
   */
  originals?: { drums?: PcmAudio; bass?: PcmAudio };
}

/** What follow-my-playing did for a render: which source it read, and whether the parts were made to follow it. */
export interface FollowReport {
  source: string;
  following: boolean;
}

/** The steps a job reports, in order. */
export type BandStage = "loading" | "generating" | "rendering";

export interface BandResult {
  /** Present only for the parts the request asked for. */
  drums?: PcmAudio;
  bass?: PcmAudio;
  notes: { drums: NoteEvent[]; bass: NoteEvent[] };
  /** Present when follow-my-playing was on for the request. */
  follow?: FollowReport;
  /** How far under the song each generated part was set. Present for the parts that were matched. */
  levels?: PartLevels;
  /**
   * The drummer's count (count-in.ts), rendered like the drums and set to their level, when the settings ask for one. `start` is the song time
   * its first frame plays at: negative when the song has no room before its first downbeat, so the session plays it ahead of the song.
   */
  countIn?: { audio: PcmAudio; start: number };
  /**
   * The exit bar of each vamp, by section id (vamp.ts): the vamp's last bar with the fill and lead-in into the next section, rendered like the
   * parts it replaces and set to their level. `from` and `to` are the song times of the bar it takes the place of on the last pass.
   */
  exits?: Record<string, { from: number; to: number; drums?: PcmAudio; bass?: PcmAudio }>;
}

/** A span of the song, in seconds. */
export interface PreviewWindow {
  start: number;
  end: number;
}

interface Notes {
  drums: NoteEvent[];
  bass: NoteEvent[];
}

interface Generated {
  notes: Notes;
  follow?: FollowReport;
  /** The notes of the song as if its vamps were ordinary sections, when it has vamps: their exit bars are cut from these. */
  exitNotes?: Notes;
}

/**
 * The feel of the request, from its follow stem, or none. In auto a song whose sections repeat no clear accents is not followed, and the
 * report says so. The onset is read here, in the worker, so the window never does it.
 */
function feelFor(request: BandRequest): { feel?: Feel; follow?: FollowReport } {
  const { follow, settings } = request;
  if (!follow || !settings.followPlaying) return {};
  // The follow audio and the mix reach the worker as plain averages, so they are scaled to a peak of 1 here, as the beat tracker reads them.
  const followMono = { sampleRate: follow.audio.sampleRate, channels: [monoSum([follow.audio])] };
  const onset = onsetStrength([followMono], follow.audio.sampleRate);
  const mix = request.mix ?? followMono;
  const levelDb = beatLevelsDb(monoSum([mix]), mix.sampleRate, request.grid);
  const { feel } = followFeel(onset, request.grid, request.plans, settings.followSource === "auto", levelDb);
  return { feel: feel ?? undefined, follow: { source: follow.source, following: feel !== null } };
}

/**
 * Moves the drum notes onto the original drummer's hits, and the bass notes locked to a kick with it (drummer-timing.ts), when the setting
 * is on and the song has a drums stem that is not silent. Otherwise the notes are returned as they are.
 */
function snapToDrummer(request: BandRequest, drums: NoteEvent[], bass: NoteEvent[]): Notes {
  const stem = request.originals?.drums;
  if (!request.settings.followDrummer || !stem || !(loudnessOf(stem) > STEM_SILENT_LUFS)) return { drums, bass };
  return followDrummer(drums, bass, drumOnsets(stem));
}

/**
 * The notes of the parts the request asks for, humanised (humanise.ts). Drums are always generated, even when only the bass is wanted,
 * because the bass locks to the kick; the bass locks to the drums as generated, before humanising. Drums that were not asked for are not
 * returned.
 */
function generate(request: BandRequest): Generated {
  const { feel, follow } = feelFor(request);
  const { grid, plans, settings, seed } = request;
  const drums = generateDrums(grid, plans, settings, seed, feel, request.trimEnd);
  const bass = request.parts.bass ? generateBass(grid, request.harmony, plans, settings, drums, seed, feel, request.trimEnd, request.keys) : [];
  const humanDrums = humanise(drums, "drums", grid, plans, settings.humanise, seed);
  const humanBass = humanise(bass, "bass", grid, plans, settings.humanise, seed);
  const snapped = snapToDrummer(request, humanDrums, humanBass);
  const drumNotes = snapped.drums;
  const bassNotes = endBeforeNext(snapped.bass);
  const result: Generated = { notes: { drums: request.parts.drums ? drumNotes : [], bass: bassNotes }, follow };
  // A song with vamps is generated a second time with them as ordinary sections, which gives each vamp's exit bar its fill and lead-in.
  if (vampBars(grid, plans).length > 0) result.exitNotes = generate({ ...request, plans: withoutVamps(plans) }).notes;
  return result;
}

/**
 * Sets one rendered part to the song's level: its original stem's loudness, or the song less the kind's offset. A part that cannot be
 * measured, or a song with no measurable loudness, is returned as it is with no report.
 */
function levelPart(kind: LevelKind, audio: PcmAudio, request: BandRequest, songLufs: number): { audio: PcmAudio; report?: LevelReport } {
  const { mix } = request;
  if (!mix || !Number.isFinite(songLufs)) return { audio };
  const target = targetLoudness(kind, mix, request.originals?.[kind], songLufs);
  const match = matchLoudness(audio, target);
  if (!Number.isFinite(match.lufs)) return { audio };
  return { audio: match.audio, report: { gainDb: match.gainDb, belowSongDb: songLufs - match.lufs, limitedByPeak: match.limitedByPeak } };
}

/**
 * How long the rendered parts are. A hold, three hits or a slow ending play past the song's own end, so the parts grow to fit them: a
 * hold or three hits by at most HOLD_BARS bars, and a slow ending by the bars it slows over as well. Other endings keep the song's length.
 */
export function renderLength(request: BandRequest, notes: Notes): number {
  const { kind, bars } = request.settings.ending;
  if (kind === "hit" || kind === "none") return request.lengthFrames;
  const all = [...notes.drums.map((note) => ({ ...note, duration: Math.max(note.duration, ENDING_TAIL) })), ...notes.bass];
  const latest = all.reduce((end, note) => Math.max(end, note.time + note.duration), 0);
  const wanted = Math.max(request.lengthFrames, Math.ceil(latest * RENDER_RATE));
  const beats = request.grid.beats;
  if (beats.length < 2) return request.lengthFrames;
  const bar = barBeats(request.grid) * (beats[beats.length - 1] - beats[beats.length - 2]);
  // A slow ending's bars are stretched to the slowest tempo at most, and so is the hold after them.
  const allowed = kind === "slow" ? ((bars ?? 1) + HOLD_BARS) / SLOW_TEMPO + 1 : HOLD_BARS;
  return Math.min(wanted, request.lengthFrames + Math.ceil(allowed * bar * RENDER_RATE));
}

function render(request: BandRequest, generated: Generated, samples: SampleSet, songFrames: number, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("rendering");
  const lengthFrames = Math.max(songFrames, renderLength(request, generated.notes));
  const { notes } = generated;
  const result: BandResult = generated.follow ? { notes, follow: generated.follow } : { notes };
  const songLufs = request.mix ? loudnessOf(request.mix) : -Infinity;
  const levels: PartLevels = {};
  const vamps = vampBars(request.grid, request.plans);
  for (const kind of ["drums", "bass"] as const) {
    if (!request.parts[kind]) continue;
    const dry = renderPart(notes[kind], kind, samples, lengthFrames, RENDER_RATE).audio;
    // The ring of a vamp's last bar carries on into its start, so the loop point has no cut.
    if (kind === "drums") for (const bar of vamps) wrapTail(dry, notes.drums, bar, samples);
    const rendered = dry;
    const leveled = levelPart(kind, rendered, request, songLufs);
    result[kind] = leveled.audio;
    if (leveled.report) levels[kind] = leveled.report;
  }
  if (levels.drums || levels.bass) result.levels = levels;
  const count = request.parts.drums ? renderCountIn(request, samples, levels.drums?.gainDb ?? 0) : undefined;
  if (count) result.countIn = count;
  if (generated.exitNotes && vamps.length > 0) result.exits = renderExits(request, generated.exitNotes, vamps, samples, levels);
  return result;
}

/** Adds `source` into `audio` from frame `at`, as far as `audio` reaches. */
function addInto(audio: PcmAudio, source: PcmAudio, at: number, frames: number): void {
  audio.channels.forEach((channel, c) => {
    const from = source.channels[Math.min(c, source.channels.length - 1)];
    for (let i = 0; i < frames && at + i < channel.length && i < from.length; i++) channel[at + i] += from[i];
  });
}

/** The notes that start in [from, to), moved so the span starts at 0. */
function notesInBar(notes: readonly NoteEvent[], from: number, to: number): NoteEvent[] {
  return notes.filter((note) => note.time >= from && note.time < to).map((note) => ({ ...note, time: note.time - from }));
}

/**
 * Mixes WRAP_TAIL seconds of the ring that follows a vamp's last bar into the vamp's start. The tail comes from the last bar's own notes, not
 * from the audio after the vamp, which holds the next section's crash.
 */
function wrapTail(dry: PcmAudio, notes: readonly NoteEvent[], bar: VampBar, samples: SampleSet): void {
  const barFrames = Math.round((bar.to - bar.from) * RENDER_RATE);
  const tailFrames = Math.round(WRAP_TAIL * RENDER_RATE);
  const ring = renderPart(notesInBar(notes, bar.from, bar.to), "drums", samples, barFrames + tailFrames, RENDER_RATE).audio;
  const tail: PcmAudio = { sampleRate: RENDER_RATE, channels: ring.channels.map((channel) => channel.slice(barFrames)) };
  addInto(dry, tail, Math.round(bar.start * RENDER_RATE), tailFrames);
}

/** Each vamp's exit bar, rendered like its part and set to the part's level. The drums get the room too. */
function renderExits(
  request: BandRequest,
  notes: Notes,
  vamps: readonly VampBar[],
  samples: SampleSet,
  levels: PartLevels,
): NonNullable<BandResult["exits"]> {
  const exits: NonNullable<BandResult["exits"]> = {};
  for (const bar of vamps) {
    const frames = Math.round((bar.to - bar.from + EXIT_TAIL) * RENDER_RATE);
    const exit: NonNullable<BandResult["exits"]>[string] = { from: bar.from, to: bar.to };
    for (const kind of ["drums", "bass"] as const) {
      if (!request.parts[kind]) continue;
      const dry = renderPart(notesInBar(notes[kind], bar.from, bar.to), kind, samples, frames, RENDER_RATE).audio;
      const rendered = kind === "drums" && !hasOwnSpace(request.settings.drumTone) ? addRoom(dry, samples.room, Math.min(1, request.settings.drumRoom * (samples.roomScale ?? 1))) : dry;
      exit[kind] = withGain(rendered, levels[kind]?.gainDb ?? 0);
    }
    exits[bar.sectionId] = exit;
  }
  return exits;
}

/** Scales every channel of a buffer by `gainDb`. The count is short, so a copy is cheap. */
function withGain(audio: PcmAudio, gainDb: number): PcmAudio {
  const gain = 10 ** (gainDb / 20);
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((channel) => channel.map((value) => value * gain)) };
}

/** The drummer's count as audio: the drums' own render, room and level, so it sits with them. Undefined when the song has no count. */
function renderCountIn(request: BandRequest, samples: SampleSet, drumsGainDb: number): BandResult["countIn"] {
  const count = countInOf(request.grid, request.settings.countIn);
  if (!count) return undefined;
  const dry = renderPart(count.notes, "drums", samples, Math.ceil(count.length * RENDER_RATE), RENDER_RATE).audio;
  const rendered = hasOwnSpace(request.settings.drumTone) ? dry : addRoom(dry, samples.room, Math.min(1, request.settings.drumRoom * (samples.roomScale ?? 1)));
  return { audio: withGain(rendered, drumsGainDb), start: count.start };
}

/** Generates and renders the whole song's parts. `onStage` is told when each step starts. */
export function runBandJob(request: BandRequest, samples: SampleSet, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("generating");
  return render(request, generate(request), samples, request.lengthFrames, onStage);
}

/**
 * The span a preview covers: from `fromTime`, for `bars` bars of the grid. The end is the start of the bar after the last one, so a
 * preview that starts on a downbeat is exactly `bars` bars long. Past the last beat the grid's last beat interval is extended.
 */
export function previewWindow(grid: BeatGrid, fromTime: number, bars: number): PreviewWindow {
  const beats = grid.beats;
  if (beats.length === 0) return { start: fromTime, end: fromTime };
  let first = beats.findIndex((time) => time >= fromTime);
  if (first < 0) first = beats.length;
  const endBeat = first + bars * barBeats(grid);
  if (endBeat < beats.length) return { start: fromTime, end: beats[endBeat] };
  const last = beats.length - 1;
  return { start: fromTime, end: beats[last] + (endBeat - last) * beatSpan(beats, last) };
}

/** The most bars one preview renders, so a long section does not take minutes. */
export const MAX_PREVIEW_BARS = 32;

/** How much of a section a preview plays: all of it, or the first 4 or 8 bars. */
export type PreviewLength = "whole" | 4 | 8;

/**
 * The bars a preview of a section covers. A whole section runs to the next section's start, and the last section to the song's end
 * (`songEnd`, or its own end when not given). The result is at least 1 and at most MAX_PREVIEW_BARS. 4 and 8 are used as asked.
 */
export function sectionPreviewBars(grid: BeatGrid, sections: readonly Section[], index: number, length: PreviewLength, songEnd?: number): number {
  if (length !== "whole") return Math.min(length, MAX_PREVIEW_BARS);
  const section = sections[index];
  if (!section) return 1;
  const end = sections[index + 1]?.start ?? songEnd ?? section.end;
  const barSeconds = (barBeats(grid) * 60) / grid.bpm;
  const bars = Math.round((end - section.start) / barSeconds);
  return Math.min(MAX_PREVIEW_BARS, Math.max(1, Number.isFinite(bars) ? bars : 1));
}

/** A copy of the audio from frame `from` for `frames` frames. Past the end of the audio is silence. */
function sliceAudio(audio: PcmAudio, from: number, frames: number): PcmAudio {
  const channels = audio.channels.map((channel) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames && from + i < channel.length; i++) out[i] = channel[from + i];
    return out;
  });
  return { sampleRate: audio.sampleRate, channels };
}

/**
 * Renders `bars` bars of the parts from `fromTime`, for listening before a song is saved. The whole song is rendered first, so the level
 * the parts are set to is the one Generate sets, and then the window is cut from it. The notes are the window's, moved so it starts at 0.
 */
export function runBandPreview(request: BandRequest, samples: SampleSet, fromTime: number, bars = 4, onStage?: (stage: BandStage) => void): BandResult {
  onStage?.("generating");
  const generated = generate(request);
  const { start, end: windowEnd } = previewWindow(request.grid, fromTime, bars);
  const end = Math.min(windowEnd, request.lengthFrames / RENDER_RATE);
  const frames = Math.max(1, Math.round((end - start) * RENDER_RATE));
  const from = Math.round(start * RENDER_RATE);
  const inWindow = (list: NoteEvent[]): NoteEvent[] =>
    list.filter((note) => note.time >= start && note.time < end).map((note) => ({ ...note, time: note.time - start }));
  const full = render(request, generated, samples, request.lengthFrames, onStage);
  const result: BandResult = { ...full, notes: { drums: inWindow(generated.notes.drums), bass: inWindow(generated.notes.bass) } };
  if (full.drums) result.drums = sliceAudio(full.drums, from, frames);
  if (full.bass) result.bass = sliceAudio(full.bass, from, frames);
  // A preview plays a window of the song, which has no count before it and no vamp to leave.
  delete result.countIn;
  delete result.exits;
  return result;
}

/** The buffers of a result, so the worker can transfer them to the window instead of copying them. */
export function transferables(result: BandResult): ArrayBuffer[] {
  const exits = Object.values(result.exits ?? {}).flatMap((exit) => [exit.drums, exit.bass]);
  return [result.drums, result.bass, result.countIn?.audio, ...exits].flatMap((part) => (part ? part.channels.map((channel) => channel.buffer as ArrayBuffer) : []));
}
