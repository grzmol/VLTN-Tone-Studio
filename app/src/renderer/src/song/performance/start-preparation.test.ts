import { expect, it } from "vitest";
import { parseChart } from "./chart";
import { preparationSettings, startPreparation, preparationLine, movePreparationLine, moveCueToPreparation } from "./start-preparation";
const enabled = { enabled: true, settleMs: 1000, openingPresets: true };
it("moves opening presets and banks early but keeps notes and drum/looper starts on the musical timeline", () => {
  const cues = parseChart(
    "[00:00] {midi:cc 16 0 0} {midi:pc 16 6} {midi:note 10 36 100} {midi:cc 2 80 127}\n{midi@prepare:cc 3 20 127}\n[00:10] {midi:pc 16 8}",
  );
  expect(startPreparation(cues, 0, enabled)).toEqual({
    opening: [
      [0xbf, 0, 0],
      [0xcf, 6],
    ],
    commands: [{ bytes: [0xb2, 20, 127] }],
    suppressed: [
      [0xbf, 0, 0],
      [0xcf, 6],
    ],
  });
  expect(startPreparation(cues, 0, { ...enabled, openingPresets: false }).opening).toEqual([]);
  expect(() => startPreparation(cues, 0, { ...enabled, enabled: false })).toThrow("Enable Before song");
});
it("reapplies user load presets before the opening state without replaying load triggers or managed memory", () => {
  const cues = parseChart("{midi@load:pc 1 4}\n{midi@load:cc 2 80 127}\n{midi@load:pc 2 1}\n[00:00] {midi:pc 1 5}");
  cues[2].managed = "rhythm";
  expect(startPreparation(cues, 0, enabled).opening).toEqual([
    [0xc0, 4],
    [0xc0, 5],
  ]);
});
it("uses the current preset state for a trimmed or resumed start and preserves explicit macro order", () => {
  const cues = parseChart("[00:00] {midi:pc 16 4}\n[00:05] {midi:pc 16 6}\n{midi@prepare:$READY}", [
    { code: "READY", label: "Ready", commands: ["cc 4 12 0", "pc 4 9"] },
  ]);
  const plan = startPreparation(cues, 10, enabled);
  expect(plan.opening).toEqual([[0xcf, 6]]);
  expect(plan.commands).toEqual([{ bytes: [0xb3, 12, 0] }, { bytes: [0xc3, 9] }]);
});
it("keeps labelled multi-message pedal actions together when moving preparation lines", () => {
  const first = "{label:GP patch} {midi@prepare:cc 16 0 0} {midi@prepare:pc 16 6}";
  const second = "{label:Delay} {midi@prepare:pc 1 2}";
  const chart = first + "\n[00:10] Keep these lyrics\n" + second;
  const moved = movePreparationLine(
    chart,
    parseChart(chart).find((cue) => cue.label === "Delay")!,
    -1,
  );
  expect(moved).toBe(second + "\n[00:10] Keep these lyrics\n" + first);
  expect(movePreparationLine(chart, parseChart(chart)[0], -1)).toBeNull();
});
it("converts picker lines and moves an existing timed cue without deleting accompanying lyrics", () => {
  expect(preparationLine("[00:00] {label:Patch} {midi:cc 16 0 0} {midi:pc 16 6}")).toBe("{label:Patch} {midi@prepare:cc 16 0 0} {midi@prepare:pc 16 6}");
  const chart = "[00:00] [C] Sing this {label:Lead} {midi:pc 1 5}";
  expect(moveCueToPreparation(chart, parseChart(chart)[0])).toBe("[00:00] [C] Sing this {label:Lead}\n{label:Lead} {midi@prepare:pc 1 5}");
});
it("clamps preparation waits and keeps defaults independent from song overrides", () => {
  expect(preparationSettings({ settleMs: 20000 })).toMatchObject({ enabled: true, settleMs: 10000 });
  expect(preparationSettings(null)).toEqual(enabled);
});
