import { OutputRouter } from "./outputs";

// One AudioContext and output router for a run of songs. Songs that play one after another share it, so the next song can start on
// the same audio clock as the last one, and the same devices stay open. A player that is given no engine makes its own and closes it
// when it is disposed.

export interface PlaybackEngine {
  readonly ctx: AudioContext;
  readonly router: OutputRouter;
  /** Calls `listener` with each output warning. Returns the function that stops the listening. */
  onWarning(listener: (message: string) => void): () => void;
  close(): Promise<void>;
}

export function createPlaybackEngine(): PlaybackEngine {
  const ctx = new AudioContext({ sampleRate: 44100 });
  const listeners = new Set<(message: string) => void>();
  const router = new OutputRouter(ctx, (message) => listeners.forEach((listener) => listener(message)));
  return {
    ctx,
    router,
    onWarning(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async close() {
      router.dispose();
      await ctx.close();
    },
  };
}

let shared: PlaybackEngine | null = null;

/** The engine the performance session plays every song on. It lives until the app closes. */
export function sharedPlaybackEngine(): PlaybackEngine {
  shared ??= createPlaybackEngine();
  return shared;
}
