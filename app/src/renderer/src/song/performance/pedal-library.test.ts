import { describe, expect, it } from "vitest";
import { configuredPedals } from "./pedal-library";

const pedal = (pedals: ReturnType<typeof configuredPedals>, name: string) => pedals.find((p) => p.name === name)!;

describe("configuredPedals", () => {
  it("counts the RC-10R's trigger commands as unassigned until their CCs are set", () => {
    const rc10r = pedal(configuredPedals({ profiles: [], channels: {}, assignments: {} }), "BOSS RC-10R");
    expect(rc10r).toEqual({ name: "BOSS RC-10R", channel: 2, unassigned: 15, triggers: [] });
  });
  it("turns assigned trigger commands into (channel, CC) pairs on the channel the pedal is set to", () => {
    const pedals = configuredPedals({
      profiles: [],
      channels: { "boss-rc10r": 5 },
      assignments: { "boss-rc10r:loop-start": 70, "boss-rc10r:loop-stop": 71 },
    });
    const rc10r = pedal(pedals, "BOSS RC-10R");
    expect(rc10r.channel).toBe(5);
    expect(rc10r.unassigned).toBe(13);
    expect(rc10r.triggers).toEqual([
      [5, 70],
      [5, 71],
    ]);
  });
  it("uses the fixed CC numbers of trigger commands that do not need an assignment", () => {
    const timeline = pedal(configuredPedals({ profiles: [], channels: {}, assignments: {} }), "Strymon TimeLine");
    expect(timeline.unassigned).toBe(0);
    expect(timeline.triggers).toEqual(expect.arrayContaining([[1, 93]]));
  });
});
