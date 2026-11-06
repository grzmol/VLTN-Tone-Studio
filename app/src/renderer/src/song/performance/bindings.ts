import { create } from "zustand";
import { ACTIONS, isActionId, type ActionId } from "./actions";

/*
 * Remote bindings (pure): which MIDI message or key runs which action. The session feeds every input message through `RemoteRouter`,
 * which says what to run. Three things keep a live set safe:
 *  - our own output that comes back through a THRU or loop-back input is recognised and ignored (`EchoFilter`);
 *  - a repeat from the same control within `BOUNCE_MS` is one press (a pedal can send its value twice);
 *  - a binding marked double press runs only on its second press within `DOUBLE_PRESS_MS`.
 * A CC binding has three modes: momentary fires on every message in its range, threshold fires once when the value rises into the
 * range, and toggle fires on each crossing into or out of the range. The default CC80 binding is momentary, as the old CC80 toggle was.
 */

export type MidiMode = "momentary" | "threshold" | "toggle";

export const MIDI_MODES: readonly { id: MidiMode; label: string; hint: string }[] = [
  { id: "momentary", label: "Momentary", hint: "Every message in the range. Repeats within 150 ms count once." },
  { id: "threshold", label: "Threshold", hint: "Once, when the value rises into the range." },
  { id: "toggle", label: "Toggle", hint: "Each switch, into or out of the range." },
];

/** Repeats of one control closer than this are one press */
export const BOUNCE_MS = 150;
/** The second press of a double press must come within this long of the first */
export const DOUBLE_PRESS_MS = 600;
/** Our own output is recognised coming back in for this long, counted from the moment it goes out on the wire */
export const ECHO_MS = 200;
/** An echo cannot arrive before its wire time, but clocks drift a little, so a record is matched from this long before it */
const ECHO_EARLY_MS = 20;

/** Real-time messages that can be bound. Clock is not one of them: it would fire on every beat. */
const REALTIME = { 0xfa: "Start", 0xfb: "Continue", 0xfc: "Stop" } as const;
const CHANNEL_STATUS = [0x80, 0x90, 0xb0, 0xc0] as const;
const MODIFIERS = ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"];

export interface MidiMatch {
  /** 0x80 note off, 0x90 note on, 0xB0 controller, 0xC0 program change, or a real-time status 0xFA, 0xFB, 0xFC */
  status: number;
  /** 1 to 16. Absent means any channel. Real-time messages have no channel. */
  channel?: number;
  /** The note, controller or program number. Absent for real-time messages. */
  data1?: number;
  /** The value range, inclusive: velocity for notes, the controller value for CCs. Defaults to 0 to 127. */
  data2Min?: number;
  data2Max?: number;
  /** Controllers only: how the value range fires (see the file comment). Defaults to momentary. */
  mode?: MidiMode;
  /** Program changes only: the bank (MSB × 128 + LSB) that must be selected on the channel. Learned with the program change. */
  bank?: number;
}

export interface KeyMatch {
  /** The key as `KeyboardEvent.key` reports it, with letters in lower case: "PageDown", "ArrowLeft", "t" */
  key: string;
}

interface BindingBase {
  action: ActionId;
  /** The number of an action that takes one: "Jump to section 3" has index 3 */
  index?: number;
  /** Fires only on its second press within `DOUBLE_PRESS_MS` */
  doublePress?: boolean;
}

export interface MidiBinding extends BindingBase {
  source: "midi";
  match: MidiMatch;
}

export interface KeyBinding extends BindingBase {
  source: "key";
  match: KeyMatch;
}

export type Binding = MidiBinding | KeyBinding;

/** What the message is, read out of the bytes. Data bytes are 0 to 127 and the channel is 0 to 15. */
export interface MidiEvent {
  status: number;
  channel?: number;
  data1?: number;
  data2?: number;
}

const isDataByte = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 127;

