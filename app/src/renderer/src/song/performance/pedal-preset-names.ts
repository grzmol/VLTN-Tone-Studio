// GP-150 and GP-180 cues recall a preset by number, but the player thinks in preset names. These helpers label the recall actions with the
// pedal's own names and write the name into the cue's label, so a later preflight can tell when the slot holds a different sound. The cue's
// bytes never change, which keeps old charts valid.
import type { Cue } from "./chart";

export type PresetModel = "gp150" | "gp180";

/** The pedal's preset names, index = slot (the program number the cue sends), and where they came from. */
export interface PresetNames {
  names: string[];
  source: "live" | "cached";
  /** The model the names belong to. Cues recalling another model are not checked against them. */
  model?: PresetModel;
}

const MODEL_NAME: Record<PresetModel, string> = { gp150: "GP-150", gp180: "GP-180" };
const PROFILE_MODEL: Record<string, PresetModel> = { "valeton-gp150": "gp150", "valeton-gp180": "gp180" };
const CUE_LABEL = /^GP-1([58])0: (\d{3}) (.+)$/;

/** The pedal model whose presets a pedal profile recalls, or null for a profile whose memories have no names to read. */
export function presetModelOf(profileId: string): PresetModel | null {
  return Object.hasOwn(PROFILE_MODEL, profileId) ? PROFILE_MODEL[profileId] : null;
}

/** "069" for the memory the pedal shows as number 69 (slot 68). */
export function presetNumber(slot: number): string {
  return String(slot + 1).padStart(3, "0");
}

/** The picker's label for a memory: "069 Crunch Lead", or "Recall memory 069" while no name is known. */
export function presetLabel(slot: number, names: readonly string[]): string {
  const name = names[slot]?.trim();
  return name ? `${presetNumber(slot)} ${name}` : `Recall memory ${presetNumber(slot)}`;
}

/** The label a cue carries: "GP-180: 069 Crunch Lead". The braces that would end the `{label:…}` token are removed. */
export function presetCueLabel(model: PresetModel, slot: number, name: string): string {
  return `${MODEL_NAME[model]}: ${presetNumber(slot)} ${name.replace(/[{}\r\n]/g, " ").trim()}`;
}

/** Names that are in use: live ones win, then the last connection's. Empty when the pedal has never been read. */
export function usablePresetNames(model: PresetModel, live: PresetNames | null, cached: readonly string[]): PresetNames | null {
  if (live?.names.some((n) => n.trim())) return { ...live, model };
  return cached.some((n) => n.trim()) ? { names: [...cached], source: "cached", model } : null;
}

/** The line under the preset list that says where its names came from. */
export function nameSource(names: PresetNames | null, lastConnectedAt: number | null): string {
  if (!names) return "Connect the pedal in the editor to see preset names";
  if (names.source === "live") return "Names read from the pedal just now";
  return lastConnectedAt ? `Names from the last connection on ${new Date(lastConnectedAt).toLocaleDateString()}` : "Names from the last connection";
}

export interface PresetCueTarget {
  slot: number;
  /** The name written into the cue's label, or null when the cue was made without one (or its label no longer matches its bytes). */
  name: string | null;
  model: PresetModel | null;
}

/**
 * The preset a cue recalls: its messages are the banked recall the profile builds, CC0 (bank) then a program change, both on `pedalChannel`
 * (1–16). Null for any other cue.
 */
export function presetCueTarget(cue: Pick<Cue, "messages" | "label">, pedalChannel: number): PresetCueTarget | null {
  const [bank, program] = cue.messages;
  const status = pedalChannel - 1;
  if (cue.messages.length !== 2 || bank[0] !== (0xb0 | status) || bank[1] !== 0 || program[0] !== (0xc0 | status)) return null;
  const slot = bank[2] * 128 + program[1];
  const found = CUE_LABEL.exec(cue.label ?? "");
  // A label whose number disagrees with the bytes was edited by hand; the bytes win and the stale name is ignored.
  if (!found || Number(found[2]) !== slot + 1) return { slot, name: null, model: null };
  return { slot, name: found[3].trim(), model: found[1] === "5" ? "gp150" : "gp180" };
}
