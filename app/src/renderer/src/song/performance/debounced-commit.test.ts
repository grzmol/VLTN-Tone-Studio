import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debouncedCommit } from "./debounced-commit";

describe("debouncedCommit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("commits only the last value, 250 ms after the last change", () => {
    const commit = vi.fn();
    const field = debouncedCommit<number>(commit);
    field.change(1);
    vi.advanceTimersByTime(200);
    field.change(2);
    vi.advanceTimersByTime(200);
    field.change(3);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(commit.mock.calls).toEqual([[3]]);
  });

  it("commits at once on flush, and not again when the delay passes", () => {
    const commit = vi.fn();
    const field = debouncedCommit<number>(commit);
    field.change(4);
    field.flush();
    expect(commit.mock.calls).toEqual([[4]]);
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("flushes nothing when no change is waiting, and cancel drops a waiting one", () => {
    const commit = vi.fn();
    const field = debouncedCommit<number>(commit);
    field.flush();
    field.change(5);
    field.cancel();
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();
  });
});
