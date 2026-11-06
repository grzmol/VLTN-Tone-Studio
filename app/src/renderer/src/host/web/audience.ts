import { AUDIENCE_CHANNEL, mergeAudienceState, parseAudienceUpdate, type AudienceState, type AudienceUpdate } from "@shared/audience";
import type { AudienceHostApi, AudienceStatus } from "@shared/host/audience";

// Browser build (spec 43): the audience view is a pop-up window of this page. A browser cannot choose a display or go full screen by
// itself, so the performer moves the pop-up to the audience screen and makes it full screen (F11). The pop-up gets the state over a
// BroadcastChannel. It asks for the latest state when it opens, so the first picture is not blank.

const POPUP = "vltn-audience";
const POPUP_SIZE = "popup,width=1280,height=720";
const POLL_MS = 1000;

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(AUDIENCE_CHANNEL);
let state: AudienceState = { model: null, clock: null };
let popup: Window | null = null;
let poll: ReturnType<typeof setInterval> | undefined;
let note = "";
const listeners = new Set<(status: AudienceStatus) => void>();

channel?.addEventListener("message", (event: MessageEvent) => {
  if ((event.data as { kind?: unknown } | null)?.kind === "hello" && (state.model || state.clock)) post();
});

function post(): void {
  channel?.postMessage({ kind: "update", update: state });
}

function status(): AudienceStatus {
  const open = !!popup && !popup.closed;
  return {
    windowing: "popup",
    open,
    mode: open ? "window" : null,
    displayId: null,
    displays: [],
    message: note || (open ? "Open in a pop-up window. Move it to the audience screen and press F11 to fill the screen." : "Audience display is off."),
  };
}

function emit(): AudienceStatus {
  const current = status();
  for (const listener of listeners) listener(current);
  return current;
}

/** The pop-up was closed by the performer: stop watching it and say so. */
function watch(): void {
  if (poll !== undefined) return;
  poll = setInterval(() => {
    if (popup && !popup.closed) return;
    popup = null;
    clearInterval(poll);
    poll = undefined;
    note = "";
    emit();
  }, POLL_MS);
}

export const webAudience: AudienceHostApi = {
  status: async () => status(),
  onStatus: (callback) => {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  open: async () => {
    if (popup && !popup.closed) {
      popup.focus();
      return emit();
    }
    const url = new URL(window.location.href);
    url.search = "?view=audience";
    const opened = window.open(url.toString(), POPUP, POPUP_SIZE);
    note = opened ? "" : "The browser blocked the pop-up. Allow pop-ups for this site and try again.";
    popup = opened;
    if (opened) watch();
    post();
    return emit();
  },
  close: async () => {
    popup?.close();
    popup = null;
    note = "";
    if (poll !== undefined) clearInterval(poll);
    poll = undefined;
    return emit();
  },
  // The browser build has no displays to choose from: the pop-up is placed by the performer.
  chooseDisplay: async () => status(),
  publish: async (update: AudienceUpdate) => {
    state = mergeAudienceState(state, parseAudienceUpdate(update));
    post();
  },
};
