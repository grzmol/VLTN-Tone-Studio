import { describe, expect, it } from "vitest";
import { MAX_AUTO_RELOADS, RELOAD_WINDOW_MS, decideRenderGone, recoveredUrl } from "./crash-recovery";

describe("decideRenderGone", () => {
  it("reloads on the first crash and records it", () => {
    expect(decideRenderGone("crashed", [], 1000)).toEqual({ action: "reload", history: [1000] });
  });

  it("does nothing for a clean exit", () => {
    expect(decideRenderGone("clean-exit", [], 1000)).toEqual({ action: "none", history: [] });
  });

  it("reloads three times, then asks on the fourth crash inside a minute", () => {
    let history: number[] = [];
    for (let i = 0; i < MAX_AUTO_RELOADS; i++) {
      const next = decideRenderGone("oom", history, 1000 + i * 5000);
      expect(next.action).toBe("reload");
      history = next.history;
    }
    expect(decideRenderGone("oom", history, 20_000).action).toBe("prompt");
  });

  it("forgets reloads older than the window", () => {
    const history = [0, 1000, 2000];
    expect(decideRenderGone("crashed", history, RELOAD_WINDOW_MS + 2500)).toEqual({ action: "reload", history: [RELOAD_WINDOW_MS + 2500] });
  });
});

describe("recoveredUrl", () => {
  it("adds the flag and keeps the rest of the address", () => {
    expect(recoveredUrl("app://bundle/index.html", "x")).toBe("app://bundle/index.html?recovered=1");
    expect(recoveredUrl("http://localhost:5173/?mock=gp5", "x")).toBe("http://localhost:5173/?mock=gp5&recovered=1");
  });

  it("falls back when the address is empty or broken", () => {
    expect(recoveredUrl("", "app://bundle/index.html")).toBe("app://bundle/index.html?recovered=1");
  });
});
