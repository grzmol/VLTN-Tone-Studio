// What the main process does when the window's renderer dies or stops answering (spec 120). The decisions are pure so they can be tested;
// index.ts only wires them to Electron. Audio, MIDI cues and the playlist all live in the renderer, so a crash silences the show: the
// window comes back on its own, and the renderer offers to resume (it never starts the music by itself).

/** How many automatic reloads the window gets inside `RELOAD_WINDOW_MS` before the user is asked. */
export const MAX_AUTO_RELOADS = 3;
export const RELOAD_WINDOW_MS = 60_000;
/** A long analysis can block the page for a moment, so "not responding" is only reported after this long. */
export const UNRESPONSIVE_GRACE_MS = 5_000;

export type CrashAction = "none" | "reload" | "prompt";

/**
 * What to do about a renderer that is gone. `history` holds the times of the automatic reloads so far; the returned `history` is the
 * one to keep. A clean exit does nothing. Once the limit is used up inside the window the user is asked instead of looping on a page that
 * crashes at load.
 */
export function decideRenderGone(reason: string, history: readonly number[], now: number): { action: CrashAction; history: number[] } {
  if (reason === "clean-exit") return { action: "none", history: [...history] };
  const recent = history.filter((t) => now - t < RELOAD_WINDOW_MS);
  if (recent.length >= MAX_AUTO_RELOADS) return { action: "prompt", history: recent };
  return { action: "reload", history: [...recent, now] };
}

/** The page's own address with `recovered=1`, so the renderer knows this start follows a crash. Any other query is kept. */
export function recoveredUrl(current: string, fallback: string): string {
  try {
    const url = new URL(current || fallback);
    url.searchParams.set("recovered", "1");
    return url.toString();
  } catch {
    return fallback;
  }
}