/** The event a message carries, or null for anything that is not a channel message or a bound real-time message (SysEx, clock, junk). */
export function parseMidi(data: ArrayLike<number>): MidiEvent | null {
  const status = data[0];
  if (!Number.isInteger(status)) return null;
  // Song Select has a number and no channel. Bindings cannot name it; song triggers can (see song-triggers.ts).
  if (status === 0xf3) return isDataByte(data[1]) ? { status, data1: data[1] } : null;
  if (status >= 0xf8) return { status };
  if (status < 0x80 || status >= 0xf0) return null;
  const type = status & 0xf0,
    channel = status & 0x0f,
    data1 = data[1],
    data2 = data[2];
  if (!isDataByte(data1)) return null;
  if (type === 0xc0 || type === 0xd0) return { status: type, channel, data1 };
  if (!isDataByte(data2)) return null;
  // A note on with velocity 0 is a note off, as on the wire.
  if (type === 0x90 && data2 === 0) return { status: 0x80, channel, data1, data2 };
  return { status: type, channel, data1, data2 };
}

/** The bank a channel has selected, from its bank select controllers (CC0 is the MSB, CC32 the LSB). */
export class BankTracker {
  private readonly msb = new Map<number, number>();
  private readonly lsb = new Map<number, number>();

  observe(event: MidiEvent): void {
    if (event.status !== 0xb0 || event.channel === undefined || event.data2 === undefined) return;
    if (event.data1 === 0) this.msb.set(event.channel, event.data2);
    if (event.data1 === 32) this.lsb.set(event.channel, event.data2);
  }

  /** MSB × 128 + LSB for the channel, or undefined when no bank select has been seen on it. */
  current(channel: number): number | undefined {
    if (!this.msb.has(channel) && !this.lsb.has(channel)) return undefined;
    return (this.msb.get(channel) ?? 0) * 128 + (this.lsb.get(channel) ?? 0);
  }
}

/**
 * Remembers what the app sent, so that the same bytes coming back soon after are not taken for a press. Each record is used once.
 * A scheduled message is recorded at its wire time, which can be up to a second after it was queued, so the echo window starts there.
 */
export class EchoFilter {
  private sent: { key: string; at: number }[] = [];

  constructor(private readonly now: () => number) {}

  /** Records bytes that go out on the wire at `at` (now, when not given). A scheduled message is recorded at its future time. */
  record(bytes: readonly number[], at: number = this.now()): void {
    const now = this.now();
    this.sent = this.sent.filter((s) => now - s.at <= ECHO_MS).slice(-511);
    this.sent.push({ key: bytes.join(","), at });
  }

  consume(data: ArrayLike<number>): boolean {
    const key = Array.from(data).join(","),
      now = this.now(),
      index = this.sent.findIndex((s) => s.key === key && now - s.at <= ECHO_MS && now - s.at >= -ECHO_EARLY_MS);
    if (index < 0) return false;
    this.sent.splice(index, 1);
    return true;
  }
}

/** The value range of a binding. Only notes and controllers have one. */
function rangeOf(match: MidiMatch): { min: number; max: number } {
  return { min: match.data2Min ?? 0, max: match.data2Max ?? 127 };
}

/** Whether a message is the one a binding names, leaving out the value range of controllers, which the mode decides. */
function matchesEvent(match: MidiMatch, event: MidiEvent, bank: BankTracker): boolean {
  if (match.status !== event.status) return false;
  if (match.channel !== undefined && event.channel !== match.channel - 1) return false;
  if (match.data1 !== undefined && event.data1 !== match.data1) return false;
  if (match.status === 0x80 || match.status === 0x90) {
    const { min, max } = rangeOf(match),
      value = event.data2 ?? 0;
    if (value < min || value > max) return false;
  }
  if (match.bank !== undefined) return event.channel !== undefined && bank.current(event.channel) === match.bank;
  return true;
}

