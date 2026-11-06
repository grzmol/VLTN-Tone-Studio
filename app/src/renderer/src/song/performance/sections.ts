/*
 * Song sections: named spans of a song (Intro, Verse, Chorus …) and the rules that decide what happens when playback reaches
 * the end of one. Everything here is pure. The player schedules the audio and the session schedules the MIDI; neither decides
 * the arrangement itself, so the rules can be tested without audio or MIDI.
 *
 * A decision is taken DECISION_LEAD_S before its boundary. The MIDI scheduler looks ahead about a second, so a jump that is
 * decided later than that could let cues from the old passage reach the pedal after the boundary.
 */

export const SECTION_MODES = ["continue", "repeat-once", "loop", "skip", "pause"] as const;
export type SectionMode = (typeof SECTION_MODES)[number];

export const SECTION_MODE_LABELS: Record<SectionMode, string> = {
  continue: "Continue",
  "repeat-once": "Repeat once",
  loop: "Loop until released",
  skip: "Skip",
  pause: "Pause at end",
};

export interface Section {
  id: string;
  name: string;
  /** Song time in seconds */
  start: number;
  /** Song time in seconds, after `start` */
  end: number;
  color?: string;
  /** What happens at the end of the section when nobody has asked for a jump */
  mode: SectionMode;
}

/** Up to this many sections per song. */
export const MAX_SECTIONS = 64;
/** The longest a section name may be. */
export const MAX_SECTION_NAME = 40;
/** A section shorter than this is not a section. */
export const MIN_SECTION_S = 0.1;
/** Decisions are taken this long before their boundary. Keep it above the USB MIDI lookahead (0.2 s). */
export const DECISION_LEAD_S = 2;
/** Times closer than this are the same time. */
const EPSILON = 0.001;
/** Bar alignment is checked to within this many seconds. */
const BAR_TOLERANCE_S = 0.01;

/** Live state: what the performer has asked for since the song started. Session-only unless saved as a default. */
export interface SectionLive {
  /** Section that loops until released */
  loop: string | null;
  /** Section the next boundary jumps to */
  jump: string | null;
  /** Sections that have already repeated once on this pass */
  repeated: string[];
  /** Sections whose stored loop mode the performer released */
  released: string[];
}

export const NO_LIVE: SectionLive = { loop: null, jump: null, repeated: [], released: [] };

/** What to do at a boundary. A jump with `target: null` is a skip, which has no section to land on. */
export type SectionAction = { kind: "continue" } | { kind: "pause" } | { kind: "jump"; to: number; target: string | null };

export interface SectionBoundary {
  /** Song time of the boundary, in seconds */
  at: number;
  action: SectionAction;
  /** Live state once the boundary has been taken */
  live: SectionLive;
}

export const isSectionMode = (value: unknown): value is SectionMode => (SECTION_MODES as readonly unknown[]).includes(value);

/** Sections in song order. */
export function sortedSections(sections: readonly Section[]): Section[] {
  return [...sections].sort((a, b) => a.start - b.start);
}

/**
 * Reads the sections saved in a song's options. Entries that are not valid are dropped rather than failing the whole song,
 * and the list is capped at MAX_SECTIONS in song order.
 */
export function parseSections(raw: unknown): Section[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const sections: Section[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { id, name, start, end, color, mode } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end - start < MIN_SECTION_S || !isSectionMode(mode)) continue;
    seen.add(id);
    sections.push({
      id,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, MAX_SECTION_NAME) : "Section",
      start,
      end,
      mode,
      ...(typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? { color } : {}),
    });
  }
  return sortedSections(sections).slice(0, MAX_SECTIONS);
}

/** The section that holds `position`, by index in song order, or -1 between sections. */
export function sectionIndexAt(sections: readonly Section[], position: number): number {
  return sortedSections(sections).findIndex((s) => s.start <= position + EPSILON && position < s.end - EPSILON);
}

/** Moves `seconds` to the nearest beat of the grid. Without a tempo the time is returned unchanged. */
export function snapToBeat(seconds: number, bpm: number, firstBeat: number): number {
  if (!(bpm > 0)) return seconds;
  const interval = 60 / bpm;
  return Math.max(0, firstBeat + Math.round((seconds - firstBeat) / interval) * interval);
}

