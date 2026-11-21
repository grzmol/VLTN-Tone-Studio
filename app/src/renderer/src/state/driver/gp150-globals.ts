// Pedal settings of the GP-150: what a settings UI needs (labels, ranges, enum names) on top of the protocol's record
// table (gp150/lib/protocol.mjs GLOBALS). Facts: the GP-180 captures of majabojarska/Valeton-GP180-Rev-Eng, one capture
// per Suite setting (its name gives the menu entry and the values stepped through). The factory reset is no setting:
// nothing here reaches it, and the codec refuses to build it.
import { GLOBALS, GLOBAL_EQ, type GlobalName as Gp150GlobalName } from "@/gp150/lib/protocol.mjs";
import type { GlobalRecord, GlobalSpec } from "../device-types";

export type { Gp150GlobalName };
export type Gp150Globals = Partial<Record<Gp150GlobalName, number>>;

/** One GP-150 setting, shaped like the GP-5 family's GlobalSpec; `id` = record << 8 | byte offset. */
export interface Gp150GlobalSpec extends Omit<GlobalSpec, "name" | "addr" | "since"> {
  name: Gp150GlobalName;
  id: number;
}

const OFF_ON = ["Off", "On"] as const;
const CHANNELS = ["Omni", ...Array.from({ length: 16 }, (_, i) => String(i + 1))];
/**
 * External footswitch functions, values 0-16. Known from the captures: 0 = Patch +, 1 = Patch −, 16 = what a pedal
 * leaves set; the names of the others are not known, so they show by number.
 */
const FS_FUNCTIONS = ["Patch +", "Patch −", ...Array.from({ length: 14 }, (_, i) => `Function ${i + 3}`), "Default"];

type SpecInput = Omit<Gp150GlobalSpec, "name" | "id" | "kind" | "min" | "max"> & ({ min: number; max: number } | { labels: readonly string[]; min?: number });

function spec(name: Gp150GlobalName, s: SpecInput): Gp150GlobalSpec {
  const id = (GLOBALS[name].cmd << 8) | GLOBALS[name].off;
  if ("labels" in s && s.labels) {
    const min = s.min ?? 0;
    return { ...s, name, id, kind: "enum", min, max: min + s.labels.length - 1 };
  }
  return { ...(s as Omit<Gp150GlobalSpec, "name" | "id" | "kind">), name, id, kind: "number" };
}

const level = (label: string, group: GlobalSpec["group"]): SpecInput => ({ label, group, min: -20, max: 20, unit: "dB" });
/**
 * The Bluetooth and Mic record levels run from −21 dB, the lowest value a GP-180 (firmware 1.1.1, over USB) has
 * reported for them, up to +20. The raw value is the signed i16 dB value, so −21 is 0xFFEB.
 */
const recordLevel = (label: string): SpecInput => ({ label, group: "recording", min: -21, max: 20, unit: "dB" });

