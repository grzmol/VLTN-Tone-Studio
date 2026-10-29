// Watchdog for downloads. A total timeout would cut off a healthy 280 MB model on a slow link, so this aborts only
// when the transfer stalls: no response within `connectMs`, then no bytes for `idleMs`. Every chunk calls `touch()`.
// The abort reason is an Error for a stall and a DOMException for a cancel, so callers can tell them apart.
// Shared by the main process (models, TONE3000 files) and the browser build (models, Cache Storage).

/** Downloads: 30 s for the response, then 60 s without a chunk. A healthy transfer never comes near either. */
export const DOWNLOAD_TIMEOUTS: IdleAbortOptions = { connectMs: 30_000, idleMs: 60_000 };

export interface IdleAbortOptions {
  /** Longest wait for the response headers */
  connectMs: number;
  /** Longest gap between two chunks of body, once the response has started */
  idleMs: number;
}

export interface IdleAbort {
  signal: AbortSignal;
  /** Call when the response arrives and on every chunk of body: restarts the idle timer. */
  touch(): void;
  /** Abort now because the user asked to (the reason is an AbortError, see `cancelled()`). */
  cancel(): void;
  /** Stop the timer once the transfer is over, whether it succeeded or failed. */
  finish(): void;
  /** True when `cancel()` aborted the transfer, false for a stall. */
  cancelled(): boolean;
}

export function idleAbort({ connectMs, idleMs }: IdleAbortOptions): IdleAbort {
  const controller = new AbortController();
  let limit = connectMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wasCancelled = false;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(`The download stalled: no data for ${Math.round(limit / 1000)} s`)), limit);
  };
  arm();

  return {
    signal: controller.signal,
    touch() {
      if (controller.signal.aborted) return;
      limit = idleMs;
      arm();
    },
    cancel() {
      if (controller.signal.aborted) return;
      wasCancelled = true;
      clearTimeout(timer);
      controller.abort(new DOMException("The download was cancelled", "AbortError"));
    },
    finish() {
      clearTimeout(timer);
    },
    cancelled: () => wasCancelled,
  };
}

/**
 * Reject as soon as `signal` aborts, even when `promise` (a body read, say) never settles on its own. The original
 * promise's own rejection is still handled, so nothing is left unhandled.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
