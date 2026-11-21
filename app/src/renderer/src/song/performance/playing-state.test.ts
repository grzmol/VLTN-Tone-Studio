import { afterEach, describe, expect, it, vi } from "vitest";
import { isSongPlaying, onSongPlayingChange, setSongPlaying } from "./playing-state";

afterEach(() => setSongPlaying(false));

describe("playing state", () => {
  it("tells listeners when playback starts and stops, and not when it stays the same", () => {
    const listener = vi.fn();
    const stop = onSongPlayingChange(listener);
    setSongPlaying(true);
    setSongPlaying(true);
    setSongPlaying(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    expect(isSongPlaying()).toBe(false);
    stop();
  });

  it("stops telling a listener that stopped listening", () => {
    const listener = vi.fn();
    onSongPlayingChange(listener)();
    setSongPlaying(true);
    expect(listener).not.toHaveBeenCalled();
    expect(isSongPlaying()).toBe(true);
  });
});
