import { MIDI_TRIGGER_PATTERN, preparationWaitMs } from "./preparation-wait";
import { sectionTokenText, type Cue } from "./chart";
import { expandCommand, type MidiMacro } from "./midi-macros";

const TRIGGER_TOKEN = new RegExp(String.raw`^\{midi@(${MIDI_TRIGGER_PATTERN}):([^}]*)\}$`);
const SECTION_TOKEN = /^\{midi@section\s+(?:"([^"}]*)"|([^":}]*?))\s*:([^}]*)\}$/;
/** The editor's text for a section cue, `@section Chorus: pc 1 5`, read back: the section name (quoted when it names one section) and the command. */
const SECTION_TEXT = /^@section\s+(?:"([^"{}]*)"|([^":{}]*?))\s*:\s*(\S.*)$/;

/** The command text of a placed cue as the editor shows it: `pc 1 5` or `$GP_LEAD`, or `@load pc 1 5` for a trigger. Null when the cue has no source. */
export function cueCommandText(cue: Cue): string | null {
  const text = cue.source?.text;
  if (!text) return null;
  const section = SECTION_TOKEN.exec(text);
  if (section) return sectionTokenText({ name: (section[1] ?? section[2]).trim(), exact: section[1] !== undefined }, section[3].trim());
  const trigger = TRIGGER_TOKEN.exec(text);
  return trigger ? `@${trigger[1]} ${trigger[2].trim()}` : text.slice("{midi:".length, -1).trim();
}

/**
 * The chart token for an edited cue. A cue keeps its kind: a timed cue stays timed and a trigger stays a trigger, though a trigger may move to
 * another event. Throws with a message a performer can act on when the text is not a valid command.
 */
export function cueTokenFor(cue: Cue, command: string, macros: readonly MidiMacro[]): string {
  const text = command.trim();
  if (/[{}]/.test(text)) throw new Error("A MIDI command can't contain braces.");
  const trigger = new RegExp(String.raw`^@(${MIDI_TRIGGER_PATTERN})\s+(\S.*)$`).exec(text);
  if (cue.trigger === "section") {
    const section = SECTION_TEXT.exec(text),
      name = (section?.[1] ?? section?.[2] ?? "").trim();
    if (!section || !name) throw new Error('A section cue is written @section Chorus: pc 1 5, or @section "Chorus 2": pc 1 5 for one section.');
    expandCommand(section[3], macros);
    return `{midi@section ${section[1] !== undefined ? `"${name}"` : name}: ${section[3].trim()}}`;
  }
  if (cue.trigger) {
    if (!trigger) throw new Error("A trigger cue is written @load, @prepare, @play, @stop or @end, then the command.");
    preparationWaitMs(trigger[1]);
    expandCommand(trigger[2], macros);
    return `{midi@${trigger[1]}:${trigger[2]}}`;
  }
  if (!text || text.startsWith("@")) throw new Error("Write the command, such as pc 1 5.");
  expandCommand(text, macros);
  return `{midi:${text}}`;
}
