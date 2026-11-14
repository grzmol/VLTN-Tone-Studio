import { expect, it } from "vitest";
import { PEDAL_PROFILES, actionCommands, parsePedalProfile, CUSTOM_PEDAL_TEMPLATE } from "./pedal-profiles";
import { parseChart, scheduleCues } from "./chart";
const action = (profile: string, id: string) => PEDAL_PROFILES.find((p) => p.id === profile)!.actions.find((a) => a.id === id)!;

it.each(PEDAL_PROFILES)("validates every builtin action for $name", (profile) => {
  expect(parsePedalProfile(JSON.stringify(profile))).toEqual(profile);
  expect(new Set(profile.actions.map((a) => a.id)).size).toBe(profile.actions.length);
});
it("sends bank select before PC at both GP-180 and TimeLine bank boundaries", () => {
  expect(actionCommands(action("valeton-gp180", "memory-128"), 3)).toEqual(["cc 3 0 0", "pc 3 127"]);
  expect(actionCommands(action("valeton-gp180", "memory-129"), 3)).toEqual(["cc 3 0 1", "pc 3 0"]);
  expect(actionCommands(action("valeton-gp180", "memory-200"), 3)).toEqual(["cc 3 0 1", "pc 3 71"]);
  expect(action("strymon-timeline", "memory-129").label).toContain("64A");
  expect(actionCommands(action("strymon-timeline", "memory-129"), 16)).toEqual(["cc 16 0 1", "pc 16 0"]);
  expect(actionCommands(action("strymon-timeline", "memory-1"), 16)).toEqual(["cc 16 0 0", "pc 16 0"]);
});
it("limits RC-10R to its 99 memories and never sends a bank select", () => {
  expect(actionCommands(action("boss-rc10r", "memory-99"), 2)).toEqual(["pc 2 98"]);
  expect(action("boss-rc10r", "memory-100")).toBeUndefined();
});
it("enforces BOSS CC assignments instead of guessing controller numbers", () => {
  const stop = action("boss-rc10r", "loop-stop");
  expect(() => actionCommands(stop, 2)).toThrow("assigned CC");
  expect(() => actionCommands(stop, 2, 0, 32)).toThrow("assigned CC");
  expect(actionCommands(stop, 2, 0, 20)).toEqual(["cc 2 20 127", "cc 2 20 0"]);
  expect(actionCommands(action("boss-ir200", "gain"), 4, 100, 21)).toEqual(["cc 4 21 100"]);
});
it("encodes GP-180 tempo and respects its 0–100 volume range", () => {
  expect(actionCommands(action("valeton-gp180", "tempo"), 1, 300)).toEqual(["cc 1 73 2", "cc 1 74 44"]);
  expect(() => actionCommands(action("valeton-gp180", "patch-volume"), 1, 127)).toThrow("0 to 100");
  expect(actionCommands(action("valeton-gp180", "drum-pattern-129"), 1)).toEqual(["cc 1 94 1", "cc 1 95 0"]);
});
it("retains human labels without rendering them as lyrics and schedules message order unchanged", () => {
  const cues = parseChart("[00:12.50] {label:GP-180: Recall memory 129} {midi:cc 3 0 1} {midi:pc 3 0}");
  expect(cues[0].label).toBe("GP-180: Recall memory 129");
  expect(cues[0].text).toBe("");
  const sent: number[][] = [];
  scheduleCues(cues, 12, 13, 12.4, 0, (b) => sent.push(b));
  expect(sent).toEqual([
    [0xb2, 0, 1],
    [0xc2, 0],
  ]);
  expect(parseChart("[00:01] {label:Memory [01:00]} {midi:pc 1 0}")).toHaveLength(1);
});
it("accepts a custom profile and rejects invalid, oversized, duplicate or unresolved commands", () => {
  expect(parsePedalProfile(JSON.stringify(CUSTOM_PEDAL_TEMPLATE)).name).toBe("My MIDI pedal");
  for (const commands of [["cc $channel 128 0"], ["pc $channel 128"], ["cc $channel 20 $unknown"], ["cc $channel $cc 127"]]) {
    expect(() => parsePedalProfile(JSON.stringify({ ...CUSTOM_PEDAL_TEMPLATE, actions: [{ id: "bad", label: "Bad", commands }] }))).toThrow();
  }
  expect(() => parsePedalProfile(" ".repeat(500001))).toThrow("too large");
  expect(() =>
    parsePedalProfile(JSON.stringify({ ...CUSTOM_PEDAL_TEMPLATE, actions: [CUSTOM_PEDAL_TEMPLATE.actions[0], CUSTOM_PEDAL_TEMPLATE.actions[0]] })),
  ).toThrow("duplicate");
});

it("shares GP-150 and GP-180 performance commands while preserving model IDs", () => {
  const gp150 = PEDAL_PROFILES.find((p) => p.id === "valeton-gp150")!;
  const gp180 = PEDAL_PROFILES.find((p) => p.id === "valeton-gp180")!;
  expect(gp150.actions).toEqual(gp180.actions);
  expect(actionCommands(action("valeton-gp150", "memory-129"), 16)).toEqual(["cc 16 0 1", "pc 16 0"]);
  expect(actionCommands(action("valeton-gp150", "tempo"), 16, 141)).toEqual(["cc 16 73 1", "cc 16 74 13"]);
});

it("GP-180 profile adds the drum machine menu CC92 as a momentary action and keeps every earlier id", () => {
  const gp180 = PEDAL_PROFILES.find((p) => p.id === "valeton-gp180")!;
  const gp150 = PEDAL_PROFILES.find((p) => p.id === "valeton-gp150")!;
  const menu = gp180.actions.find((a) => a.id === "drum-menu")!;
  expect(menu.label).toBe("Drum machine menu control value");
  expect(menu.commands).toEqual(["cc $channel 92 $value"]);
  expect(menu.momentary).toBe(true);
  expect(gp150.actions.some((a) => a.id === "drum-menu")).toBe(true);
  expect(gp180.source).toContain("MIDI List for firmware V1.1.1");

  const earlierIds = [
    ...Array.from({ length: 200 }, (_, n) => `memory-${n + 1}`),
    ...Array.from({ length: 12 }, (_, i) => [`module-${i}-on`, `module-${i}-off`]).flat(),
    ...Array.from({ length: 129 }, (_, n) => `drum-pattern-${n + 1}`),
    ...["patch-mode", "stomp-mode", "previous", "next", "loop-play", "loop-stop", "loop-front", "loop-rear", "drums-play", "drums-stop", "tap", "tempo"],
    ...[0, 1, 2].flatMap((i) => [`quick-${i}-down`, `quick-${i}-up`]),
    ...["patch-volume", "expression", "exp-switch", "quick1", "quick2", "quick3", "record-level", "play-level", "drums-level", "tuner", "loop-menu"],
    ...["loop-record", "auto-record", "delete-loop", "ctrl-a", "ctrl-b", "ctrl-c", "analog", "dsp"],
  ];
  const ids = new Set(gp180.actions.map((a) => a.id));
  expect(earlierIds.filter((id) => !ids.has(id))).toEqual([]);
  expect(gp180.actions).toHaveLength(earlierIds.length + 1);
});
