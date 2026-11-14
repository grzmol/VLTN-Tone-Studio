import { MIDI_TRIGGER_PATTERN, preparationWaitMs } from "./preparation-wait";
import type { PreparationRepeat } from "./preparation-repeat";
import { expandCommand, isLegacyCommand, type MidiMacro } from "./midi-macros";
import { isChordName, transposeChordName } from "./speed";

export { midiCommand } from "./midi-command";

/** When a trigger cue is sent: on load (armed), before the count-in, when playback starts or resumes, on pause or stop, or when the song reaches its end. */
export type MidiTrigger = "load" | "prepare" | "play" | "stop" | "end";

/**
 * A cue on song sections, `{midi@section Chorus: …}`. It is kept apart from the event triggers above because it has a time of its own once
 * the song's sections are known: `expandSectionCues` turns it into timed cues. `exact` is the quoted form, `"Chorus 2"`, which names one section.
 */
export interface SectionTarget {
  name: string;
  exact: boolean;
}

/** Where a cue's `{midi…}` token sits in the chart text: the line index and the character range on that line, plus the token as it was read. */
export interface CueSource {
  line: number;
  start: number;
  end: number;
  /** The token text, `{midi:pc 1 5}`. Editing checks the chart still has exactly this at the position. */
  text: string;
  /** Set on a timed cue whose line has one timestamp: the range of that timestamp, so an edit can move the cue. */
  stamp?: { start: number; end: number; text: string };
}

/** A timed line with one timestamp and several `{midi:…}` tokens, such as a pedal command sent as a bank select then a program change. */
export interface CueLine {
  /** The line index in the chart. */
  index: number;
  /** The whole line as it was read. Removing checks the chart still has exactly this line. */
  text: string;
}

export interface Cue {
  time: number;
  text: string;
  messages: number[][];
  label?: string;
  /** Recomputed from the song's current settings; edited through its automatic setup instead of as a frozen chart token. */
  managed?: "rhythm";
  /** `{chase}` forces this cue's PC/CC/SysEx to be replayed when starting mid-song; `{nochase}` never replays them. Unset uses the defaults. */
  chase?: boolean;
  /** Set on a `{midi@…}` trigger, which has no song time. `time` is 0 and is never used for scheduling. A section cue has `"section"`. */
  trigger?: MidiTrigger | "section";
  /** How a Before song command repeats. Missing preserves Every start. */
  prepareRepeat?: PreparationRepeat;
  /** Loading time after this preparation command line, in milliseconds. */
  prepareWaitMs?: number;
  /** Set with `trigger: "section"`: the section or sections the cue fires on. The cue has no time until `expandSectionCues` gives it one. */
  section?: SectionTarget;
  /**
   * The command text of each token, as the editor shows it: `pc 1 5 bank 0 2`, `$GP_LEAD`, or `@load pc 1 5` for a trigger. Only set when a
   * token is more than the original grammar or is a trigger, so charts that used only that grammar parse exactly as before.
   */
  tokens?: string[];
  /**
   * Where the cue's one `{midi…}` token is in the chart text. Left out when the cue can't be placed alone: a line with several tokens, or one
   * token shared by several timestamps. Those cues are changed in the chart text.
   */
  source?: CueSource;
  /**
   * Set instead of `source` when the cue is all the tokens on a line with one timestamp. The cue can then be removed as a whole, though its
   * tokens are still edited in the chart text.
   */
  line?: CueLine;
  /** Set on a cue read from the song's MIDI file rather than the chart. */
  fromFile?: true;
}

/** The editor's text for a section cue: `@section Chorus: pc 1 5`, with the name quoted when it names one section. */
export function sectionTokenText(target: SectionTarget, command: string): string {
  return `@section ${target.exact ? `"${target.name}"` : target.name}: ${command}`;
}