/** Whether a controller message fires its binding, given the controller's value before this message (undefined when unknown). */
function modeFires(match: MidiMatch, event: MidiEvent, before: number | undefined): boolean {
  if (match.status !== 0xb0) return true;
  const { min, max } = rangeOf(match),
    inside = (value: number) => value >= min && value <= max,
    now = inside(event.data2 ?? 0),
    was = before !== undefined && inside(before);
  switch (match.mode ?? "momentary") {
    case "threshold":
      return now && !was;
    case "toggle":
      return now !== was;
    default:
      return now;
  }
}

export type Route = { kind: "fire"; binding: Binding } | { kind: "armed"; binding: Binding };

/** What a message selects other than a binding: a key for bouncing it, and the value the session acts on. */
export interface SongHit<T> {
  key: string;
  value: T;
}

/** What one message does: the routes it fires, and the song it selects (only when no binding claims the message). */
export interface Received<T> {
  routes: Route[];
  song: T | null;
}

/** Decides what each message or key press runs. Holds the state the modes and the safety rules need, so one instance lives per session. */
export class RemoteRouter {
  readonly echo: EchoFilter;
  readonly bank = new BankTracker();
  private readonly now: () => number;
  /** The last value of each controller, keyed by channel × 128 + controller */
  private readonly previous = new Map<number, number>();
  /** When each binding last accepted a message, keyed by binding, channel and number */
  private readonly accepted = new Map<string, number>();
  /** When each double-press binding was first pressed, by its index */
  private readonly pressed = new Map<number, number>();

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.echo = new EchoFilter(now);
  }

  /** The routes a MIDI message fires. Our own echoed output, and anything unreadable, fires nothing. */
  midi(data: ArrayLike<number>, bindings: readonly Binding[]): Route[] {
    return this.receive(data, bindings, () => null).routes;
  }

  /**
   * One message from the input, read once: the routes it fires, and the song it selects. A binding that answers the message keeps it,
   * so a song trigger on the same message does not also fire. `findSong` is asked only for a message no binding claims, and its hit
   * is bounced like a binding's, so a pedal that sends a change twice loads once. Never throws for a message it cannot read.
   */
  receive<T>(data: ArrayLike<number>, bindings: readonly Binding[], findSong: (event: MidiEvent, bank: BankTracker) => SongHit<T> | null): Received<T> {
    const event = this.readInput(data);
    if (!event) return { routes: [], song: null };
    const controller = event.status === 0xb0 && event.channel !== undefined && event.data1 !== undefined ? event.channel * 128 + event.data1 : -1;
    const before = controller >= 0 ? this.previous.get(controller) : undefined;
    if (controller >= 0) this.previous.set(controller, event.data2 ?? 0);
    const routes: Route[] = [];
    const where = `${event.channel ?? ""}:${event.data1 ?? ""}`;
    let claimed = false;
    for (const [index, binding] of bindings.entries()) {
      if (binding.source !== "midi" || !matchesEvent(binding.match, event, this.bank) || !modeFires(binding.match, event, before)) continue;
      claimed = true;
      if (this.bounced(`${index}:${where}`)) continue;
      routes.push(this.press(binding, index));
    }
    if (claimed) return { routes, song: null };
    const hit = findSong(event, this.bank);
    if (!hit || this.bounced(`song:${hit.key}:${where}`)) return { routes, song: null };
    return { routes, song: hit.value };
  }

  /**
   * One message read for the inputs: our own echo is dropped (null), anything that is not a readable message is null, and a bank select
   * is noted for the program change that follows it. Every consumer reads a message through here, so an echo is used exactly once.
   */
  readInput(data: ArrayLike<number>): MidiEvent | null {
    if (this.echo.consume(data)) return null;
    const event = parseMidi(data);
    if (event) this.bank.observe(event);
    return event;
  }

  /** The routes a key press fires. Callers ignore repeats and typing; this only matches the key. */
  key(key: string, bindings: readonly Binding[]): Route[] {
    const name = normaliseKey(key),
      routes: Route[] = [];
    bindings.forEach((binding, index) => {
      if (binding.source === "key" && binding.match.key === name) routes.push(this.press(binding, index));
    });
    return routes;
  }

  /** What a message means for Learn: the match it would bind, a message to wait on, or nothing to learn. Null for echoes and junk. */
  learnMidi(data: ArrayLike<number>): LearnStep | null {
    const event = this.readInput(data);
    return event ? learnStep(event, this.bank) : null;
  }

  private bounced(key: string): boolean {
    const now = this.now(),
      last = this.accepted.get(key);
    if (last !== undefined && now - last < BOUNCE_MS) return true;
    this.accepted.set(key, now);
    return false;
  }

  private press(binding: Binding, index: number): Route {
    if (!binding.doublePress) return { kind: "fire", binding };
    const now = this.now(),
      first = this.pressed.get(index);
    if (first !== undefined && now - first <= DOUBLE_PRESS_MS) {
      this.pressed.delete(index);
      return { kind: "fire", binding };
    }
    this.pressed.set(index, now);
    return { kind: "armed", binding };
  }
}

