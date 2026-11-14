import { rhythmTempo } from "./rhythm-tempo";
import { lrcTime, parseChart } from "./chart";
import { parseSections, type Section } from "./sections";
import { playedTrimStart, storedShape } from "./song-shape";
import { RHYTHM_METERS, type RhythmMeter } from "../band/rhythm-export";

export const RHYTHM_PEDAL_ID = "boss-rc10r";
export const RHYTHM_CONTROLS = [
  { key: "start", action: "rhythm-start", setting: "RHY START CC", initial: 80 },
  { key: "division", action: "rhythm-division", setting: "RHY DIVISION CC", initial: 81 },
  { key: "fill", action: "fill", setting: "RHY FILLIN CC", initial: 82 },
  { key: "stop", action: "rhythm-stop", setting: "RHY STOP CC", initial: 83 },
] as const;
export interface RhythmControls {
  channel: number;
  start: number;
  division: number;
  fill: number;
  stop: number;
}
export function rhythmControlOverrides(library: { channels: Record<string, number>; assignments: Record<string, number> }): Partial<RhythmControls> {
  const result: Partial<RhythmControls> = {};
  const channel = library.channels[RHYTHM_PEDAL_ID];
  if (channel !== undefined) result.channel = channel;
  for (const { key, action } of RHYTHM_CONTROLS) {
    const cc = library.assignments[`${RHYTHM_PEDAL_ID}:${action}`];
    if (cc !== undefined) result[key] = cc;
  }
  return result;
}
export interface RhythmAutomationSong {
  key: string;
  title: string;
  duration: number;
  settings: Record<string, string>;
}
export type RhythmPattern = 1 | 2;
export interface RhythmAutomationDraft {
  version: 1;
  memory: number;
  /** Integer quarter-note BPM on the pedal; it can differ from a source recording's measured tempo. */
  bpm: number;
  start: number;
  /** Song time at which the ending should begin, after the stop command's measure-end wait. */
  endingAt: number;
  introBars: number;
  /** Division changes include a fill. Their lead is adjustable because the pedal decides when it changes. */
  changeLeadBars: number;
  fills: boolean;
  patterns: Record<string, RhythmPattern>;
}
export interface RhythmAutomationEvent {
  time: number | "load" | "stop";
  label: string;
  commands: string[];
}
export interface RhythmAutomationPlan {
  events: RhythmAutomationEvent[];
  warnings: string[];
  sections: Section[];
  firstPattern: RhythmPattern;
  barSeconds: number;
  chart: string;
}
const BEGIN = "// RC-10R automatic rhythm: begin";
const END = "// RC-10R automatic rhythm: end";
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function rhythmSongOptions(song: RhythmAutomationSong): Record<string, unknown> {
  try {
    return object(JSON.parse(song.settings[":options"] || "{}"));
  } catch {
    return {};
  }
}

function timing(song: RhythmAutomationSong) {
  const options = rhythmSongOptions(song);
  const exported = object(options.rhythmExport);
  const meter = typeof exported.meter === "string" && Object.hasOwn(RHYTHM_METERS, exported.meter) ? (exported.meter as RhythmMeter) : null;
  const bpm = finite(exported.bpm) ? exported.bpm : Number(song.settings[":bpm"]);
  const beats = meter ? RHYTHM_METERS[meter].pulses : integer(options.beats, 1, 12) ? options.beats : 4;
  // The native bank stores integer quarter-note BPM. Use that same rounding, including compound meter.
  const quarters = meter ? RHYTHM_METERS[meter].quarters : 1;
  const barSeconds = (60 * beats * quarters) / rhythmTempo(bpm, meter === "6/8").quarterBpm;
  const start = Math.max(playedTrimStart(options) ?? 0, finite(options.firstBeat) ? options.firstBeat : 0);
  const end = Math.min(song.duration, storedShape(options).trimEnd ?? song.duration);
  return { options, exported, sections: parseSections(options.sections), bpm, start, end, barSeconds, barQuarters: beats * quarters };
}