/** A section name without its trailing number, in lower case: "Chorus 2" and "chorus" are both "chorus". */
export function sectionBase(name: string): string {
  return name
    .trim()
    .replace(/\s+\d+$/, "")
    .toLowerCase();
}

/** Whether a section cue fires on a section of this name. The quoted form wants the whole name; the other form ignores the trailing number. */
export function sectionMatches(target: SectionTarget, sectionName: string): boolean {
  return target.exact ? target.name.trim().toLowerCase() === sectionName.trim().toLowerCase() : sectionBase(target.name) === sectionBase(sectionName);
}

/** The sections a section cue fires on, in song order. */
export function matchingSections<S extends { name: string; start: number }>(target: SectionTarget, sections: readonly S[]): S[] {
  return sections.filter((section) => sectionMatches(target, section.name)).sort((a, b) => a.start - b.start);
}

/**
 * Gives every section cue its times: one timed cue at the start of each section it matches. Moving or renaming a section moves its cues, and
 * nothing is copied into the chart. Other cues are returned as they were, and a chart without section cues comes back as the same array.
 * A section cue that matches no section gives no cues (preflight warns about it).
 */
export function expandSectionCues(cues: Cue[], sections: readonly { name: string; start: number }[]): Cue[] {
  if (!cues.some((cue) => cue.trigger === "section")) return cues;
  const expanded = cues.flatMap((cue): Cue[] => {
    if (cue.trigger !== "section" || !cue.section) return [cue];
    const { time: _time, trigger: _trigger, section: _section, tokens: _tokens, source: _source, ...rest } = cue;
    return matchingSections(cue.section, sections).map((section) => ({ ...rest, time: section.start }));
  });
  return expanded.sort((a, b) => a.time - b.time);
}

/** The section cues that match no section of the song, for the preflight warning. */
export function unmatchedSectionCues(cues: readonly Cue[], sections: readonly { name: string; start: number }[]): Cue[] {
  return cues.filter((cue) => cue.trigger === "section" && cue.section && !matchingSections(cue.section, sections).length);
}

/** The cues that have a song time. Triggers are kept in the chart and sent by the session, so they are left out of any timeline. */
export function timedCues(cues: readonly Cue[]): Cue[] {
  return cues.filter((cue) => !cue.trigger);
}

const TIMESTAMP = /\[(\d+):([0-5]\d(?:\.\d+)?)\]/g;
const TRIGGER = new RegExp(String.raw`\{midi@(${MIDI_TRIGGER_PATTERN}):([^}]*)\}`, "g");
/** `{midi@section Chorus: pc 1 5}` or, for one section, `{midi@section "Chorus 2": pc 1 5}`. */
const SECTION_TRIGGER = /\{midi@section\s+(?:"([^"}]*)"|([^":}]*?))\s*:([^}]*)\}/g;
const MIDI_TOKEN = /\{midi:([^}]+)\}/g;

/**
 * Moves every chord in the text by `steps` semitones. `flats` respells the chords (true for a flat key, false for a sharp one); without it
 * each chord keeps its own accidental. Lines without chords are returned unchanged.
 */
export function transpose(text: string, steps: number, flats?: boolean): string {
  return text.replace(/\[([^\]\s]+)\]/g, (match, chord: string) => (isChordName(chord) ? `[${transposeChordName(chord, steps, flats)}]` : match));
}

/** A heading line, such as `# Chorus`, shown as a label. Returns the label, or null for an ordinary line. */
export function headingLabel(text: string): string | null {
  const match = /^#\s+(\S.*)$/.exec(text.trim());
  return match ? match[1].trim() : null;
}

/** A `// …` comment starts at the beginning of a line or after a space, so a web address such as `http://` is never a comment. */
const COMMENT = /(^|\s)\/\/.*$/;

/** The text the stage shows: the comments are an editor note and are removed. */
export function stageText(text: string): string {
  return text.replace(COMMENT, "").trim();
}

