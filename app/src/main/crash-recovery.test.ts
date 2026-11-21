import { describe, expect, it } from "vitest";
import { MAX_AUTO_RELOADS, RECOVERY_LOAD_TIMEOUT_MS, RELOAD_WINDOW_MS, decideRecoveryLoad, decideRenderGone, recoveredUrl } from "./crash-recovery";

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

describe("decideRecoveryLoad", () => {
  it("marks a recovery reload as pending when it starts", () => {
    expect(decideRecoveryLoad("start", false)).toEqual({ action: "none", pending: true });
  });

  it("prompts when a recovery reload fails to load", () => {
    expect(decideRecoveryLoad("failed", true)).toEqual({ action: "prompt", pending: false });
  });

  it("prompts when a recovery reload is still pending after the timeout", () => {
    expect(RECOVERY_LOAD_TIMEOUT_MS).toBe(10_000);
    expect(decideRecoveryLoad("timeout", true)).toEqual({ action: "prompt", pending: false });
  });

  it("clears the pending state on a successful load", () => {
    expect(decideRecoveryLoad("loaded", true)).toEqual({ action: "none", pending: false });
    // A later failure with nothing pending is not a recovery problem.
    expect(decideRecoveryLoad("failed", false)).toEqual({ action: "none", pending: false });
  });

  it("does not loop: after a prompt, failures alone never reload again", () => {
    let state = decideRecoveryLoad("start", false);
    state = decideRecoveryLoad("failed", state.pending);
    expect(state.action).toBe("prompt");
    // Without the user's Reload (which starts a new attempt) nothing is pending, so further failures only do nothing.
    state = decideRecoveryLoad("failed", state.pending);
    expect(state).toEqual({ action: "none", pending: false });
    state = decideRecoveryLoad("timeout", state.pending);
    expect(state).toEqual({ action: "none", pending: false });
  });

  it("leaves a clean exit alone, even during recovery", () => {
    expect(decideRenderGone("clean-exit", [], 1000).action).toBe("none");
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