/** Suggestions are editable; unnamed passages keep Pattern 1 instead of inventing a third pedal pattern. */
export function suggestRhythmAutomation(song: RhythmAutomationSong, memory: number): RhythmAutomationDraft {
  const { options, exported, sections, start, end, barSeconds } = timing(song);
  const parts = object(exported.parts);
  const part2 = object(parts.pattern2);
  const pattern2Section = sections.find((section) => section.id === part2.source);
  const pattern2Name = pattern2Section?.name.replace(/\s+\d+$/, "").toLowerCase();
  const ending = sections.at(-1);
  const saved = object(options.rhythmAutomation);
  const storedPatterns = object(saved.patterns);
  const patterns = Object.fromEntries(
    sections.map((section): [string, RhythmPattern] => [
      section.id,
      storedPatterns[section.id] === 1 || storedPatterns[section.id] === 2
        ? storedPatterns[section.id] === 2
          ? 2
          : 1
        : /^(?:final\s+)?chorus\b/i.test(section.name) || (pattern2Name && section.name.replace(/\s+\d+$/, "").toLowerCase() === pattern2Name)
          ? 2
          : 1,
    ]),
  );
  return {
    version: 1,
    memory,
    bpm: integer(saved.bpm, 40, 350)
      ? saved.bpm
      : rhythmTempo(finite(exported.bpm) ? exported.bpm : Number(song.settings[":bpm"]), exported.meter === "6/8").quarterBpm,
    start: finite(saved.start) ? saved.start : start,
    endingAt: finite(saved.endingAt)
      ? saved.endingAt
      : ending && /outro|ending/i.test(ending.name)
        ? Math.max(start, Math.min(end, ending.start))
        : Math.max(start, end - (Number.isFinite(barSeconds) ? barSeconds : 0)),
    introBars: integer(saved.introBars, 0, 32) ? saved.introBars : integer(object(parts.intro).bars, 1, 32) ? Number(object(parts.intro).bars) : 1,
    changeLeadBars: finite(saved.changeLeadBars) && saved.changeLeadBars >= 0 && saved.changeLeadBars <= 2 ? saved.changeLeadBars : 1,
    fills: saved.fills !== false,
    patterns,
  };
}

/** Save musical choices and relative timing, rather than freezing the current tempo and trim into the playable cues. */
function automaticReference(song: RhythmAutomationSong): string {
  const options = rhythmSongOptions(song);
  return JSON.stringify([
    Number(song.settings[":bpm"]) || 120,
    song.duration,
    options.firstBeat ?? 0,
    options.beats ?? 4,
    options.trimStart,
    options.trimEnd,
    (options.analysis as { silence?: unknown } | undefined)?.silence,
    options.sections,
    options.rhythmExport,
    options.endBehaviour,
  ]);
}
export function automaticRhythmSettings(song: RhythmAutomationSong, draft: RhythmAutomationDraft, controls: RhythmControls): Record<string, unknown> {
  const options = rhythmSongOptions(song);
  const clean = {
    ...song,
    settings: {
      ...song.settings,
      ":bpm": Number(song.settings[":bpm"]) > 0 ? song.settings[":bpm"] : String(draft.bpm),
      ":options": JSON.stringify({ ...options, rhythmAutomation: undefined }),
    },
  };
  const defaults = suggestRhythmAutomation(clean, draft.memory);
  return {
    ...draft,
    controls,
    followSong: true,
    referenceTempo: song.settings[":bpm"] ?? "",
    referenceExportTempo: object(options.rhythmExport).bpm ?? null,
    referenceMeter: object(options.rhythmExport).meter ?? null,
    referenceInputs: automaticReference(song),
    startOffset: draft.start - defaults.start,
    endingOffset: draft.endingAt - defaults.endingAt,
    followIntro: draft.introBars === defaults.introBars,
  };
}

/** Recomputed wherever a song is played or checked, including unopened playlist songs. Never writes back stale snapshots. */
export function currentRhythmAutomation(song: RhythmAutomationSong): { draft: RhythmAutomationDraft; controls: RhythmControls } | null {
  const options = rhythmSongOptions(song);
  const saved = object(options.rhythmAutomation);
  if (saved.version !== 1 || saved.followSong !== true) return null;
  const clean = { ...song, settings: { ...song.settings, ":options": JSON.stringify({ ...options, rhythmAutomation: undefined }) } };
  const defaults = suggestRhythmAutomation(clean, Number(saved.memory));
  const draft = suggestRhythmAutomation(song, Number(saved.memory));
  const controls = object(saved.controls);
  const configuredControls = {
    channel: Number(controls.channel),
    start: Number(controls.start),
    division: Number(controls.division),
    fill: Number(controls.fill),
    stop: Number(controls.stop),
  };
  if (saved.referenceInputs === automaticReference(song)) return { draft, controls: configuredControls };
  const meter = object(options.rhythmExport).meter;
  if ((song.settings[":bpm"] ?? "") !== saved.referenceTempo) draft.bpm = rhythmTempo(Number(song.settings[":bpm"]), meter === "6/8").quarterBpm;
  else if (
    (saved.referenceExportTempo !== undefined && saved.referenceExportTempo !== (object(options.rhythmExport).bpm ?? null)) ||
    (saved.referenceMeter !== undefined && saved.referenceMeter !== (meter ?? null))
  )
    draft.bpm = defaults.bpm;
  const { start, end, barQuarters, exported } = timing(song);
  const barSeconds = (60 * barQuarters) / draft.bpm;
  draft.start = Math.max(start, defaults.start + (finite(saved.startOffset) ? saved.startOffset : 0));
  if (saved.followIntro === true) draft.introBars = defaults.introBars;
  const endingBars = object(object(exported.parts).ending).bars;
  const endingLength = (integer(endingBars, 1, 32) ? endingBars : 1) * barSeconds;
  const last = parseSections(options.sections)
    .filter((section) => section.start < end)
    .at(-1);
  const endingAnchor = last && /outro|ending/i.test(last.name) ? last.start : end - endingLength;
  draft.endingAt = Math.min(end - endingLength, endingAnchor + (finite(saved.endingOffset) ? saved.endingOffset : 0));
  return {
    draft,
    controls: configuredControls,
  };
}