/** The colour names a `{color:…}` span may use. Any other name is shown in the normal text colour. */
export const COLOUR_NAMES = ["red", "amber", "green", "blue", "violet"] as const;
/** `{color:red}` opens a coloured span and `{/color}` closes it. */
export const COLOUR_TAG = /\{color:([a-z]+)\}|\{\/color\}/g;

/**
 * Parses a chart. `macros` resolves `{midi:$CODE}` references; a reference to an unknown macro, a macro that refers to itself, or a
 * malformed command throws, so the song is rejected at load rather than during playback.
 */
export function parseChart(text: string, macros: readonly MidiMacro[] = []): Cue[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) => {
      // A `//` comment is an editor note, so only the code before it is parsed. The comment stays in the text, where the editor shows it and the stage hides it.
      const commentAt = line.search(COMMENT),
        code = commentAt < 0 ? line : line.slice(0, commentAt),
        comment = commentAt < 0 ? "" : line.slice(commentAt),
        gap = code.slice(code.trimEnd().length);
      let label = "";
      const content = code.replace(/\{label:([^}]+)\}/g, (_, value: string) => {
        label = value.trim().slice(0, 400);
        return "";
      });
      const hasChase = /\{chase\}/.test(content),
        hasNoChase = /\{nochase\}/.test(content);
      if (hasChase && hasNoChase) throw new Error(`Line ${index + 1}: use either {chase} or {nochase}, not both.`);
      const labelled = label ? { label } : {};
      if (/\{midi@/.test(content.replace(TRIGGER, "").replace(SECTION_TRIGGER, "")))
        throw new Error(
          `Line ${index + 1}: a MIDI trigger is {midi@load: …}, {midi@prepare: …}, {midi@prepare-beginning: …}, {midi@prepare-once: …}, {midi@play: …}, {midi@stop: …}, {midi@end: …} or {midi@section Name: …} with one command.`,
        );
      // Positions are read from the code part of the original line, since the label is cut out of `content`.
      const triggerCues: Cue[] = [...code.matchAll(TRIGGER)].map((t) => {
        const command = t[2].trim(),
          header = t[1].split(/\s+/)[0],
          wait = preparationWaitMs(t[1]);
        if (!command) throw new Error(`Line ${index + 1}: MIDI triggers need contents.`);
        const source = { line: index, start: t.index, end: t.index + t[0].length, text: t[0] };
        return {
          time: 0,
          text: "",
          messages: expandCommand(command, macros),
          trigger: (t[1].startsWith("prepare") ? "prepare" : t[1]) as Cue["trigger"],
          ...(header === "prepare-once" ? { prepareRepeat: "once" as const } : header === "prepare-beginning" ? { prepareRepeat: "beginning" as const } : {}),
          ...(wait !== undefined ? { prepareWaitMs: wait } : {}),
          tokens: [`@${t[1]} ${command}`],
          ...labelled,
          source,
        };
      });
      if (triggerCues.filter((cue) => cue.prepareWaitMs !== undefined).length > 1)
        throw new Error(`Line ${index + 1}: use one Wait after per preparation command line. Put separate waits on separate lines.`);
      const sectionCues: Cue[] = [...code.matchAll(SECTION_TRIGGER)].map((t): Cue => {
        const exact = t[1] !== undefined,
          name = (t[1] ?? t[2]).trim(),
          command = t[3].trim();
        if (!name) throw new Error(`Line ${index + 1}: a section cue needs a section name, as in {midi@section Chorus: pc 1 5}.`);
        if (!command) throw new Error(`Line ${index + 1}: MIDI triggers need contents.`);
        return {
          time: 0,
          text: "",
          messages: expandCommand(command, macros),
          trigger: "section",
          section: { name, exact },
          tokens: [sectionTokenText({ name, exact }, command)],
          ...labelled,
          ...(hasChase || hasNoChase ? { chase: hasChase } : {}),
          source: { line: index, start: t.index, end: t.index + t[0].length, text: t[0] },
        };
      });
      triggerCues.push(...sectionCues);
      const timestamps = [...content.matchAll(TIMESTAMP)];
      if (triggerCues.length && timestamps.length) throw new Error(`Line ${index + 1}: a MIDI trigger has no timestamp. Put it on its own line.`);
      if (!timestamps.length) {
        if (/\{midi:/.test(content)) throw new Error(`Line ${index + 1}: MIDI needs a [mm:ss] timestamp.`);
        return triggerCues;
      }
      const messages: number[][] = [],
        tokens: string[] = [];
      const body = content
        .replace(TIMESTAMP, "")
        .replace(/\{(?:no)?chase\}/g, "")
        .replace(/\{midi:([^}]+)\}/g, (_, cmd: string) => {
          tokens.push(cmd.trim());
          messages.push(...expandCommand(cmd, macros));
          return "";
        })
        .trim();
      if (body.includes("{midi:")) throw new Error(`Line ${index + 1}: MIDI commands need nonempty contents and a closing brace.`);
      // Only the extended grammar, macros and triggers need their text kept, so an existing chart parses to the same objects as before.
      const kept = tokens.some((token) => !isLegacyCommand(token)) ? { tokens } : {};
      const found = [...code.matchAll(MIDI_TOKEN)],
        stamps = [...code.matchAll(TIMESTAMP)];
      const placed =
        found.length === 1 && stamps.length === 1
          ? {
              source: {
                line: index,
                start: found[0].index,
                end: found[0].index + found[0][0].length,
                text: found[0][0],
                stamp: { start: stamps[0].index, end: stamps[0].index + stamps[0][0].length, text: stamps[0][0] },
              },
            }
          : {};
      const whole = found.length > 1 && stamps.length === 1 ? { line: { index, text: line } } : {};
      return timestamps.map((t) => ({
        time: Number(t[1]) * 60 + Number(t[2]),
        text: `${body}${gap}${comment}`.trim(),
        messages,
        ...labelled,
        ...(hasChase || hasNoChase ? { chase: hasChase } : {}),
        ...kept,
        ...(tokens.length ? placed : {}),
        ...whole,
      }));
    })
    .sort((a, b) => a.time - b.time);
}
/** The chart split into lines, with the line ending of each kept so a change can put the text back byte for byte. */
function splitLines(chart: string): { lines: string[]; ends: string[] } {
  const parts = chart.split(/(\r?\n)/);
  return { lines: parts.filter((_, i) => i % 2 === 0), ends: parts.filter((_, i) => i % 2 === 1) };
}

