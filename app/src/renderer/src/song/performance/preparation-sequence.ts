import type { Cue } from "./chart";
import type { TriggerCc } from "./midi-chase";
import { orderForPedal } from "./midi-pedal-order";
import { PreparationHistory, type PreparationCommand } from "./preparation-repeat";
import { hasPedalRhythm, rhythmMemory, RHYTHM_MEMORY_SETTLE_MS } from "./rhythm-runtime";
import { isPresetMessage, startPreparation, type PreparationSettings } from "./start-preparation";

export type PreparationStep =
  | { kind: "send"; label: string; origin: "automatic" | "custom" | "tempo"; atMs: number; commands: PreparationCommand[] }
  | { kind: "wait"; label: string; atMs: number; durationMs: number };
export interface PreparationSequence {
  steps: PreparationStep[];
  totalWaitMs: number;
  suppressed: number[][];
  skipped: { label: string; reason: string }[];
}

/** Consecutive bank selects and their program change are one command, with no wait inside the pair. */
export function presetGroups(messages: number[][]): number[][][] {
  const groups: number[][][] = [];
  let banks: number[][] = [];
  const flush = () => {
    if (banks.length) groups.push(banks);
    banks = [];
  };
  for (const bytes of messages) {
    const bank = isPresetMessage(bytes) && (bytes[0] & 240) === 176;
    if (banks.length && (bytes[0] & 15) !== (banks[0][0] & 15)) flush();
    if (bank) banks.push(bytes);
    else {
      groups.push([...banks, bytes]);
      banks = [];
    }
  }
  flush();
  return groups;
}

/** The preview and sender consume this same ordered plan. Times describe configured waits, not hardware acknowledgement. */
export function preparationSequence({
  cues,
  position,
  requestedPosition = position,
  start,
  settings,
  triggers = [],
  history,
  pedalChannel,
  tempo,
}: {
  cues: Cue[];
  position: number;
  requestedPosition?: number;
  start: number;
  settings: PreparationSettings;
  triggers?: TriggerCc[];
  history: PreparationHistory;
  pedalChannel: number;
  tempo: number[][] | null;
}): PreparationSequence {
  const atBeginning = Math.abs(requestedPosition - start) <= 0.001;
  const opening = startPreparation(cues, position, settings, triggers, { history, atBeginning });
  if (!settings.enabled) return { steps: [], totalWaitMs: 0, suppressed: [], skipped: [] };
  const steps: PreparationStep[] = [],
    skipped: PreparationSequence["skipped"] = [];
  let atMs = 0,
    groupsSent = 0;
  const wait = (durationMs: number, label: string) => {
    if (durationMs <= 0) return;
    steps.push({ kind: "wait", label, atMs, durationMs });
    atMs += durationMs;
  };
  const send = (commands: PreparationCommand[], label: string, origin: "automatic" | "custom", waitAfterMs = 0) => {
    if (!commands.length) return;
    if (groupsSent) wait(settings.commandGapMs ?? 0, "Between setup commands");
    steps.push({ kind: "send", origin, label, atMs, commands });
    groupsSent++;
    wait(waitAfterMs, `Wait after ${label}`);
  };
  const memory = rhythmMemory(cues);
  if (memory.length)
    send(
      memory.map((bytes) => ({ bytes })),
      "RC-10R memory",
      "automatic",
    );
  for (const group of presetGroups(orderForPedal(opening.opening, pedalChannel, (bytes) => bytes)))
    send(
      group.map((bytes) => ({ bytes })),
      "Opening preset",
      "automatic",
    );
  for (const group of history.groups(cues, atBeginning)) {
    if (group.skipped) skipped.push({ label: group.label, reason: group.skipped });
    else send(group.commands, group.label, "custom", group.waitAfterMs);
  }
  if (groupsSent) wait(Math.max(settings.settleMs, hasPedalRhythm(cues) ? RHYTHM_MEMORY_SETTLE_MS : 0), "Waiting for pedals");
  if (tempo?.length) {
    steps.push({ kind: "send", origin: "tempo", label: "Song tempo", atMs, commands: tempo.map((bytes) => ({ bytes })) });
    wait(groupsSent ? 100 : settings.settleMs, "Setting song tempo");
  }
  return { steps, totalWaitMs: atMs, suppressed: opening.suppressed, skipped };
}
