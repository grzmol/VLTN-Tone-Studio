import type { LibrarySong } from "@shared/song-library";
import { learnStep, overlaps, type Binding, type BankTracker, type MidiEvent, type MidiMatch } from "./bindings";

/*
 * Song triggers (pure): a MIDI message that loads a song from the library. A song's trigger is a program change, with the bank Learn
 * captures when there is one, or a Song Select number. The session runs each input message through the remote bindings first, so a
 * binding that claims the message keeps it; only a message no binding claims can select a song. Our own output coming back through a
 * THRU input never gets this far (see `EchoFilter`).
 *
 * When two songs have overlapping triggers, the first in library order is the one that loads, every time. The settings and preflight
 * name the others, so the clash can be fixed.
 */

export type SongTrigger = { type: "pc"; channel: number; program: number; bankMsb?: number; bankLsb?: number } | { type: "songselect"; number: number };

/** Which songs a trigger may select: every song in the library, or only the songs of the playlist being played. */
export type SongScope = "library" | "playlist";
/** What a trigger does while a song is playing: nothing (the default), arm the song as next in the set, or stop and load it now. */
export type WhilePlaying = "ignore" | "next" | "now";

export interface SongTriggerSettings {
  /** Whether messages on the selected MIDI input may select a song */
  listen: boolean;
  scope: SongScope;
  /** Whether a song loaded by a trigger starts playing at once */
  autoplay: boolean;
  whilePlaying: WhilePlaying;
}

export const SONG_TRIGGER_DEFAULTS: SongTriggerSettings = { listen: false, scope: "library", autoplay: false, whilePlaying: "ignore" };

export const WHILE_PLAYING_OPTIONS: { id: WhilePlaying; label: string; hint: string }[] = [
  { id: "ignore", label: "Ignore", hint: "A trigger while a song plays does nothing. Default." },
  { id: "next", label: "Arm as next", hint: "The triggered song plays after the current one, in a playlist. Nothing stops." },
  { id: "now", label: "Stop and load now", hint: "Stops the song and loads the triggered one. Use it only when the set should jump." },
];