function joinLines(lines: string[], ends: string[]): string {
  return lines.map((line, i) => line + (ends[i] ?? "")).join("");
}

/** A line left with only timestamps, chase marks, a label and spaces carries nothing to show, so it is removed with its last token. */
const BLANK_AFTER_REMOVAL = /^\s*(?:\[\d+:[0-5]\d(?:\.\d+)?\]\s*|\{(?:no)?chase\}\s*|\{label:[^}]*\}\s*)*$/;

/** The line a cue's token is on, or null when the chart no longer has that token at that place (it was edited since it was parsed). */
function checkedLine(lines: string[], source: CueSource): string | null {
  const line = lines[source.line];
  return line !== undefined && line.slice(source.start, source.end) === source.text ? line : null;
}

/**
 * Removes the cue's `{midi…}` token from the chart. Everything else is left exactly as it was; a line that holds nothing else is removed too.
 * Returns null, and changes nothing, when the cue has no source or the chart no longer has the token where it was parsed.
 */
export function removeCueToken(chart: string, cue: Cue): string | null {
  const source = cue.source;
  if (!source) return cue.line ? removeCueLine(chart, cue.line) : null;
  const { lines, ends } = splitLines(chart),
    line = checkedLine(lines, source);
  if (line === null) return null;
  // The space after the token goes with it, or the space before it when the token ends the line.
  let from = source.start,
    to = source.end;
  while (to < line.length && /[ \t]/.test(line[to])) to++;
  if (to === source.end) while (from > 0 && /[ \t]/.test(line[from - 1])) from--;
  const next = line.slice(0, from) + line.slice(to);
  if (BLANK_AFTER_REMOVAL.test(next)) dropLine(lines, ends, source.line);
  else lines[source.line] = next;
  return joinLines(lines, ends);
}

