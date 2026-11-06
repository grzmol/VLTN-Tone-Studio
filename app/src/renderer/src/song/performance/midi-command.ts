/**
 * The text grammar for one MIDI command, shared by chart tokens, the pedal library, macros and the cue builder.
 * Channels are 1–16 and data bytes 0–127, the wire values, so a number copied from a manual's 1–128 list is one lower here.
 */
const STATUS: Record<string, number> = { pc: 192, cc: 176, note: 144, off: 128 };
const COUNTS: Record<string, number> = { pc: 2, cc: 3, note: 3, off: 3 };
const REALTIME: Record<string, number> = { start: 250, continue: 251, stop: 252 };

/** Deliberately strict, documented syntax for a channel message or a SysEx block. */
export function midiCommand(command: string): number[] {
  const [type, ...args] = command.trim().split(/\s+/);
  const values = args.map(Number);
  const channel = values[0];
  if (type === "sysex") {
    if (args.length < 2 || args.some((v) => !/^[\da-f]{2}$/i.test(v))) throw new Error("SysEx requires hex bytes, including F0 and F7.");
    const bytes = args.map((v) => parseInt(v, 16));
    if (bytes[0] !== 240 || bytes.at(-1) !== 247 || bytes.slice(1, -1).some((v) => v > 127)) throw new Error("Invalid SysEx framing or data.");
    return bytes;
  }
  if (
    !COUNTS[type] ||
    values.length !== COUNTS[type] ||
    !Number.isInteger(channel) ||
    channel < 1 ||
    channel > 16 ||
    values.slice(1).some((v) => !Number.isInteger(v) || v < 0 || v > 127)
  )
    throw new Error(`Invalid MIDI command: ${command}`);
  return [STATUS[type] + channel - 1, ...values.slice(1)];
}

/**
 * Every message a command text sends, in order. This adds to `midiCommand`:
 * - `pc <ch> <program> bank <msb> <lsb>` sends CC0 (msb), CC32 (lsb) and then the program change;
 * - `songselect <n>` sends F3 n;
 * - `start`, `continue` and `stop` send the real-time bytes FA, FB and FC.
 * Anything else is passed to `midiCommand`, so it throws the same error for the same mistake.
 */
export function midiMessages(command: string): number[][] {
  const [type, ...args] = command.trim().split(/\s+/);
  if (type === "pc" && args[2] === "bank") {
    if (args.length !== 5) throw new Error(`Invalid MIDI command: ${command}. Use pc <channel> <program> bank <msb> <lsb>.`);
    const [channel, program, msb, lsb] = [args[0], args[1], args[3], args[4]];
    return [midiCommand(`cc ${channel} 0 ${msb}`), midiCommand(`cc ${channel} 32 ${lsb}`), midiCommand(`pc ${channel} ${program}`)];
  }
  if (type === "songselect") {
    const value = Number(args[0]);
    if (args.length !== 1 || !Number.isInteger(value) || value < 0 || value > 127) throw new Error(`Invalid MIDI command: ${command}. Use songselect 0–127.`);
    return [[243, value]];
  }
  if (type in REALTIME) {
    if (args.length) throw new Error(`Invalid MIDI command: ${command}. ${type} takes no values.`);
    return [[REALTIME[type]]];
  }
  return [midiCommand(command)];
}
