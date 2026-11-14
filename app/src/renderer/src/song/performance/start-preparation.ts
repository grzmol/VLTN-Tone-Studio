import { PREPARATION_TOKEN, withPreparationWait } from "./preparation-wait";
import { PreparationHistory, preparationTrigger, type PreparationRepeat, type PreparationCommand } from "./preparation-repeat";
import { create } from "zustand";
import { removeCueToken, type Cue } from "./chart";
import { cueCommandText } from "./cue-token";
import { computeChaseState, type TriggerCc, chaseTriggerSet } from "./midi-chase";
export interface PreparationSettings {
  enabled: boolean;
  settleMs: number;
  openingPresets: boolean;
  commandGapMs?: number;
}
export const PREPARATION_DEFAULTS: PreparationSettings = { enabled: true, settleMs: 1000, openingPresets: true };
const KEY = "vltn.performance.preparation.v1";
export function preparationSettings(value: unknown, defaults = PREPARATION_DEFAULTS): PreparationSettings {
  const saved = value && typeof value === "object" ? (value as Partial<PreparationSettings>) : {};
  return {
    enabled: typeof saved.enabled === "boolean" ? saved.enabled : defaults.enabled,
    settleMs: typeof saved.settleMs === "number" && Number.isFinite(saved.settleMs) ? Math.max(0, Math.min(10000, saved.settleMs)) : defaults.settleMs,
    openingPresets: typeof saved.openingPresets === "boolean" ? saved.openingPresets : defaults.openingPresets,
    ...(typeof saved.commandGapMs === "number" || typeof defaults.commandGapMs === "number"
      ? {
          commandGapMs:
            typeof saved.commandGapMs === "number" && Number.isFinite(saved.commandGapMs)
              ? Math.max(0, Math.min(10000, saved.commandGapMs))
              : (defaults.commandGapMs ?? 0),
        }
      : {}),
  };
}
function stored(): PreparationSettings {
  try {
    return preparationSettings(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return { ...PREPARATION_DEFAULTS };
  }
}
export const usePreparationDefaults = create<{ settings: PreparationSettings; set(settings: PreparationSettings): void }>((set) => ({
  settings: stored(),
  set(settings) {
    const valid = preparationSettings(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(valid));
    } catch {
      /* Keep it for this session. */
    }
    set({ settings: valid });
  },
}));
/** Only presets and bank select move automatically. Notes and rhythm/looper triggers keep their song times. */
export function isPresetMessage(bytes: readonly number[]): boolean {
  return (bytes[0] & 240) === 192 || ((bytes[0] & 240) === 176 && [0, 32].includes(bytes[1]));
}
export interface StartPreparation {
  opening: number[][];
  commands: PreparationCommand[];
  suppressed: number[][];
}
export function startPreparation(
  cues: Cue[],
  position: number,
  settings: PreparationSettings,
  triggers: TriggerCc[] = [],
  repeats: { history: PreparationHistory; atBeginning: boolean } = { history: new PreparationHistory(), atBeginning: position <= 0.001 },
): StartPreparation {
  const explicit = repeats.history.commands(cues, repeats.atBeginning);
  if (!settings.enabled) {
    if (cues.some((cue) => cue.trigger === "prepare" && cue.messages.length))
      throw new Error("Enable Before song preparation to run this song's preparation commands.");
    return { opening: [], commands: [], suppressed: [] };
  }
  const opening: number[][] = [];
  if (settings.openingPresets) {
    // Reapply load presets so an immediate Play still gives them their full loading wait.
    // Managed rhythm memory has its own preparation, and other load actions remain one-shot.
    opening.push(...cues.filter((cue) => cue.trigger === "load" && !cue.managed).flatMap((cue) => cue.messages.filter(isPresetMessage)));
    opening.push(
      ...computeChaseState(cues, position, chaseTriggerSet(triggers))
        .map((message) => message.bytes)
        .filter(isPresetMessage),
    );
    for (const cue of cues) {
      if (cue.trigger || Math.abs(cue.time - position) > 0.001) continue;
      for (const bytes of cue.messages)
        if (isPresetMessage(bytes)) {
          opening.push(bytes);
        }
    }
  }
  return { opening, commands: explicit, suppressed: opening };
}
/** Named pedal and macro pickers keep their labels and message order in the preparation phase. */
export function preparationLine(line: string, repeat: PreparationRepeat = "always", waitMs = 0): string {
  return withPreparationWait(
    line.replace(/^\s*\[[^\]]*\]\s*/, "").replace(/\{midi:([^}]+)\}/g, (_, command: string) => `{midi@${preparationTrigger(repeat)}:${command.trim()}}`),
    waitMs,
  );
}
/** Move an entire command line, preserving bank/PC pairs and macro order without moving lyrics or timed cues. */
export function movePreparationLine(chart: string, cue: Cue, direction: 1 | -1): string | null {
  const lines = chart.split(/\r?\n/);
  const at = cue.source?.line;
  if (at === undefined || !lines[at]?.includes(cue.source!.text)) return null;
  const eligible = (line: string) =>
    [...line.matchAll(PREPARATION_TOKEN)].length > 0 &&
    !line
      .split("//")[0]
      .replace(PREPARATION_TOKEN, "")
      .replace(/\{label:[^}]*\}/g, "")
      .trim();
  const positions = lines.flatMap((line, index) => (eligible(line) ? [index] : []));
  const index = positions.indexOf(at),
    target = positions[index + direction];
  if (index < 0 || target === undefined) return null;
  [lines[at], lines[target]] = [lines[target], lines[at]];
  return lines.join(chart.includes("\r\n") ? "\r\n" : "\n");
}
/** An incoming song that prepares pedals must wait until the outgoing song has finished. */
export function savedPreparation(settings: Record<string, string>, defaults = usePreparationDefaults.getState().settings): PreparationSettings {
  try {
    return preparationSettings(JSON.parse(settings[":options"] || "{}").preparation, defaults);
  } catch {
    return { ...defaults };
  }
}