export function currentRhythmChart(song: RhythmAutomationSong, controls: Partial<RhythmControls> = {}): string {
  const current = currentRhythmAutomation(song);
  return current ? buildRhythmAutomation(song, current.draft, { ...current.controls, ...controls }).chart : (song.settings[""] ?? "");
}

/** Replaces only the app's generated block. Missing or duplicated markers are refused instead of deleting chart text. */
export function replaceRhythmAutomation(chart: string, block: string): string {
  const lines = chart.split(/\r?\n/);
  const begins = lines.flatMap((line, index) => (line === BEGIN ? [index] : []));
  const ends = lines.flatMap((line, index) => (line === END ? [index] : []));
  if (!begins.length && !ends.length) return block ? `${chart}${chart && !chart.endsWith("\n") ? "\n" : ""}${block}` : chart;
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0])
    throw new Error("The automatic rhythm cue markers were edited. Restore their begin/end lines in Lyrics & chords before rebuilding.");
  const newline = chart.includes("\r\n") ? "\r\n" : "\n";
  const before = lines.slice(0, begins[0]);
  const after = lines.slice(ends[0] + 1);
  const prefix = before.length ? before.join(newline) + newline : "";
  return prefix + (block ? block.split("\n").join(newline) + (after.length ? newline : "") : "") + after.join(newline);
}

