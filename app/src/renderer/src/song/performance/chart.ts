import { expandCommand, isLegacyCommand, type MidiMacro } from "./midi-macros";
import { isChordName, transposeChordName } from "./speed";

export { midiCommand } from "./midi-command";

/** When a trigger cue is sent: on load (armed), when playback starts or resumes, on pause or stop, or when the song reaches its end. */
export type MidiTrigger = "load" | "play" | "stop" | "end";

export interface Cue {
  time: number;
  text: string;
  messages: number[][];
  label?: string;
  /** `{chase}` forces this cue's PC/CC/SysEx to be replayed when starting mid-song; `{nochase}` never replays them. Unset uses the defaults. */
  chase?: boolean;
  /** Set on a `{midi@…}` trigger, which has no song time. `time` is 0 and is never used for scheduling. */
  trigger?: MidiTrigger;
  /**
   * The command text of each token, as the editor shows it: `pc 1 5 bank 0 2`, `$GP_LEAD`, or `@load pc 1 5` for a trigger. Only set when a
   * token is more than the original grammar or is a trigger, so charts that used only that grammar parse exactly as before.
   */
  tokens?: string[];
  /** Set on a cue read from the song's MIDI file rather than the chart. */
  fromFile?: true;
}

/** The cues that have a song time. Triggers are kept in the chart and sent by the session, so they are left out of any timeline. */
export function timedCues(cues: readonly Cue[]): Cue[] {
  return cues.filter((cue) => !cue.trigger);
}

const TIMESTAMP = /\[(\d+):([0-5]\d(?:\.\d+)?)\]/g;
const TRIGGER = /\{midi@(load|play|stop|end):([^}]*)\}/g;

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
      const triggers = [...content.matchAll(TRIGGER)];
      if (/\{midi@/.test(content.replace(TRIGGER, "")))
        throw new Error(`Line ${index + 1}: a MIDI trigger is {midi@load: …}, {midi@play: …}, {midi@stop: …} or {midi@end: …} with one command.`);
      const triggerCues: Cue[] = triggers.map((t) => {
        const command = t[2].trim();
        if (!command) throw new Error(`Line ${index + 1}: MIDI triggers need contents.`);
        return { time: 0, text: "", messages: expandCommand(command, macros), trigger: t[1] as Cue["trigger"], tokens: [`@${t[1]} ${command}`], ...labelled };
      });
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
      return timestamps.map((t) => ({
        time: Number(t[1]) * 60 + Number(t[2]),
        text: `${body}${gap}${comment}`.trim(),
        messages,
        ...labelled,
        ...(hasChase || hasNoChase ? { chase: hasChase } : {}),
        ...kept,
      }));
    })
    .sort((a, b) => a.time - b.time);
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
