import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { CHASE_LEAD_MS, MOMENTARY_CCS, chaseTriggerSet, computeChaseState, isChased, type TriggerCc } from "./midi-chase";
import { PEDAL_PROFILES, actionCommands } from "./pedal-profiles";

const bytes = (text: string, position: number) => computeChaseState(parseChart(text), position).map((m) => m.bytes);
const bytesWith = (text: string, position: number, triggers: TriggerCc[]) =>
  computeChaseState(parseChart(text), position, chaseTriggerSet(triggers)).map((m) => m.bytes);

it("keeps only the latest program change, with its bank, when starting at 1:30", () => {
  const text = "[00:00] {midi:cc 1 0 0} {midi:pc 1 1}\n[00:40] {midi:cc 1 0 0} {midi:pc 1 2}\n[01:10] {midi:cc 1 0 1} {midi:pc 1 3}";
  expect(bytes(text, 90)).toEqual([
    [176, 0, 1],
    [192, 3],
  ]);
});
it("does not chase anything at the start or from cues at or after the position", () => {
  expect(bytes("[00:00] {midi:pc 1 1}", 0)).toEqual([]);
  expect(bytes("[01:30] {midi:pc 1 1}", 90)).toEqual([]);
});
it("sends the latest value of each controller only", () => {
  expect(bytes("[00:10] {midi:cc 1 20 10}\n[01:00] {midi:cc 1 20 99}\n[00:30] {midi:cc 1 21 5}", 90)).toEqual([
    [176, 21, 5],
    [176, 20, 99],
  ]);
});
it("keeps channels separate and orders program changes before controllers before SysEx", () => {
  const text = "[00:01] {chase} {midi:sysex f0 7d 01 f7}\n[00:02] {midi:cc 1 20 1}\n[00:03] {midi:pc 2 5}\n[00:04] {midi:pc 1 6}";
  expect(bytes(text, 10)).toEqual([
    [193, 5],
    [192, 6],
    [176, 20, 1],
    [240, 125, 1, 247],
  ]);
});
it("never chases looper, tap or footswitch triggers, notes or clock, unless a cue says {chase}", () => {
  expect(bytes("[00:10] {midi:cc 1 87 127}\n[00:11] {midi:cc 1 64 127}\n[00:12] {midi:note 1 60 100}", 90)).toEqual([]);
  expect(bytes("[00:10] {chase} {midi:cc 1 87 127}", 90)).toEqual([[176, 87, 127]]);
});
it("honours {nochase} and leaves SysEx out by default", () => {
  expect(bytes("[00:10] {nochase} {midi:pc 1 4}\n[00:11] {midi:sysex f0 7d 01 f7}", 90)).toEqual([]);
});
it("rejects a cue that is both {chase} and {nochase}", () => {
  expect(() => parseChart("[00:10] {chase} {nochase} {midi:pc 1 4}")).toThrow("either");
});
it("reports whether a message is chased", () => {
  const [cue] = parseChart("[00:10] {midi:cc 1 20 1}");
  expect(isChased(cue, [176, 20, 1])).toBe(true);
  expect(isChased(cue, [144, 60, 100])).toBe(false);
});
it("keeps the raw-CC deny list to numbers the built-in profiles use only for fixed-CC triggers", () => {
  const ccs = (momentary: boolean) =>
    new Set(
      PEDAL_PROFILES.flatMap((profile) => profile.actions.filter((a) => !a.assignment && !!a.momentary === momentary))
        .flatMap((a) => actionCommands(a, 1, a.value?.default))
        .map((command) => command.split(" "))
        .filter(([type]) => type === "cc")
        .map((parts) => Number(parts[2])),
    );
  const state = ccs(false);
  expect([...MOMENTARY_CCS].filter((cc) => state.has(cc))).toEqual([]);
  for (const cc of [24, 64, 75, 87, 93]) expect(ccs(true).has(cc)).toBe(true);
});
it("marks pedal-library triggers as momentary", () => {
  const action = (profile: string, id: string) => PEDAL_PROFILES.find((p) => p.id === profile)!.actions.find((a) => a.id === id)!;
  expect(action("strymon-timeline", "record").momentary).toBe(true);
  expect(action("valeton-gp150", "loop-play").momentary).toBe(true);
  expect(action("boss-rc10r", "loop-start").momentary).toBe(true);
  expect(action("valeton-gp180", "memory-1").momentary).toBeUndefined();
});
it("never replays an assigned trigger controller on its channel, while the pedal state around it still is", () => {
  // The 11-H3 hardware case: the RC-10R on channel 2 has its looper start and stop assigned to CC 70 and 71.
  const text = "[00:10] {midi:pc 1 4}\n[00:20] {midi:cc 1 11 90}\n[00:30] {midi:cc 2 70 127}\n[01:10] {midi:cc 2 71 127}";
  expect(bytesWith(text, 90, [[2, 70], [2, 71]])).toEqual([
    [192, 4],
    [176, 11, 90],
  ]);
});
it("replays an assigned trigger controller when its cue says {chase}", () => {
  expect(bytesWith("[00:10] {chase} {midi:cc 2 70 127}", 90, [[2, 70]])).toEqual([[177, 70, 127]]);
});
it("only skips an assigned trigger on the channel the pedal is set to", () => {
  expect(bytesWith("[00:10] {midi:cc 1 70 127}", 90, [[2, 70]])).toEqual([[176, 70, 127]]);
});
it("keeps MOMENTARY_CCS as the fallback when no assignment is known", () => {
  expect(bytesWith("[00:10] {midi:cc 2 70 127}\n[00:11] {midi:cc 2 87 127}", 90, [])).toEqual([[177, 70, 127]]);
  expect(bytes("[00:10] {midi:cc 2 87 127}", 90)).toEqual([]);
});
it("leads the audio by 100 ms", () => {
  expect(CHASE_LEAD_MS).toBe(100);
});