export type LearnStep = { kind: "match"; match: MidiMatch; seen: string } | { kind: "wait"; seen: string } | { kind: "ignore"; seen: string };

/** What one message does while Learn is open. Bank select waits for its program change, so the two are learned as one match. */
export function learnStep(event: MidiEvent, bank: BankTracker): LearnStep {
  const seen = describeEvent(event);
  if (event.status === 0xb0 && (event.data1 === 0 || event.data1 === 32)) {
    return { kind: "wait", seen: `${seen}. Now press the program change.` };
  }
  if (event.status in REALTIME) return { kind: "match", match: { status: event.status }, seen };
  if (event.channel === undefined || event.data1 === undefined) return { kind: "ignore", seen: `${seen}. This message cannot be learned.` };
  const channel = event.channel + 1;
  if (event.status === 0x90) return { kind: "match", match: { status: 0x90, channel, data1: event.data1, data2Min: 1, data2Max: 127 }, seen };
  if (event.status === 0x80) return { kind: "match", match: { status: 0x80, channel, data1: event.data1, data2Min: 0, data2Max: 127 }, seen };
  if (event.status === 0xb0 && event.data2 !== undefined) {
    const high = event.data2 >= 64;
    return {
      kind: "match",
      match: { status: 0xb0, channel, data1: event.data1, data2Min: high ? 64 : 0, data2Max: high ? 127 : 63, mode: "momentary" },
      seen,
    };
  }
  if (event.status === 0xc0) {
    const bankNow = bank.current(event.channel);
    return { kind: "match", match: { status: 0xc0, channel, data1: event.data1, ...(bankNow === undefined ? {} : { bank: bankNow }) }, seen };
  }
  return { kind: "ignore", seen: `${seen}. Pitch bend and aftertouch cannot be learned.` };
}

/** The key as bindings store it: a single letter in lower case, so "T" and "t" are one key. */
export function normaliseKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Whether two bindings would respond to the same input. Two bindings that do not overlap may share an action or a control. */
export function overlaps(a: Binding, b: Binding): boolean {
  if (a.source === "key" || b.source === "key") return a.source === "key" && b.source === "key" && a.match.key === b.match.key;
  const x = a.match,
    y = b.match;
  if (x.status !== y.status) return false;
  if (x.channel !== undefined && y.channel !== undefined && x.channel !== y.channel) return false;
  if (x.data1 !== undefined && y.data1 !== undefined && x.data1 !== y.data1) return false;
  if (x.bank !== undefined && y.bank !== undefined && x.bank !== y.bank) return false;
  const rx = rangeOf(x),
    ry = rangeOf(y);
  return rx.min <= ry.max && ry.min <= rx.max;
}

/** The position of the binding that `candidate` would clash with, or -1. */
export function findConflict(bindings: readonly Binding[], candidate: Binding): number {
  return bindings.findIndex((binding) => overlaps(binding, candidate));
}

