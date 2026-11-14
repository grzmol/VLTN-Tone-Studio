import { expect, it } from "vitest";
import { rhythmTempo } from "./rhythm-tempo";
it("shares native rounding and compound pulse conversion with export and clock", () => {
  expect(rhythmTempo(90, true)).toEqual({ quarterBpm: 135, pulseBpm: 90, clockBpm: 135 });
  expect(rhythmTempo(149.9)).toEqual({ quarterBpm: 150, pulseBpm: 150, clockBpm: 150 });
  expect(rhythmTempo(90, true, 0.8).clockBpm).toBe(108);
});