/** Builds ordinary chart cues, so song saves, playlist handovers, arming and the existing MIDI scheduler all use the same path. */
export function buildRhythmAutomation(song: RhythmAutomationSong, draft: RhythmAutomationDraft, controls: RhythmControls): RhythmAutomationPlan {
  if (!integer(draft.memory, 1, 99)) throw new Error("Choose a pedal memory from 1–99.");
  if (!integer(controls.channel, 1, 16)) throw new Error("Choose a MIDI channel from 1–16.");
  const controllers = RHYTHM_CONTROLS.map(({ key }) => controls[key]);
  if (controllers.some((cc) => !integer(cc, 1, 95) || (cc > 31 && cc < 64))) throw new Error("Control numbers must be 1–31 or 64–95.");
  if (new Set(controllers).size !== controllers.length) throw new Error("Give Start, Change pattern, Fill and Stop different control numbers.");
  const { sections, end, start, barQuarters, exported, options } = timing(song);
  const barSeconds = (60 * barQuarters) / draft.bpm;
  if (!finite(song.duration) || song.duration <= 0 || !integer(draft.bpm, 40, 350) || !finite(barSeconds) || barSeconds <= 0)
    throw new Error("Save the song's tempo and duration before setting up its pedal rhythm.");
  if (!sections.length) throw new Error("Add song sections before setting up automatic rhythm changes.");
  if (sections.some((section, i) => i > 0 && section.start < sections[i - 1].end - 0.001)) throw new Error("Fix overlapping song sections first.");
  if (sections.some((section) => section.mode !== "continue"))
    throw new Error("Automatic pedal rhythms need sections set to Continue. Loops and jumps need manual pedal control.");
  if (storedShape(options).endBehaviour === "loop") throw new Error("Turn off whole-song looping before setting up automatic pedal rhythms.");
  if (!finite(draft.start) || !finite(draft.endingAt) || draft.start < start - 0.001 || draft.endingAt > end || draft.endingAt <= draft.start)
    throw new Error("Rhythm start and ending must be in the song's played range, with the ending after the start.");
  if (!integer(draft.introBars, 0, 32) || !finite(draft.changeLeadBars) || draft.changeLeadBars < 0 || draft.changeLeadBars > 2)
    throw new Error("Choose 0–32 intro bars and a pattern-change lead from 0–2 bars.");
  const patternStart = draft.start + draft.introBars * barSeconds;
  if (patternStart >= draft.endingAt) throw new Error("The intro leaves no room for the repeating patterns before the ending.");
  const body = sections.filter((section) => section.end > patternStart + 0.001 && section.start < draft.endingAt - 0.001);
  if (!body.length) throw new Error("No song sections fall between the intro and ending.");
  if (body.some((section) => draft.patterns[section.id] !== 1 && draft.patterns[section.id] !== 2))
    throw new Error("Choose Pattern 1 or Pattern 2 for every section.");
  const warnings: string[] = [];
  if (exported.version !== 1)
    warnings.push("No export choices are saved for this song. Check its tempo, intro length and Pattern 1/2 against the rhythm on the pedal.");
  const endingBars = object(object(exported.parts).ending).bars;
  const endingEnd = draft.endingAt + (integer(endingBars, 1, 32) ? endingBars : 1) * barSeconds;
  if (Math.abs(endingEnd - end) > 0.15)
    warnings.push(`The exported ending would finish around ${lrcTime(endingEnd)}; the song plays to ${lrcTime(end)}. Review when the ending begins.`);
  if (sections.some((section) => /bridge|solo|break|pre.?chorus/i.test(section.name)))
    warnings.push("The pedal has two repeating patterns. Review the choices for bridges, solos, breaks and pre-choruses.");
  const pulse = (key: (typeof RHYTHM_CONTROLS)[number]["key"]) => [`cc ${controls.channel} ${controls[key]} 127`, `cc ${controls.channel} ${controls[key]} 0`];
  const events: RhythmAutomationEvent[] = [
    { time: "load", label: `RC-10R: Recall memory ${draft.memory}`, commands: [`pc ${controls.channel} ${draft.memory - 1}`] },
    { time: draft.start, label: "RC-10R: Start rhythm", commands: pulse("start") },
  ];
  let previous = draft.patterns[body[0].id];
  let previousStart = patternStart;
  for (let i = 1; i < body.length; i++) {
    const section = body[i];
    const pattern = draft.patterns[section.id];
    const change = pattern !== previous;
    const at = section.start - (change ? draft.changeLeadBars : 1) * barSeconds;
    if (change || draft.fills) {
      if (at < previousStart - 0.001) {
        if (change) throw new Error(`${section.name}: the preceding passage is too short for this change lead. Reduce the lead or choose the same pattern.`);
        warnings.push(`${section.name}: skipped a fill because the preceding passage is shorter than one bar.`);
      } else
        events.push({
          time: Math.max(patternStart, at),
          label: `RC-10R: ${change ? `Change to Pattern ${pattern}` : "Fill"} for ${section.name}`,
          commands: pulse(change ? "division" : "fill"),
        });
    }
    const bars = (section.start - draft.start) / barSeconds;
    if (Math.abs(bars - Math.round(bars)) * barSeconds > 0.1)
      warnings.push(`${section.name} is off the pedal's steady bar grid. Check the export tempo and cue timing.`);
    previous = pattern;
    previousStart = Math.max(patternStart, section.start);
  }
  // MEAS END+ENDING waits for the next bar. Send during the preceding measure, not on the requested ending's downbeat.
  const stopTime = draft.endingAt - Math.min(0.1, barSeconds / 4);
  if (stopTime <= patternStart || events.some((event) => typeof event.time === "number" && event.time > stopTime))
    throw new Error("The last pattern change overlaps the ending. Move the ending later or reduce the change lead.");
  events.push({ time: stopTime, label: "RC-10R: Play ending and stop", commands: pulse("stop") });
  events.push({ time: "stop", label: "RC-10R: Stop when playback stops", commands: pulse("stop") });
  const block = [
    BEGIN,
    ...events.map((event) => {
      // Trigger controls are never chased when playback starts halfway through a song.
      const tokens = event.commands.map((command) => (typeof event.time === "number" ? `{midi:${command}}` : `{midi@${event.time}:${command}}`)).join(" ");
      return `${typeof event.time === "number" ? `${lrcTime(event.time)} {nochase} ` : ""}{label:${event.label.replace(/[{}]/g, "")}} ${tokens}`;
    }),
    END,
  ].join("\n");
  const chart = replaceRhythmAutomation(song.settings[""] ?? "", block);
  // Parse only generated cues: an unrelated macro in the performer's chart need not be resolved here.
  parseChart(block);
  return { events, warnings, sections: body, firstPattern: draft.patterns[body[0].id], barSeconds, chart };
}
