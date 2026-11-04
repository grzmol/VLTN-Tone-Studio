// Planning the write of a song map into a saved song (spec 94). This file is pure: it takes the saved song and the map read from the text,
// and says what each part changes and what it replaces. The import dialog shows that plan, and writes the values the performer chose.
// Each part merges into the saved options and keeps every option it does not name, so a map never drops a setting it does not mention.

import { parseBandSettings, type BandSettings, type SectionOverride } from "../band/arrangement";
import { parseBassOverrides, type BassOverride } from "../band/bass-overrides";
import { KEY_NAMES } from "../performance/key";
import { parseSections } from "../performance/sections";
import { formatTime, type SongMap, type SongMapBassNote, type SongMapSection } from "./songmap";

/** The parts a song map can change. A part is offered only when the map holds it. */
export type SongMapPart = "tempo" | "key" | "sections" | "band" | "bassNotes" | "chart" | "notes";

/** A saved song as the import reads it: its tempo, its options (already parsed) and its chart. */
export interface SavedSong {
  bpm: string;
  options: Record<string, unknown>;
  chart: string;
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

/** The id a map section takes in the song: `map-1` for the first section. */
export function mapSectionId(index: number): string {
  return `map-${index + 1}`;
}

/** The key as the Performance screen saves it: a name from the key list, such as `F# minor` (the key override in SongKey). */
function keyName(map: SongMap): string {
  return map.key ? `${KEY_NAMES[map.key.tonic]} ${map.key.mode}` : "";
}

function hasTempo(map: SongMap): boolean {
  return map.bpm !== undefined || map.beatsPerBar !== undefined || map.firstBeat !== undefined;
}

/** The meter as written in the map, such as `6/8`. A map with only a beat count gets `/4`, as the song map writer does. */
function meterOf(map: SongMap): string | undefined {
  return map.meterText ?? (map.beatsPerBar === undefined ? undefined : `${map.beatsPerBar}/4`);
}

function tempoSummary(map: SongMap): string {
  const items = [
    map.bpm === undefined ? "" : `${map.bpm} BPM`,
    meterOf(map) ?? "",
    map.firstBeat === undefined ? "" : `first beat ${formatTime(map.firstBeat)}`,
  ].filter(Boolean);
  return `Tempo ${items.join(", ")}`;
}

/** The tempo values the saved song holds that the map would change, written as they read. */
function tempoReplaces(saved: SavedSong, options: Record<string, unknown>, map: SongMap): string | null {
  const items: string[] = [];
  if (map.bpm !== undefined && saved.bpm.trim() && Number(saved.bpm) !== roundedBpm(map.bpm)) items.push(`${saved.bpm} BPM`);
  if (map.firstBeat !== undefined && typeof options.firstBeat === "number" && Math.abs(options.firstBeat - map.firstBeat) > BEAT_EPSILON_S) {
    items.push(`first beat ${formatTime(options.firstBeat)}`);
  }
  if (map.beatsPerBar !== undefined && typeof options.beats === "number" && options.beats !== map.beatsPerBar) items.push(`${options.beats}/4`);
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

/**
 * Applies the chosen band parts to the band settings: the song style, and the section overrides. The overrides are built for the map's
 * sections only, so an override for a section that is no longer in the song is removed.
 */
function applyBandSections(band: BandSettings, map: SongMap): void {
  if (map.style) band.style = map.style;
  const sections: Record<string, SectionOverride> = {};
  map.sections.forEach((section, index) => {
    const id = mapSectionId(index);
    sections[id] = overrideOf(section, band.parts, band.sections[id] ?? {});
  });
  band.sections = sections;
}

/** The bass notes of the map, as the band saves them. An octave the map does not give is left out. */
function bassOverridesOf(notes: SongMapBassNote[]): BassOverride[] {
  return parseBassOverrides(notes.map(({ start, end, pc, octave }) => (octave === undefined ? { start, end, pc } : { start, end, pc, octave })));
}

/**
 * Plans the write of a song map into a saved song: the parts the map holds, what each one does and replaces, and the values the chosen
 * parts write. Nothing is written here. `values` is pure, so applying the same map twice gives the same values.
 */
export function planSongMap(saved: SavedSong, map: SongMap): SongMapPlan {
  const options = saved.options;
  const parts: SongMapPartPlan[] = [];
  if (hasTempo(map)) parts.push({ part: "tempo", summary: tempoSummary(map), replaces: tempoReplaces(saved, options, map) });
  if (map.key) {
    const previous = typeof options.songKey === "string" ? options.songKey : "";
    parts.push({ part: "key", summary: `Key ${keyName(map)}`, replaces: previous && previous !== keyName(map) ? `Replaces ${previous}` : null });
  }
  if (map.sections.length) {
    const existing = parseSections(options.sections).length;
    parts.push({
      part: "sections",
      summary: counted(map.sections.length, "section"),
      replaces: existing ? `Replaces your ${counted(existing, "section")}` : null,
    });
    parts.push({ part: "band", summary: `Drums and bass for ${counted(map.sections.length, "section")}`, replaces: null });
  }
  if (map.bassNotes.length) {
    const existing = parseBandSettings(options.band).bassOverrides.length;
    parts.push({
      part: "bassNotes",
      summary: counted(map.bassNotes.length, "bass note"),
      replaces: existing ? `Replaces your ${counted(existing, "bass note")}` : null,
    });
  }
  if (map.chart?.trim()) {
    parts.push({ part: "chart", summary: "Chart", replaces: saved.chart.trim() ? "Replaces your chart" : null });
  }
  if (map.notes?.trim()) {
    const previous = typeof options.songMapNotes === "string" ? options.songMapNotes : "";
    parts.push({
      part: "notes",
      summary: `Notes: ${notesSummary(map.notes)}`,
      replaces: previous.trim() && previous !== map.notes ? "Replaces your saved notes" : null,
    });
  }

  return {
    parts,
    values(chosen) {
      const picked = new Set(chosen);
      const values: Record<string, string> = {};
      const next: Record<string, unknown> = { ...options };
      let optionsChanged = false;

      if (picked.has("tempo") && hasTempo(map)) {
        if (map.bpm !== undefined) values[":bpm"] = String(roundedBpm(map.bpm));
        next.tempoSource = "manual";
        if (map.firstBeat !== undefined) next.firstBeat = map.firstBeat;
        if (map.beatsPerBar !== undefined) {
          next.beats = map.beatsPerBar;
          next.beatsSource = "manual";
        }
        optionsChanged = true;
      }
      if (picked.has("key") && map.key) {
        next.songKey = keyName(map);
        optionsChanged = true;
      }
      if (picked.has("sections") && map.sections.length) {
        next.sections = map.sections.map((section, index) => ({
          id: mapSectionId(index),
          name: section.name,
          start: section.start,
          end: section.end,
          mode: "continue",
        }));
        optionsChanged = true;
      }
      // The band is written only with the sections, so its overrides always name sections the song has.
      const bandChosen = picked.has("band") && picked.has("sections") && map.sections.length > 0;
      const bassChosen = picked.has("bassNotes") && map.bassNotes.length > 0;
      if (bandChosen || bassChosen) {
        const band = parseBandSettings(options.band);
        if (bandChosen) applyBandSections(band, map);
        if (bassChosen) band.bassOverrides = bassOverridesOf(map.bassNotes);
        next.band = band;
        optionsChanged = true;
      }
      if (picked.has("chart") && map.chart?.trim()) values[""] = map.chart;
      if (picked.has("notes") && map.notes?.trim()) {
        next.songMapNotes = map.notes;
        optionsChanged = true;
      }
      if (optionsChanged) values[":options"] = JSON.stringify(next);
      return values;
    },
  };
}