export function defaultBindings(): Binding[] {
  return [
    { action: "transport.play", source: "midi", match: { status: 0xfa } },
    { action: "transport.play", source: "midi", match: { status: 0xfb } },
    { action: "transport.stop", source: "midi", match: { status: 0xfc } },
    { action: "transport.playPause", source: "midi", match: { status: 0xb0, data1: 80, data2Min: 64, data2Max: 127, mode: "momentary" } },
    { action: "section.nextOrPage", source: "key", match: { key: "PageDown" } },
    { action: "section.previousOrPage", source: "key", match: { key: "PageUp" } },
    { action: "section.nextOrPage", source: "key", match: { key: "ArrowRight" } },
    { action: "section.previousOrPage", source: "key", match: { key: "ArrowLeft" } },
    { action: "tempo.tap", source: "key", match: { key: "t" } },
  ];
}

/** A message in words, with its channel: "Ch 1 · CC 80 = 127". */
export function describeEvent(event: MidiEvent): string {
  if (event.status in REALTIME) return REALTIME[event.status as keyof typeof REALTIME];
  if (event.status >= 0xf8) return "Real-time message";
  if (event.status === 0xf3) return `Song Select ${event.data1 ?? 0}`;
  const channel = event.channel === undefined ? "" : `Ch ${event.channel + 1} · `,
    d1 = event.data1 ?? 0,
    d2 = event.data2 ?? 0;
  switch (event.status) {
    case 0x80:
      return `${channel}Note off ${d1}`;
    case 0x90:
      return `${channel}Note on ${d1}, velocity ${d2}`;
    case 0xb0:
      return `${channel}CC ${d1} = ${d2}`;
    case 0xc0:
      return `${channel}Program ${d1}`;
    default:
      return `${channel}Message ${event.status.toString(16)}`;
  }
}

/** A match in words, as Learn and the list show it: "Ch 3 · CC 80 64–127 · Momentary". */
export function describeMatch(match: MidiMatch): string {
  if (match.status in REALTIME) return REALTIME[match.status as keyof typeof REALTIME];
  const channel = match.channel === undefined ? "Any channel" : `Ch ${match.channel}`,
    { min, max } = rangeOf(match);
  if (match.status === 0x80) return `${channel} · Note ${match.data1 ?? "?"} off`;
  if (match.status === 0x90) return `${channel} · Note ${match.data1 ?? "?"} on`;
  if (match.status === 0xb0) {
    const mode = MIDI_MODES.find((m) => m.id === (match.mode ?? "momentary"))?.label ?? "Momentary";
    return `${channel} · CC ${match.data1 ?? "?"} ${min}–${max} · ${mode}`;
  }
  return `${channel} · Program ${match.data1 ?? "?"}${match.bank === undefined ? "" : ` · bank ${match.bank}`}`;
}

/** A binding in words, for the list and for a clash message. */
export function describeBinding(binding: Binding): string {
  const what = binding.source === "key" ? `Key ${binding.match.key}` : describeMatch(binding.match);
  return `${what}${binding.doublePress ? " · double press" : ""}`;
}

/** Whether a focused element takes typing or arrow keys of its own, so no binding may fire from it. */
const TYPING_ROLES = ["textbox", "combobox", "slider", "spinbutton", "listbox"];
/** Input types that take a click or a space, not text, so a focused one does not hold the keyboard. */
const NON_TEXT_INPUT_TYPES = ["checkbox", "radio", "button", "submit", "reset", "file", "color"];
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // jsdom has no isContentEditable, so the attribute is read as well.
  const editable = target.getAttribute("contenteditable");
  if (target.isContentEditable || editable === "true" || editable === "" || ["TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.includes(target.type)) return true;
  const role = target.getAttribute("role");
  return role !== null && TYPING_ROLES.includes(role);
}

/** Whether a dialog is open. Keys then belong to the dialog. Stage mode is a full-screen dialog that keys must still reach. */
export function dialogOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-stage-mode]), [role="alertdialog"][data-state="open"]:not([data-stage-mode])',
  );
}