/** Whether `seconds` falls on a bar line of the grid (every `beats` beats from `firstBeat`). */
export function isBarAligned(seconds: number, bpm: number, beats: number, firstBeat: number): boolean {
  if (!(bpm > 0) || !(beats >= 1)) return true;
  const bar = (60 / bpm) * beats;
  const bars = (seconds - firstBeat) / bar;
  return Math.abs(bars - Math.round(bars)) * bar <= BAR_TOLERANCE_S;
}

/**
 * The sections as they play inside a trimmed range: a section is cut to the range, and one that is left shorter than a section may
 * be is dropped. Returns the same array when every section already lies inside the range, so callers can compare by identity.
 */
export function clampSections(sections: readonly Section[], range: { start: number; end: number }): Section[] {
  const inside = sections.every((s) => s.start >= range.start && s.end <= range.end);
  if (inside) return sections as Section[];
  return sections
    .map((s) => ({ ...s, start: Math.max(s.start, range.start), end: Math.min(s.end, range.end) }))
    .filter((s) => s.end - s.start >= MIN_SECTION_S);
}

export interface SectionIssue {
  code: "section-range" | "section-overlap" | "section-bar" | "section-trim";
  text: string;
}

/**
 * Preflight for the sections: a section past the end of the audio, sections that overlap, and boundaries that are not on a bar
 * line (a loop or a jump between them would land off the beat).
 */
export function sectionIssues(
  sections: readonly Section[],
  options: { duration: number; bpm?: number; beats?: number; firstBeat?: number; range?: { start: number; end: number } },
): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const ordered = sortedSections(sections);
  const range = options.range;
  for (const [i, section] of ordered.entries()) {
    if (range && (section.start < range.start - EPSILON || section.end > range.end + EPSILON))
      issues.push({
        code: "section-trim",
        text: `${section.name} (${section.start.toFixed(2)}–${section.end.toFixed(2)} s) is partly outside the trimmed range, so it plays cut short.`,
      });
    if (section.end > options.duration + EPSILON)
      issues.push({ code: "section-range", text: `${section.name} ends at ${section.end.toFixed(2)} s, after the ${options.duration.toFixed(2)} s audio.` });
    if (i > 0 && section.start < ordered[i - 1].end - EPSILON)
      issues.push({ code: "section-overlap", text: `${section.name} overlaps ${ordered[i - 1].name}. Only one section plays at a time.` });
    if (options.bpm && options.beats) {
      const firstBeat = options.firstBeat ?? 0;
      const misaligned = [section.start, section.end].filter((t) => !isBarAligned(t, options.bpm!, options.beats!, firstBeat));
      if (misaligned.length)
        issues.push({ code: "section-bar", text: `${section.name} does not start or end on a bar line. A loop or jump there lands off the beat.` });
    }
  }
  return issues;
}

/** Whether `section` repeats at its end: a live loop, or its stored loop mode unless the performer released it. */
function loops(section: Section, live: SectionLive): boolean {
  return live.loop === section.id || (section.mode === "loop" && !live.released.includes(section.id));
}

/** The live state once playback has left `id`: its one-off rules are forgotten. */
function leave(live: SectionLive, id: string): SectionLive {
  return {
    ...live,
    loop: live.loop === id ? null : live.loop,
    repeated: live.repeated.filter((x) => x !== id),
    released: live.released.filter((x) => x !== id),
  };
}

/**
 * The next boundary after `position` (song time), or null when there is none. The candidates are, in order of time:
 * - the end of the section being played, where a jump, a loop, a repeat, a pause or nothing happens;
 * - a skipped section's start, where playback jumps over it;
 * - the start of the next section, when the song is between sections (a pending jump lands there).
 *
 * A pending jump is consumed by the boundary that takes it. Loops and repeats are decided here, so a loop that is released
 * before its boundary simply does not repeat.
 */
export function nextBoundary(sections: readonly Section[], position: number, live: SectionLive): SectionBoundary | null {
  const ordered = sortedSections(sections);
  if (!ordered.length) return null;
  // A jump to a section that has since been deleted cannot be taken, so it is dropped rather than left armed.
  const armed = live.jump && ordered.some((s) => s.id === live.jump) ? live : { ...live, jump: null };
  const index = sectionIndexAt(ordered, position);
  if (index >= 0) return boundaryAtEnd(ordered, index, armed);
  // Between sections, or before the first one. A skipped section starting at or after this position comes first.
  const next = ordered.find((s) => s.start >= position - EPSILON);
  if (!next) return null;
  if (next.mode === "skip") return { at: next.start, action: { kind: "jump", to: next.end, target: null }, live: armed };
  const target = armed.jump ? ordered.find((s) => s.id === armed.jump) : undefined;
  if (target) return { at: next.start, action: { kind: "jump", to: target.start, target: target.id }, live: { ...armed, jump: null } };
  return { at: next.start, action: { kind: "continue" }, live: armed };
}