/** A song as triggers see it: its id, its title, and the trigger it has, if any. */
export interface SongEntry {
  id: string;
  title: string;
  trigger: SongTrigger | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

/** The trigger a stored value describes, or null when it is missing or malformed. Never throws. */
export function sanitizeTrigger(raw: unknown): SongTrigger | null {
  if (!isObject(raw)) return null;
  const { type, number, channel, program, bankMsb, bankLsb } = raw;
  if (type === "songselect") return isInt(number, 0, 127) ? { type, number } : null;
  if (type !== "pc" || !isInt(channel, 1, 16) || !isInt(program, 0, 127)) return null;
  const trigger: Extract<SongTrigger, { type: "pc" }> = { type: "pc", channel, program };
  if (bankMsb !== undefined) {
    if (!isInt(bankMsb, 0, 127)) return null;
    trigger.bankMsb = bankMsb;
  }
  if (bankLsb !== undefined) {
    if (!isInt(bankLsb, 0, 127)) return null;
    trigger.bankLsb = bankLsb;
  }
  return trigger;
}

/** The trigger a song's stored options hold (its `midiTrigger`), or null. Options that are not JSON read as no trigger. */
export function triggerFromOptions(json: string | undefined): SongTrigger | null {
  try {
    const options: unknown = JSON.parse(json || "{}");
    return isObject(options) ? sanitizeTrigger(options.midiTrigger) : null;
  } catch {
    return null;
  }
}

/** The songs as triggers see them, in library order. */
export function songEntries(songs: readonly LibrarySong[]): SongEntry[] {
  return songs.map((song) => ({ id: song.id, title: song.title, trigger: triggerFromOptions(song.settings[":options"]) }));
}

/** The global trigger options as stored. Anything missing or unknown reads as the default, so a bad value never turns triggers on. */
export function sanitizeTriggerSettings(raw: unknown): SongTriggerSettings {
  const options = isObject(raw) ? raw : {};
  const whilePlaying = WHILE_PLAYING_OPTIONS.find((option) => option.id === options.whilePlaying)?.id ?? SONG_TRIGGER_DEFAULTS.whilePlaying;
  return {
    listen: options.listen === true,
    scope: options.scope === "playlist" ? "playlist" : "library",
    autoplay: options.autoplay === true,
    whilePlaying,
  };
}

/** A program change trigger from what Learn captured: its bank, when it had one, is split into MSB and LSB. */
function programTrigger(channel: number, program: number, bank?: number): SongTrigger {
  if (bank === undefined) return { type: "pc", channel, program };
  return { type: "pc", channel, program, bankMsb: Math.floor(bank / 128), bankLsb: bank % 128 };
}

/** The bank a trigger requires, or undefined when it accepts any bank. */
function bankRequired(trigger: Extract<SongTrigger, { type: "pc" }>): number | undefined {
  if (trigger.bankMsb === undefined && trigger.bankLsb === undefined) return undefined;
  return (trigger.bankMsb ?? 0) * 128 + (trigger.bankLsb ?? 0);
}

/** Whether one input message selects the song a trigger names. The bank is read from the input's own bank selects. */
export function triggerMatches(trigger: SongTrigger, event: MidiEvent, bank: BankTracker): boolean {
  if (trigger.type === "songselect") return event.status === 0xf3 && event.data1 === trigger.number;
  if (event.status !== 0xc0 || event.channel === undefined || event.channel !== trigger.channel - 1 || event.data1 !== trigger.program) return false;
  const required = bankRequired(trigger);
  return required === undefined || bank.current(event.channel) === required;
}

/** Whether two triggers can both answer the same message. Two triggers with the same number, or with no bank named, overlap. */
export function triggersOverlap(a: SongTrigger, b: SongTrigger): boolean {
  if (a.type === "songselect" || b.type === "songselect") return a.type === "songselect" && b.type === "songselect" && a.number === b.number;
  if (a.channel !== b.channel || a.program !== b.program) return false;
  const x = bankRequired(a),
    y = bankRequired(b);
  return x === undefined || y === undefined || x === y;
}

/** The first song, in library order, whose trigger the message selects. Null for anything that is not a program change or Song Select. */
export function songForEvent(songs: readonly SongEntry[], event: MidiEvent, bank: BankTracker): SongEntry | null {
  if (event.status !== 0xc0 && event.status !== 0xf3) return null;
  return songs.find((song) => song.trigger !== null && triggerMatches(song.trigger, event, bank)) ?? null;
}

/** The songs a trigger may select: the whole library, or the songs of the playlist, in library order. */
export function songsInScope(songs: readonly SongEntry[], queue: readonly string[], scope: SongScope): SongEntry[] {
  return scope === "playlist" ? songs.filter((song) => queue.includes(song.id)) : [...songs];
}

/** The other songs whose trigger overlaps this song's, in library order. A message for any of them loads the first one. */
export function triggerClashes(songs: readonly SongEntry[], id: string): SongEntry[] {
  const trigger = songs.find((song) => song.id === id)?.trigger;
  if (!trigger) return [];
  return songs.filter((song) => song.id !== id && song.trigger !== null && triggersOverlap(trigger, song.trigger));
}

/** The first binding that already answers the trigger's message, or undefined. A binding wins over a song, so the song would not load. */
export function bindingClaiming(trigger: SongTrigger, bindings: readonly Binding[]): Binding | undefined {
  if (trigger.type === "songselect") return undefined;
  const match: MidiMatch = { status: 0xc0, channel: trigger.channel, data1: trigger.program };
  const bank = bankRequired(trigger);
  if (bank !== undefined) match.bank = bank;
  const probe: Binding = { action: "song.select", source: "midi", match };
  return bindings.find((binding) => overlaps(binding, probe));
}

/** A trigger in words: "Ch 3 · Program 9 · bank 2/3", or "Song Select 12". */
export function describeTrigger(trigger: SongTrigger): string {
  if (trigger.type === "songselect") return `Song Select ${trigger.number}`;
  const bank = bankRequired(trigger);
  const where = bank === undefined ? "" : ` · bank ${trigger.bankMsb ?? 0}/${trigger.bankLsb ?? 0}`;
  return `Ch ${trigger.channel} · Program ${trigger.program}${where}`;
}

/** What one message does while a song is being learned: a trigger to save, a message to wait on, or nothing to learn. */
export type SongLearnStep = { kind: "match"; trigger: SongTrigger; seen: string } | { kind: "wait" | "ignore"; seen: string };

/**
 * Reads a message for a song trigger. A program change is learned as Learn does for bindings, with its bank when one was selected
 * first. Song Select is learned as its number. Any other message says why it cannot select a song.
 */
export function songLearnStep(event: MidiEvent, bank: BankTracker): SongLearnStep {
  if (event.status === 0xf3) return { kind: "match", trigger: { type: "songselect", number: event.data1 ?? 0 }, seen: `Song Select ${event.data1 ?? 0}` };
  const step = learnStep(event, bank);
  if (step.kind !== "match") return step;
  if (step.match.status !== 0xc0) return { kind: "ignore", seen: `${step.seen}. Only a program change or Song Select selects a song.` };
  const { channel = 1, data1 = 0, bank: learnedBank } = step.match;
  return { kind: "match", trigger: programTrigger(channel, data1, learnedBank), seen: step.seen };
}

/** The result of putting a song next in a playing playlist. `queue` is the new queue; a reason says why nothing moved. */
export type ArmResult = { ok: true; queue: string[] } | { ok: false; reason: "current" | "played" | "next" };

/**
 * The queue with `id` moved to play after the current song. A song already after the current one moves up; a song outside the queue is
 * added there. A song that is playing, next, or already played is not moved.
 */
export function armAsNext(queue: readonly string[], position: number, id: string): ArmResult {
  const at = queue.indexOf(id);
  if (at >= 0 && at <= position) return { ok: false, reason: at === position ? "current" : "played" };
  if (at === position + 1) return { ok: false, reason: "next" };
  const rest = queue.filter((_, i) => i !== at);
  return { ok: true, queue: [...rest.slice(0, position + 1), id, ...rest.slice(position + 1)] };
}