export function isModifierKey(key: string): boolean {
  return MODIFIERS.includes(key);
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function sanitizeMidiMatch(raw: unknown): MidiMatch | null {
  if (!isObject(raw) || typeof raw.status !== "number") return null;
  const status = raw.status;
  if (status in REALTIME) return { status };
  if (!(CHANNEL_STATUS as readonly number[]).includes(status)) return null;
  if (!(Number.isInteger(raw.channel) && (raw.channel as number) >= 1 && (raw.channel as number) <= 16)) {
    if (raw.channel !== undefined) return null;
  }
  if (!isDataByte(raw.data1)) return null;
  const match: MidiMatch = { status, data1: raw.data1 };
  if (raw.channel !== undefined) match.channel = raw.channel as number;
  if (status === 0xc0) {
    if (raw.bank !== undefined) {
      if (!(Number.isInteger(raw.bank) && (raw.bank as number) >= 0 && (raw.bank as number) <= 16383)) return null;
      match.bank = raw.bank as number;
    }
    return match;
  }
  if (raw.data2Min !== undefined) {
    if (!isDataByte(raw.data2Min)) return null;
    match.data2Min = raw.data2Min;
  }
  if (raw.data2Max !== undefined) {
    if (!isDataByte(raw.data2Max)) return null;
    match.data2Max = raw.data2Max;
  }
  if (match.data2Min !== undefined && match.data2Max !== undefined && match.data2Min > match.data2Max) return null;
  if (status === 0xb0 && raw.mode !== undefined) {
    if (!MIDI_MODES.some((m) => m.id === raw.mode)) return null;
    match.mode = raw.mode as MidiMode;
  }
  return match;
}

function sanitizeBinding(raw: unknown): Binding | null {
  if (!isObject(raw) || !isActionId(raw.action)) return null;
  const def = ACTIONS[raw.action];
  let index: number | undefined;
  if (def.number) {
    const { min, max } = def.number;
    if (!(Number.isInteger(raw.index) && (raw.index as number) >= min && (raw.index as number) <= max)) return null;
    index = raw.index as number;
  } else if (raw.index !== undefined) {
    return null;
  }
  const base: BindingBase = { action: raw.action, ...(index === undefined ? {} : { index }), ...(raw.doublePress === true ? { doublePress: true } : {}) };
  if (raw.source === "key") {
    const key = isObject(raw.match) ? raw.match.key : undefined;
    if (typeof key !== "string" || key.length === 0 || key.length > 20) return null;
    return { ...base, source: "key", match: { key: normaliseKey(key) } };
  }
  if (raw.source === "midi") {
    const match = sanitizeMidiMatch(raw.match);
    return match ? { ...base, source: "midi", match } : null;
  }
  return null;
}

/**
 * The bindings as stored, with anything malformed dropped and a clash removed (the first of two overlapping bindings is kept). Never
 * throws: a broken stored list gives a shorter list, not a broken app.
 */
export function sanitizeBindings(raw: unknown): Binding[] {
  if (!Array.isArray(raw)) return [];
  const kept: Binding[] = [];
  for (const item of raw) {
    const binding = sanitizeBinding(item);
    if (binding && findConflict(kept, binding) < 0) kept.push(binding);
  }
  return kept;
}

/** What Learn is binding: the source to learn from, and the action (with its number) the binding runs. */
export interface ActionLearnTarget {
  source: "midi" | "key";
  action: ActionId;
  index?: number;
}

/** What Learn is setting: the MIDI trigger of one saved song (see song-triggers.ts). */
export interface SongLearnTarget {
  source: "song";
  songId: string;
}

export type LearnTarget = ActionLearnTarget | SongLearnTarget;

/** Learn's state: what is being learned, and what was last seen or decided. Not stored. */
export interface LearnState {
  target: LearnTarget | null;
  seen: string;
  result: string;
}

export const useRemoteLearn = create<LearnState>(() => ({ target: null, seen: "", result: "" }));

export function startLearn(target: LearnTarget): void {
  useRemoteLearn.setState({ target, seen: "", result: "" });
}

export function stopLearn(result = ""): void {
  useRemoteLearn.setState({ target: null, seen: "", result });
}
