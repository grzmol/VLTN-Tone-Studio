// Planning the write of a song map into a saved song (spec 94). This file is pure: it takes the saved song and the map read from the text,
// and says what each part changes and what it replaces. The import dialog shows that plan, and writes the values the performer chose.
// Each part merges into the saved options and keeps every option it does not name, so a map never drops a setting it does not mention.
// A part is offered only when it would change the song. Importing a map unchanged offers nothing and writes nothing.

import { parseBandSettings, type BandSettings, type SectionOverride } from "../band/arrangement";
import { parseBassOverrides, type BassOverride } from "../band/bass-overrides";
import { KEY_NAMES } from "../performance/key";
import { parseSections, type Section } from "../performance/sections";
import { formatTime, type SongMap, type SongMapBassNote, type SongMapSection } from "./songmap";

/** The parts a song map can change. A part is offered only when the map holds it and it would change the song. */
export type SongMapPart = "tempo" | "key" | "sections" | "band" | "bassNotes" | "chart" | "notes";

/** A saved song as the import reads it: its tempo, its options (already parsed), its chart and its lyrics chart. */
export interface SavedSong {
  bpm: string;
  options: Record<string, unknown>;
  chart: string;
  lyrics: string;
}

/** One part the map offers: what it will do, and what it replaces in the saved song (null when it replaces nothing). */
export interface SongMapPartPlan {
  part: SongMapPart;
  summary: string;
  replaces: string | null;
}

export interface SongMapPlan {
  parts: SongMapPartPlan[];
  /** The settings to write for the chosen parts: `:bpm`, `:options` and the chart (the empty suffix). An empty choice gives no settings. */
  values(chosen: readonly SongMapPart[]): Record<string, string>;
}

/** The longest notes text the summary shows before it is cut. */
const SUMMARY_NOTES_LENGTH = 60;
/** Two first beats closer than this are the same time. */
const BEAT_EPSILON_S = 0.005;
/** A map section and a saved section start at the same time when their starts are this close, in seconds. */
const START_MATCH_S = 0.05;

/** The id a map section takes in the song when no saved section is kept for it: `map-1` for the first section. */
export function mapSectionId(index: number): string {
  return `map-${index + 1}`;
}

/** The key as the Performance screen saves it: a name from the key list, such as `F# minor` (the key override in SongKey). */
function keyName(map: SongMap): string {
  return map.key ? `${KEY_NAMES[map.key.tonic]} ${map.key.mode}` : "";
}

/** The meter as written in the map, such as `6/8`. A map with only a beat count gets `/4`, as the song map writer does. */
function meterOf(map: SongMap): string | undefined {
  return map.meterText ?? (map.beatsPerBar === undefined ? undefined : `${map.beatsPerBar}/4`);
}

/** The tempo values the map holds that differ from the saved song. A value that matches is not written, so its source stays as it was. */
interface TempoDiff {
  bpm: boolean;
  firstBeat: boolean;
  beats: boolean;
}

function tempoDiffOf(saved: SavedSong, map: SongMap): TempoDiff {
  const options = saved.options;
  return {
    bpm: map.bpm !== undefined && (!saved.bpm.trim() || roundedBpm(Number(saved.bpm)) !== roundedBpm(map.bpm)),
    firstBeat: map.firstBeat !== undefined && (typeof options.firstBeat !== "number" || Math.abs(options.firstBeat - map.firstBeat) > BEAT_EPSILON_S),
    beats: map.beatsPerBar !== undefined && options.beats !== map.beatsPerBar,
  };
}

function tempoSummary(map: SongMap, diff: TempoDiff): string {
  const items = [
    diff.bpm && map.bpm !== undefined ? `${map.bpm} BPM` : "",
    diff.beats ? (meterOf(map) ?? "") : "",
    diff.firstBeat && map.firstBeat !== undefined ? `first beat ${formatTime(map.firstBeat)}` : "",
  ].filter(Boolean);
  return `Tempo ${items.join(", ")}`;
}

/** The tempo values the saved song holds that the map would change, written as they read. */
function tempoReplaces(saved: SavedSong, diff: TempoDiff): string | null {
  const options = saved.options;
  const items: string[] = [];
  if (diff.bpm && saved.bpm.trim()) items.push(`${saved.bpm} BPM`);
  if (diff.firstBeat && typeof options.firstBeat === "number") items.push(`first beat ${formatTime(options.firstBeat)}`);
  if (diff.beats && typeof options.beats === "number") items.push(`${options.beats}/4`);
  return items.length ? `Replaces ${items.join(", ")}` : null;
}

/** The tempo to the tenth of a BPM, as the map is written and the Performance screen keeps it. */
function roundedBpm(bpm: number): number {
  return Math.round(bpm * 10) / 10;
}

/** A count with its noun, in the singular for one: `1 bass note`, `5 bass notes`. */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function notesSummary(notes: string): string {
  const text = notes.replace(/\s+/g, " ").trim();
  return text.length > SUMMARY_NOTES_LENGTH ? `${text.slice(0, SUMMARY_NOTES_LENGTH - 1)}…` : text;
}