/** Takes the line out of the chart, keeping the line ending of every other line. */
function dropLine(lines: string[], ends: string[], index: number): void {
  lines.splice(index, 1);
  // The removed line takes its own ending; a last line without one leaves the ending before it behind, so drop that instead.
  if (index < ends.length) ends.splice(index, 1);
  else ends.pop();
}

/**
 * Removes every `{midi:…}` token of a multi-token cue, with the cue's label and chase mark. Words and chords on the line stay; a line left
 * with nothing else is removed. Returns null when the chart no longer has the line exactly as it was parsed.
 */
function removeCueLine(chart: string, cueLine: CueLine): string | null {
  const { lines, ends } = splitLines(chart);
  if (lines[cueLine.index] !== cueLine.text) return null;
  const commentAt = cueLine.text.search(COMMENT),
    code = commentAt < 0 ? cueLine.text : cueLine.text.slice(0, commentAt),
    comment = commentAt < 0 ? "" : cueLine.text.slice(commentAt);
  const kept = code
    .replace(/\{midi:[^}]*\}[ \t]*/g, "")
    .replace(/\{label:[^}]*\}[ \t]*/g, "")
    .replace(/\{(?:no)?chase\}[ \t]*/g, "")
    .trimEnd();
  const next = comment ? `${kept} ${comment.trimStart()}` : kept;
  if (BLANK_AFTER_REMOVAL.test(next)) dropLine(lines, ends, cueLine.index);
  else lines[cueLine.index] = next;
  return joinLines(lines, ends);
}

/**
 * Replaces the cue's token with `text` (a whole token, such as `{midi:pc 1 6}`). A `time` in seconds also rewrites the cue's timestamp.
 * Returns null, and changes nothing, under the same conditions as removeCueToken, or when a time is given for a cue that has no timestamp of its own.
 */
export function replaceCueToken(chart: string, cue: Cue, text: string, time?: number): string | null {
  const source = cue.source;
  if (!source) return null;
  const { lines, ends } = splitLines(chart),
    line = checkedLine(lines, source);
  if (line === null) return null;
  const edits = [{ start: source.start, end: source.end, text }];
  if (time !== undefined) {
    const stamp = source.stamp;
    if (!stamp || line.slice(stamp.start, stamp.end) !== stamp.text) return null;
    edits.push({ start: stamp.start, end: stamp.end, text: lrcTime(time) });
  }
  // From the end of the line backwards, so an edit never moves the one before it.
  lines[source.line] = edits.sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end), line);
  return joinLines(lines, ends);
}

export function lrcTime(time: number): string {
  const ticks = Math.round(Math.max(0, time) * 100);
  return `[${String(Math.floor(ticks / 6000)).padStart(2, "0")}:${((ticks % 6000) / 100).toFixed(2).padStart(5, "0")}]`;
}

/** Schedule a half-open interval once. Seeking/pausing clears output and resets the caller's cursor. Triggers are never scheduled by time. */
export function scheduleCues(
  cues: Cue[],
  after: number,
  until: number,
  position: number,
  nowMs: number,
  send: (bytes: number[], timestamp: number) => void,
): void {
  for (const cue of timedCues(cues))
    if (cue.time > after && cue.time <= until) {
      for (const bytes of cue.messages) send(bytes, nowMs + Math.max(0, cue.time - position) * 1000);
    }
}