/** Move a user cue without changing its MIDI bytes or deleting the lyric line it accompanies. */
export function moveCueToPreparation(chart: string, cue: Cue): string | null {
  if (cue.managed || cue.fromFile || cue.trigger === "prepare" || cue.trigger === "section") return null;
  const removed = removeCueToken(chart, cue);
  if (removed === null) return null;
  let line: string;
  if (cue.line && !cue.text) line = preparationLine(cue.line.text);
  else {
    const command = cueCommandText(cue)?.replace(/^@(load|play|stop|end)\s+/, "");
    if (!command) return null;
    line = `${cue.label ? `{label:${cue.label}} ` : ""}{midi@prepare:${command}}`;
  }
  return [removed.trimEnd(), line].filter(Boolean).join(chart.includes("\r\n") ? "\r\n" : "\n");
}

/** Change the repeat policy for the complete preparation line, keeping bank/PC pairs together. */
export function setPreparationRepeat(chart: string, cue: Cue, repeat: PreparationRepeat): string | null {
  const source = cue.source;
  if (!source || cue.trigger !== "prepare" || cue.managed) return null;
  const lines = chart.split(/\r?\n/),
    line = lines[source.line];
  if (line === undefined || line.slice(source.start, source.end) !== source.text) return null;
  const commentAt = line.search(/(^|\s)\/\//),
    code = commentAt < 0 ? line : line.slice(0, commentAt);
  lines[source.line] =
    code.replace(/\{midi@prepare(?:-beginning|-once)?(?=\s|:)/g, `{midi@${preparationTrigger(repeat)}`) + (commentAt < 0 ? "" : line.slice(commentAt));
  return lines.join(chart.includes("\r\n") ? "\r\n" : "\n");
}

/** Set the wait on a complete preparation line without moving its lyrics, comment or repeat rules. */
export function setPreparationWait(chart: string, cue: Cue, milliseconds: number): string | null {
  const source = cue.source;
  if (!source || cue.trigger !== "prepare" || cue.managed) return null;
  const lines = chart.split(/\r?\n/),
    line = lines[source.line];
  if (line === undefined || line.slice(source.start, source.end) !== source.text) return null;
  lines[source.line] = withPreparationWait(line, milliseconds);
  return lines.join(chart.includes("\r\n") ? "\r\n" : "\n");
}
