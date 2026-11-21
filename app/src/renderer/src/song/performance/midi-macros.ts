import { midiCommand, midiMessages } from "./midi-command";

/**
 * A named list of MIDI commands. A chart sends it with `{midi:$CODE}`, and the pedal library and cue builder can save into it. Macros are
 * stored with the MIDI configuration and expanded whenever a chart is parsed, so editing one changes every song that uses it.
 */
export interface MidiMacro {
  /** Upper-case letters, digits and underscores, starting with a letter, e.g. GP_LEAD. */
  code: string;
  /** A name for the list in the app. */
  label: string;
  /** Command texts as a chart writes them (`pc 16 12`, `cc 1 102 127`, `start`). An entry `$CODE` includes another macro. */
  commands: string[];
}

export const MACRO_CODE = /^[A-Z][A-Z0-9_]{0,31}$/;
export const MAX_MACRO_COMMANDS = 64;
/** A macro that sends more than this many messages in one reference is rejected, so it cannot flood the output. */
export const MAX_MACRO_MESSAGES = 256;
const MAX_NESTING = 8;

/** The messages for one chart token: a command, or a `$CODE` reference that is expanded in turn. Throws with a message a performer can act on. */
export function expandCommand(text: string, macros: readonly MidiMacro[]): number[][] {
  return expandToken(text, new Map(macros.map((macro) => [macro.code, macro])), []);
}

/** Whether a chart token refers to a macro rather than sending a command itself. */
export function isMacroReference(text: string): boolean {
  return text.trim().startsWith("$");
}

/**
 * Checks a command token without a macro table, for editors that have none. A `$CODE` is checked for its shape only; whether the macro
 * exists is checked when the chart is parsed.
 */
export function checkCommandText(text: string): void {
  if (!isMacroReference(text)) midiMessages(text);
  else if (!MACRO_CODE.test(text.trim().slice(1))) throw new Error(`Invalid macro reference ${text.trim()}.`);
}

function expandToken(text: string, table: ReadonlyMap<string, MidiMacro>, stack: string[]): number[][] {
  const trimmed = text.trim();
  if (!isMacroReference(trimmed)) return midiMessages(trimmed);
  const code = trimmed.slice(1);
  if (!MACRO_CODE.test(code)) throw new Error(`Invalid macro reference ${trimmed}. Codes are upper-case letters, digits and underscores.`);
  return expandMacro(code, table, stack);
}

function expandMacro(code: string, table: ReadonlyMap<string, MidiMacro>, stack: string[]): number[][] {
  const macro = table.get(code);
  if (!macro) throw new Error(`Unknown macro $${code}. Save it in the MIDI commands before a chart uses it.`);
  if (stack.includes(code)) throw new Error(`Macro $${code} refers to itself: ${[...stack, code].map((c) => "$" + c).join(" → ")}.`);
  if (stack.length >= MAX_NESTING) throw new Error(`Macro $${code} nests more than ${MAX_NESTING} macros deep.`);
  const messages = macro.commands.flatMap((command) => expandToken(command, table, [...stack, code]));
  if (messages.length > MAX_MACRO_MESSAGES) throw new Error(`Macro $${code} sends more than ${MAX_MACRO_MESSAGES} messages.`);
  return messages;
}

/** Every problem in a macro table, one message each. Empty when every macro is valid. Saving refuses a table that has any. */
export function macroProblems(macros: readonly MidiMacro[]): string[] {
  const problems: string[] = [],
    seen = new Set<string>(),
    table = new Map(macros.map((macro) => [macro.code, macro]));
  for (const macro of macros) {
    const name = `$${macro.code}`;
    if (!MACRO_CODE.test(macro.code)) problems.push(`Macro code “${macro.code}” must be upper-case letters, digits and underscores, starting with a letter.`);
    else if (seen.has(macro.code)) problems.push(`Two macros use ${name}.`);
    seen.add(macro.code);
    if (!macro.label.trim() || macro.label.length > 60) problems.push(`${name} needs a label of 1–60 characters.`);
    if (!macro.commands.length || macro.commands.length > MAX_MACRO_COMMANDS)
      problems.push(`${name} needs 1–${MAX_MACRO_COMMANDS} commands.`);
    else {
      // Each macro's own commands are checked, so a duplicate code cannot hide a bad command.
      try {
        macro.commands.forEach((command) => expandToken(command, table, [macro.code]));
      } catch (e) {
        problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return problems;
}

/**
 * A code for a new macro, made from its label and unused in `existing`: “Lead patch” becomes LEAD_PATCH, and a repeat becomes LEAD_PATCH_2.
 * A label with no letters or digits falls back to MACRO.
 */
export function macroCodeFor(label: string, existing: readonly MidiMacro[]): string {
  const base = (label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "MACRO").replace(/^(?![A-Z])/, "M_").slice(0, 28);
  const taken = new Set(existing.map((macro) => macro.code));
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
  return code;
}

/** Whether a command is in the original `midiCommand` grammar. Charts that use only that grammar keep their old parse output. */
export function isLegacyCommand(text: string): boolean {
  try {
    midiCommand(text);
    return true;
  } catch {
    return false;
  }
}
