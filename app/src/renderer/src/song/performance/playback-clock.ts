import { create } from "zustand";
import { lrcTime } from "@/song/performance/chart";

/**
 * The song position for display. The audio engine owns the real clock; this store only mirrors it so that the few components which show
 * time can subscribe to exactly what they render. Selectors that return a derived value (a line index, a formatted second) keep a
 * component from re-rendering on every frame.
 */
/**
 * `position` is never negative, so every display of time shows zero during a count-in. `leadIn` is the seconds left before the audio
 * starts, for the count-in display only.
 */
export const usePlaybackClock = create<{ position: number; playing: boolean; leadIn: number }>(() => ({ position: 0, playing: false, leadIn: 0 }));

/** Sets the displayed position without starting the frame loop (seek, rewind, song change). */
export function setClockPosition(position: number) {
  usePlaybackClock.setState({ position: Math.max(0, position) });
}

export function clockPosition(): number {
  return usePlaybackClock.getState().position;
}

/** Mirrors `read()` into the store once per animation frame until the returned function is called. */
export function startPlaybackClock(read: () => number): () => void {
  let frame = 0;
  const tick = () => {
    const raw = read();
    const position = Math.max(0, raw);
    const leadIn = raw < 0 ? -raw : 0;
    const state = usePlaybackClock.getState();
    if (position !== state.position || leadIn !== state.leadIn) usePlaybackClock.setState({ position, leadIn });
    frame = requestAnimationFrame(tick);
  };
  usePlaybackClock.setState({ playing: true });
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    usePlaybackClock.setState({ playing: false, leadIn: 0 });
  };
}

/** Index of the last item that has started, or -1. Re-renders the caller only when the index changes. */
export function useActiveIndex(times: readonly number[]): number {
  return usePlaybackClock((s) => times.findLastIndex((t) => t <= s.position));
}

/** `[mm:ss.xx]` text for the current position. */
export function useClockText(): string {
  return usePlaybackClock((s) => lrcTime(s.position));
}

/** Position rounded to a tenth of a second, matching the transport slider step. */
export function useClockTenths(): number {
  return usePlaybackClock((s) => Math.round(s.position * 10) / 10);
}

/** Count-in beats left, counting down to the audio: 0 once the audio has started, or while stopped. */
export function useCountInBeats(bpm: number): number {
  return usePlaybackClock((s) => (s.leadIn > 0 && bpm > 0 ? Math.ceil((s.leadIn * bpm) / 60 - 1e-6) : 0));
}
