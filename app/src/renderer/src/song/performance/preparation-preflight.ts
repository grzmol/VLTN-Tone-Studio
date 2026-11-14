import type { PreflightOptions, PreflightIssue } from "./midi-preflight";
import { chaseTriggerSet, triggerKey } from "./midi-chase";
import type { PreparationSequence } from "./preparation-sequence";

/** Advice about the commands that will actually run, after repeat rules have been applied. Never rewrites a plan. */
export function preparationPreflight(plan: PreparationSequence, pedals: PreflightOptions["pedals"]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const programs = new Map<number, number[]>();
  const triggers = chaseTriggerSet(pedals.flatMap((pedal) => pedal.triggers ?? []));
  const warnedTriggers = new Set<string>();
  let note = false,
    transport = false;
  for (const step of plan.steps) {
    if (step.kind !== "send") continue;
    for (const { bytes } of step.commands) {
      const kind = bytes[0] & 240,
        channel = (bytes[0] & 15) + 1;
      if (kind === 192) programs.set(channel, [...(programs.get(channel) ?? []), bytes[1]]);
      if (step.origin !== "custom") continue;
      if (kind === 144 && bytes[2] > 0) note = true;
      if (bytes[0] === 250 || bytes[0] === 251) transport = true;
      const key = triggerKey(channel, bytes[1]);
      if (kind === 176 && bytes[2] > 0 && triggers.has(key)) warnedTriggers.add(key);
    }
  }
  for (const [channel, values] of programs)
    if (values.length > 1)
      issues.push({
        code: "preparation-presets",
        text: `Before song recalls ${values.length} presets on channel ${channel} (PC ${values.join(" → PC ")}). The last recall wins; confirm this order is intentional.`,
      });
  for (const key of warnedTriggers)
    issues.push({
      code: "preparation-trigger",
      text: `Before song sends CC${key.split(":")[1]} on channel ${key.split(":")[0]}, matching a configured trigger. It acts before the count-in and audio; check whether it belongs at Play or a song time instead.`,
    });
  if (note)
    issues.push({
      code: "preparation-note",
      text: "Before song sends a note-on before the count-in and audio. Check its note-off and whether it should be timed with the song.",
    });
  if (transport)
    issues.push({
      code: "preparation-transport",
      text: "Before song sends MIDI Start or Continue before the count-in and audio. A receiving drum machine or looper may start early.",
    });
  return issues.slice(0, 100);
}