/** The band's drums and bass for one map section: its own change, on top of what the section already had. */
function overrideOf(section: SongMapSection, parts: BandSettings["parts"], previous: SectionOverride): SectionOverride {
  const next: SectionOverride = { ...previous };
  if (section.style) next.style = section.style;
  if (section.energy) next.energy = section.energy;
  if (section.loud) next.loud = section.loud;
  if (section.busy) next.busy = section.busy;
  if (section.drums !== undefined || section.bass !== undefined) {
    next.play = {
      drums: section.drums ?? previous.play?.drums ?? parts.drums,
      bass: section.bass === undefined ? (previous.play?.bass ?? parts.bass) : section.bass !== "off",
    };
  }
  if (section.bass !== undefined && section.bass !== "off") next.bassPart = section.bass;
  return next;
}

/** A saved section is the same section when every field the song keeps is equal. */
function sameSection(a: Section, b: Section): boolean {
  return a.id === b.id && a.name === b.name && a.start === b.start && a.end === b.end && a.mode === b.mode && a.color === b.color && a.source === b.source;
}

/**
 * Pairs each map section with the saved section it is: one that starts at the same time (see `START_MATCH_S`), with the same name, or the
 * only unpaired saved section that starts there. A saved section pairs with one map section at most.
 */
function pairSections(saved: readonly Section[], map: readonly SongMapSection[]): (Section | null)[] {
  const used = new Set<Section>();
  return map.map((section) => {
    const starts = saved.filter((item) => !used.has(item) && Math.abs(item.start - section.start) <= START_MATCH_S);
    const pick = starts.find((item) => item.name === section.name) ?? (starts.length === 1 ? starts[0] : undefined);
    if (!pick) return null;
    used.add(pick);
    return pick;
  });
}

/** What the sections become. A paired section keeps its id, mode, colour and source; a new one takes the first free `map-<n>` id. */
interface SectionsPlan {
  /** The song's sections after the write, in the map's order. */
  sections: Section[];
  /** The id of each map section after the write. */
  ids: string[];
  /** The saved section each map section keeps, or null for a new one. */
  paired: (Section | null)[];
  /** Whether the write changes the song's sections at all. */
  changed: boolean;
}

function sectionsPlanOf(saved: readonly Section[], map: readonly SongMapSection[]): SectionsPlan {
  const paired = pairSections(saved, map);
  const taken = new Set(paired.flatMap((item) => (item ? [item.id] : [])));
  let counter = 0;
  const freshId = (): string => {
    do counter++;
    while (taken.has(`map-${counter}`));
    taken.add(`map-${counter}`);
    return `map-${counter}`;
  };
  const sections: Section[] = [];
  const ids: string[] = [];
  map.forEach((section, index) => {
    const item = paired[index];
    const id = item ? item.id : freshId();
    ids.push(id);
    sections.push(
      item
        ? { ...item, name: section.name, start: section.start, end: section.end }
        : { id, name: section.name, start: section.start, end: section.end, mode: "continue" },
    );
  });
  const changed = map.length > 0 && (sections.length !== saved.length || sections.some((section, index) => !sameSection(section, saved[index])));
  return { sections, ids, paired, changed };
}

/** Removes the band's section overrides for every id not in `keep`. */
function pruneBand(band: BandSettings, keep: readonly string[]): void {
  for (const id of Object.keys(band.sections)) if (!keep.includes(id)) delete band.sections[id];
}

/** A map section written to a song section id. */
interface Target {
  id: string;
  section: SongMapSection;
}

/**
 * The band settings after the write: the song style (when `style` is set), overrides pruned to `keep` (when given), and the overrides of the
 * target sections. An override with nothing in it is not kept, as the band reads it back the same way.
 */
function bandWith(options: Record<string, unknown>, map: SongMap, targets: readonly Target[], keep: readonly string[] | null, style: boolean): BandSettings {
  const band = parseBandSettings(options.band);
  if (style && map.style) band.style = map.style;
  if (keep) pruneBand(band, keep);
  for (const { id, section } of targets) {
    const next = overrideOf(section, band.parts, band.sections[id] ?? {});
    if (Object.keys(next).length) band.sections[id] = next;
    else delete band.sections[id];
  }
  return band;
}

/** Sorts the keys of every object, so two values with the same content compare equal whatever their key order. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

/** The bass notes of the map, as the band saves them. An octave the map does not give is left out. */
function bassOverridesOf(notes: SongMapBassNote[]): BassOverride[] {
  return parseBassOverrides(notes.map(({ start, end, pc, octave }) => (octave === undefined ? { start, end, pc } : { start, end, pc, octave })));
}

/**
 * Plans the write of a song map into a saved song: the parts the map would change, what each one does and replaces, and the values the
 * chosen parts write. Nothing is written here. `values` is pure, so applying the same map twice gives the same values.
 */
