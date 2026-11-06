import type { Cue } from "./chart";
import { expandCommand, type MidiMacro } from "./midi-macros";

const TRIGGER_TOKEN = /^\{midi@(load|play|stop|end):([^}]*)\}$/;

/** The command text of a placed cue as the editor shows it: `pc 1 5` or `$GP_LEAD`, or `@load pc 1 5` for a trigger. Null when the cue has no source. */
export function cueCommandText(cue: Cue): string | null {
  const text = cue.source?.text;
  if (!text) return null;
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
  const trigger = /^@(load|play|stop|end)\s+(\S.*)$/.exec(text);
  if (cue.trigger) {
    if (!trigger) throw new Error("A trigger cue is written @load, @play, @stop or @end, then the command.");
    expandCommand(trigger[2], macros);
    return `{midi@${trigger[1]}:${trigger[2]}}`;
  }
  if (!text || text.startsWith("@")) throw new Error("Write the command, such as pc 1 5.");
  expandCommand(text, macros);
  return `{midi:${text}}`;
}