function boundaryAtEnd(ordered: Section[], index: number, live: SectionLive): SectionBoundary {
  const section = ordered[index];
  if (section.mode === "skip") return { at: section.end, action: { kind: "continue" }, live };
  const target = live.jump ? ordered.find((s) => s.id === live.jump) : undefined;
  if (target) {
    const next = { ...leave(live, section.id), jump: null };
    return { at: section.end, action: { kind: "jump", to: target.start, target: target.id }, live: next };
  }
  if (loops(section, live)) return { at: section.end, action: { kind: "jump", to: section.start, target: section.id }, live };
  if (section.mode === "repeat-once" && !live.repeated.includes(section.id))
    return { at: section.end, action: { kind: "jump", to: section.start, target: section.id }, live: { ...live, repeated: [...live.repeated, section.id] } };
  if (section.mode === "pause") return { at: section.end, action: { kind: "pause" }, live: leave(live, section.id) };
  // A skipped section that starts where this one ends is jumped over at the same boundary.
  const after = ordered[index + 1];
  if (after?.mode === "skip" && after.start <= section.end + EPSILON)
    return { at: section.end, action: { kind: "jump", to: after.end, target: null }, live: leave(live, section.id) };
  return { at: section.end, action: { kind: "continue" }, live: leave(live, section.id) };
}

/**
 * A jump to section `id` taken at song time `at` rather than at the next boundary: the performer's double tap. The session passes
 * a time far enough ahead that cues already queued still belong to the passage being left.
 */
export function immediateJump(sections: readonly Section[], at: number, live: SectionLive, id: string): SectionBoundary | null {
  const ordered = sortedSections(sections);
  const target = ordered.find((s) => s.id === id);
  if (!target) return null;
  const current = ordered[sectionIndexAt(ordered, at)];
  const next = current ? leave(live, current.id) : live;
  return { at, action: { kind: "jump", to: target.start, target: target.id }, live: { ...next, jump: null } };
}

/** Arms a jump: the next boundary goes to `id`. Tapping the armed section again does not disarm it. */
export function armJump(live: SectionLive, id: string): SectionLive {
  return { ...live, jump: id };
}

/** Cancels a pending jump. */
export function cancelJump(live: SectionLive): SectionLive {
  return live.jump ? { ...live, jump: null } : live;
}

/** Loops `id` until the performer releases it. */
export function startLoop(live: SectionLive, id: string): SectionLive {
  return { ...live, loop: id, released: live.released.filter((x) => x !== id) };
}

/** Releases a loop, whether it came from a live loop or from the section's stored mode. The current pass finishes, then playback moves on. */
export function releaseLoop(live: SectionLive, id: string): SectionLive {
  return { ...live, loop: live.loop === id ? null : live.loop, released: live.released.includes(id) ? live.released : [...live.released, id] };
}

/** Drops live state for sections that no longer exist. */
export function pruneLive(live: SectionLive, sections: readonly Section[]): SectionLive {
  const ids = new Set(sections.map((s) => s.id));
  return {
    loop: live.loop && ids.has(live.loop) ? live.loop : null,
    jump: live.jump && ids.has(live.jump) ? live.jump : null,
    repeated: live.repeated.filter((x) => ids.has(x)),
    released: live.released.filter((x) => ids.has(x)),
  };
}

/**
 * "Save as default": writes the live loop and release choices into the sections' stored modes. A live loop becomes the section's
 * loop mode; a released loop becomes continue. A pending jump is not a mode and is not saved.
 */
export function saveLiveAsDefault(sections: readonly Section[], live: SectionLive): Section[] {
  return sections.map((section) => {
    if (live.loop === section.id && section.mode !== "loop") return { ...section, mode: "loop" };
    if (live.released.includes(section.id) && section.mode === "loop") return { ...section, mode: "continue" };
    return section;
  });
}