export function planSongMap(saved: SavedSong, map: SongMap): SongMapPlan {
  const options = saved.options;
  const savedSections = parseSections(options.sections);
  const sectionsPlan = sectionsPlanOf(savedSections, map.sections);
  const sectionsOffered = sectionsPlan.changed;
  const fullTargets: Target[] = map.sections.map((section, index) => ({ id: sectionsPlan.ids[index], section }));
  const matchedTargets: Target[] = [];
  map.sections.forEach((section, index) => {
    const item = sectionsPlan.paired[index];
    if (item) matchedTargets.push({ id: item.id, section });
  });
  // The band keeps the sections the song has after the write. When the sections change, overrides for the rest are removed.
  const bandOffered =
    map.sections.length > 0 &&
    !sameValue(bandWith(options, map, fullTargets, sectionsOffered ? sectionsPlan.ids : null, true), parseBandSettings(options.band));

  const tempo = tempoDiffOf(saved, map);
  const tempoOffered = tempo.bpm || tempo.firstBeat || tempo.beats;
  const previousKey = typeof options.songKey === "string" ? options.songKey : "";
  const keyOffered = !!map.key && previousKey !== keyName(map);
  const savedBass = parseBandSettings(options.band).bassOverrides;
  const bassOffered = map.bassNotes.length > 0 && !sameValue(bassOverridesOf(map.bassNotes), savedBass);
  const mapChart = map.chart?.trim() ?? "";
  // A chart that is only the song's lyrics is not a chart: the lyrics stay in their own track.
  const chartOffered = mapChart !== "" && saved.chart.trim() !== mapChart && !(saved.chart.trim() === "" && mapChart === saved.lyrics.trim());
  const previousNotes = typeof options.songMapNotes === "string" ? options.songMapNotes : "";
  const notesOffered = !!map.notes?.trim() && previousNotes.trim() !== map.notes.trim();

  const parts: SongMapPartPlan[] = [];
  if (tempoOffered) parts.push({ part: "tempo", summary: tempoSummary(map, tempo), replaces: tempoReplaces(saved, tempo) });
  if (keyOffered && map.key) parts.push({ part: "key", summary: `Key ${keyName(map)}`, replaces: previousKey ? `Replaces ${previousKey}` : null });
  if (sectionsOffered) {
    parts.push({
      part: "sections",
      summary: counted(map.sections.length, "section"),
      replaces: savedSections.length ? `Replaces your ${counted(savedSections.length, "section")}` : null,
    });
  }
  if (bandOffered) parts.push({ part: "band", summary: `Drums and bass for ${counted(map.sections.length, "section")}`, replaces: null });
  if (bassOffered) {
    parts.push({
      part: "bassNotes",
      summary: counted(map.bassNotes.length, "bass note"),
      replaces: savedBass.length ? `Replaces your ${counted(savedBass.length, "bass note")}` : null,
    });
  }
  if (chartOffered) parts.push({ part: "chart", summary: "Chart", replaces: saved.chart.trim() ? "Replaces your chart" : null });
  if (notesOffered && map.notes) {
    parts.push({ part: "notes", summary: `Notes: ${notesSummary(map.notes)}`, replaces: previousNotes.trim() ? "Replaces your saved notes" : null });
  }
  const offered = new Set(parts.map((part) => part.part));

  return {
    parts,
    values(chosen) {
      // Only a part the plan offers is written. A part that would change nothing is never written.
      const picked = new Set(chosen.filter((part) => offered.has(part)));
      const values: Record<string, string> = {};
      const next: Record<string, unknown> = { ...options };
      let optionsChanged = false;

      if (picked.has("tempo")) {
        if (tempo.bpm && map.bpm !== undefined) values[":bpm"] = String(roundedBpm(map.bpm));
        if (tempo.bpm || tempo.firstBeat) next.tempoSource = "manual";
        if (tempo.firstBeat && map.firstBeat !== undefined) next.firstBeat = map.firstBeat;
        if (tempo.beats && map.beatsPerBar !== undefined) {
          next.beats = map.beatsPerBar;
          next.beatsSource = "manual";
        }
        optionsChanged = true;
      }
      if (picked.has("key") && map.key) {
        next.songKey = keyName(map);
        optionsChanged = true;
      }
      const sectionsChosen = picked.has("sections") && sectionsOffered;
      if (sectionsChosen) {
        next.sections = sectionsPlan.sections;
        optionsChanged = true;
      }
      const bandChosen = picked.has("band") && bandOffered;
      const bassChosen = picked.has("bassNotes") && bassOffered;
      if (bandChosen || bassChosen || sectionsChosen) {
        // With the sections written, the band is pruned to the sections the song now has. Its drums and bass are written only when chosen.
        const targets = sectionsChosen ? fullTargets : matchedTargets;
        const band = bandWith(options, map, bandChosen ? targets : [], sectionsChosen ? sectionsPlan.ids : null, bandChosen);
        if (bassChosen) band.bassOverrides = bassOverridesOf(map.bassNotes);
        next.band = band;
        optionsChanged = true;
      }
      if (picked.has("chart") && chartOffered) values[""] = map.chart ?? "";
      if (picked.has("notes") && notesOffered && map.notes) {
        next.songMapNotes = map.notes;
        optionsChanged = true;
      }
      if (optionsChanged) values[":options"] = JSON.stringify(next);
      return values;
    },
  };
}
