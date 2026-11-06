// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostError } from "./ipc";
import { idleAbort, raceAbort, transferError } from "./idle-abort";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("idleAbort", () => {
  it("aborts when no response arrives within connectMs", () => {
    const watch = idleAbort({ connectMs: 30_000, idleMs: 60_000 });
    vi.advanceTimersByTime(29_999);
    expect(watch.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watch.signal.aborted).toBe(true);
    expect(watch.cancelled()).toBe(false);
    expect((watch.signal.reason as Error).message).toMatch(/stalled/);
  });

  it("switches to idleMs once the response arrives", () => {
    const watch = idleAbort({ connectMs: 30_000, idleMs: 60_000 });
    vi.advanceTimersByTime(20_000);
    watch.touch();
    vi.advanceTimersByTime(59_999);
    expect(watch.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(watch.signal.aborted).toBe(true);
  });

  it("restarts the idle timer on every chunk, so a slow but steady transfer survives", () => {
    const watch = idleAbort({ connectMs: 30_000, idleMs: 60_000 });
    watch.touch();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50_000);
      watch.touch();
    }
    expect(watch.signal.aborted).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(watch.signal.aborted).toBe(true);
  });

  it("cancel() aborts at once with an AbortError and reports it as a cancel", () => {
    const watch = idleAbort({ connectMs: 30_000, idleMs: 60_000 });
    watch.cancel();
    expect(watch.signal.aborted).toBe(true);
    expect(watch.cancelled()).toBe(true);
    expect((watch.signal.reason as DOMException).name).toBe("AbortError");
  });

  it("finish() stops the timer so a finished transfer is never aborted later", () => {
    const watch = idleAbort({ connectMs: 30_000, idleMs: 60_000 });
    watch.touch();
    watch.finish();
    vi.advanceTimersByTime(10 * 60_000);
    expect(watch.signal.aborted).toBe(false);
  });

  it("ignores touch() and cancel() after the abort", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    watch.touch();
    watch.cancel();
    expect(watch.cancelled()).toBe(false);
  });
});

describe("raceAbort", () => {
  it("rejects with the abort reason while the promise never settles", async () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    const stuck = new Promise<never>(() => {});
    const read = raceAbort(stuck, watch.signal);
    vi.advanceTimersByTime(1_000);
    await expect(read).rejects.toThrow(/stalled/);
  });

  it("resolves with the promise when nothing aborts", async () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    await expect(raceAbort(Promise.resolve(7), watch.signal)).resolves.toBe(7);
    watch.finish();
  });

  it("passes the promise's own rejection through", async () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    await expect(raceAbort(Promise.reject(new Error("socket reset")), watch.signal)).rejects.toThrow("socket reset");
    watch.finish();
  });
});

describe("transferError", () => {
  it("keeps a HostError from the caller with its own message", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    const e = new HostError("not-found", "This tone isn't on TONE3000 anymore");
    expect(transferError(e, watch, "generic")).toBe(e);
    watch.finish();
  });

  it("keeps a 429 or sign-in message from the caller unchanged", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    expect(transferError(new HostError("network", "Slow down a little"), watch, "generic").message).toBe("Slow down a little");
    watch.finish();
  });

  it("turns a stall into the generic message", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    vi.advanceTimersByTime(1_000);
    const e = transferError(watch.signal.reason, watch, "generic");
    expect(e).toMatchObject({ code: "network", message: "generic" });
  });

  it("turns a socket error into the generic message", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    expect(transferError(new TypeError("fetch failed"), watch, "generic")).toMatchObject({ code: "network", message: "generic" });
    watch.finish();
  });

  it("reports a cancel as cancelled, whatever the error", () => {
    const watch = idleAbort({ connectMs: 1_000, idleMs: 1_000 });
    watch.cancel();
    expect(transferError(new Error("x"), watch, "generic")).toMatchObject({ code: "cancelled" });
  });
});