/** Every setting the GP-150 reports, in Suite's menu order. */
export const GP150_GLOBAL_SPECS: readonly Gp150GlobalSpec[] = Object.freeze([
  spec("inputLevel", level("Input level", "audio")),
  spec("outputStereo", { label: "Right output", group: "audio", labels: ["Mono", "Stereo"] }),
  spec("noCabL", { label: "No cab, left output", group: "audio", labels: OFF_ON }),
  spec("noCabR", { label: "No cab, right output", group: "audio", labels: OFF_ON }),
  spec("autoCabMatch", { label: "Auto cab match", group: "audio", labels: OFF_ON }),
  spec("micLevel", { label: "Mic level", group: "audio", min: 0, max: 100 }),
  spec("micMonitor", { label: "Mic monitor", group: "audio", labels: OFF_ON }),
  spec("micJack", { label: "Mic/phones jack", group: "audio", labels: ["TRS", "TRRS"] }),
  spec("globalEq", { label: "Global EQ", group: "audio", labels: OFF_ON }),
  spec("usbRecLevel", level("USB record level", "recording")),
  spec("btRecLevel", recordLevel("Bluetooth record level")),
  spec("micRecLevel", recordLevel("Mic record level")),
  spec("recModeL", { label: "Record mode, left", group: "recording", labels: ["Dry", "Wet"] }),
  spec("recModeR", { label: "Record mode, right", group: "recording", labels: ["Dry", "Wet"] }),
  spec("usbMonitorLevel", level("USB monitor level", "recording")),
  spec("btAudioLevel", { label: "Bluetooth audio level", group: "recording", min: 0, max: 100 }),
  spec("fsMode", { label: "Footswitch mode", group: "controls", labels: ["Patch", "Stomp"] }),
  spec("autoSave", { label: "Auto save", group: "controls", labels: OFF_ON }),
  spec("expJack", { label: "EXP / MIDI in jack", group: "controls", labels: ["MIDI in", "Expression pedal"] }),
  spec("fsJack", { label: "FS / MIDI out jack", group: "controls", labels: ["MIDI out", "Single footswitch", "Double footswitch"] }),
  spec("extFs1", { label: "External footswitch 1", group: "controls", labels: FS_FUNCTIONS }),
  spec("extFs2", { label: "External footswitch 2", group: "controls", labels: FS_FUNCTIONS }),
  spec("tapPre", { label: "Tap tempo sets PRE", group: "controls", labels: OFF_ON }),
  spec("tapMod", { label: "Tap tempo sets MOD", group: "controls", labels: OFF_ON }),
  spec("tapDly", { label: "Tap tempo sets DLY", group: "controls", labels: OFF_ON }),
  spec("midiInSource", { label: "MIDI in", group: "midi", labels: ["TRS only", "USB only", "Bluetooth only", "Mixed"] }),
  spec("midiInChannelTrs", { label: "MIDI in channel (TRS)", group: "midi", labels: CHANNELS }),
  spec("midiInChannelUsb", { label: "MIDI in channel (USB)", group: "midi", labels: CHANNELS }),
  spec("midiInChannelBt", { label: "MIDI in channel (Bluetooth)", group: "midi", labels: CHANNELS }),
  spec("midiOutChannelTrs", { label: "MIDI out channel (TRS)", group: "midi", labels: CHANNELS }),
  spec("midiOutChannelUsb", { label: "MIDI out channel (USB)", group: "midi", labels: CHANNELS }),
  spec("midiOutChannelBt", { label: "MIDI out channel (Bluetooth)", group: "midi", labels: CHANNELS }),
  spec("clockSource", { label: "Tempo clock source", group: "midi", labels: ["Internal", "TRS only", "USB only", "External", "Mixed"] }),
  spec("clockOutTrs", { label: "Send clock (TRS)", group: "midi", labels: OFF_ON }),
  spec("cloudOutUsb", { label: "Cloud out (USB)", group: "midi", labels: OFF_ON }),
  spec("brightness", { label: "Display brightness", group: "display", labels: ["I", "II", "III"] }),
  spec("displayTimeout", { label: "Display off after", group: "display", labels: ["5 minutes", "30 minutes", "Never"] }),
]);

const BY_NAME: Readonly<Record<string, Gp150GlobalSpec>> = Object.fromEntries(GP150_GLOBAL_SPECS.map((s) => [s.name, s]));

/** The spec of a GP-150 setting, or a RangeError for any other name (a GP-5 or GP-200 setting). */
export function gp150GlobalSpec(name: string): Gp150GlobalSpec {
  const s = Object.hasOwn(BY_NAME, name) ? BY_NAME[name] : undefined;
  if (!s) throw new RangeError(`The GP-150 has no setting ${name}`);
  return s;
}

/** The value the pedal stores for `value`: whole numbers within the setting's range. */
export function clampGp150Global(name: string, value: number): number {
  const s = gp150GlobalSpec(name);
  if (!Number.isFinite(value)) throw new RangeError(`${s.label}: ${value} is not a number`);
  return Math.max(s.min, Math.min(s.max, Math.round(value)));
}

/** Diagnostics records of the settings reply: a = record, b = byte offset. */
export function gp150GlobalRecords(values: Gp150Globals): GlobalRecord[] {
  return (Object.keys(GLOBALS) as Gp150GlobalName[])
    .filter((name) => values[name] !== undefined)
    .map((name) => ({ a: GLOBALS[name].cmd, b: GLOBALS[name].off, len: GLOBALS[name].type === "u8" ? 1 : 2, value: values[name] as number }));
}

// ------------------------------------------------------------------------------------------- Global EQ

/**
 * The app's Global EQ (GlobalEq, 31 values in the GP-200's order) ↔ the GP-150's record: GP-200 value i < 30 is GP-150
 * value i + 2, the level (GP-200 30) is GP-150 1; GP-150 value 0, the EQ's on/off, is the "Global EQ" switch elsewhere.
 */
export const gp150EqIndex = (appIndex: number): number => (appIndex === 30 ? GLOBAL_EQ.LEVEL : appIndex + GLOBAL_EQ.BANDS_AT);

/** The pedal's 32 values → the app's 31. */
export const appEqValues = (values: readonly number[]): number[] => Array.from({ length: 31 }, (_, i) => values[gp150EqIndex(i)]);
