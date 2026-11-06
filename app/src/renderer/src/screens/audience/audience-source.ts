// Where the audience window gets its state (spec 43): the sandboxed preload in the desktop app, or a BroadcastChannel from the
// performance tab in the browser build. Either way the page only reads; it asks for the state once, on subscribing.
import { AUDIENCE_CHANNEL, mergeAudienceState, parseAudienceUpdate, type AudienceState } from "@shared/audience";

declare global {
  interface Window {
    audienceFeed?: { subscribe(callback: (state: AudienceState) => void): () => void };
  }
}

/** Calls `callback` with the state now and after every update. Returns the unsubscribe. */
export function subscribeAudience(callback: (state: AudienceState) => void): () => void {
  if (window.audienceFeed) return window.audienceFeed.subscribe(callback);
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(AUDIENCE_CHANNEL);
  let state: AudienceState = { model: null, clock: null };
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { kind?: unknown; update?: unknown } | null;
    if (data?.kind !== "update") return;
    try {
      state = mergeAudienceState(state, parseAudienceUpdate(data.update));
    } catch {
      return;
    }
    callback(state);
  };
  // The pop-up may open after the performance tab has sent its state: the tab answers with the latest.
  channel.postMessage({ kind: "hello" });
  return () => channel.close();
}
