import { describe, expect, it } from "vitest";
import { FollowerGate, STOP_SECOND_PRESS_MS } from "./band-control";

describe("FollowerGate", () => {
  it("runs play and play or pause at once", () => {
    const gate = new FollowerGate(() => 0);
    expect(gate.take("transport.play")).toEqual({ kind: "run", action: "transport.play" });
    expect(gate.take("transport.playPause")).toEqual({ kind: "run", action: "transport.playPause" });
  });

  it("runs a stop only on its second press within the window", () => {
    let now = 1000;
    const gate = new FollowerGate(() => now);
    expect(gate.take("transport.stop").kind).toBe("armed");
    now += STOP_SECOND_PRESS_MS;
    expect(gate.take("transport.stop").kind).toBe("run");
  });

  it("does not run a stop whose second press comes too late, and waits again", () => {
    let now = 0;
    const gate = new FollowerGate(() => now);
    gate.take("transport.stop");
    now = STOP_SECOND_PRESS_MS + 1;
    expect(gate.take("transport.stop").kind).toBe("armed");
  });

  it("clears a waiting stop when another action runs", () => {
    let now = 0;
    const gate = new FollowerGate(() => now);
    gate.take("transport.stop");
    gate.take("transport.play");
    now = 100;
    expect(gate.take("transport.stop").kind).toBe("armed");
  });
});
