import {
  lateAction,
  STALE_MS,
  type TimedMessage,
  type ScheduledMessage,
  type SchedulerConfig,
  type SchedulerJump,
  type SchedulerReply,
  type SchedulerRequest,
  type TimecodeStream,
} from "./midi-scheduler";
const failedWorkers = new WeakMap<Worker, Error>();
/** The session keeps running through late messages; this reports them so the UI can show a non-blocking notice. */
export interface SchedulerDegraded {
  /** Song position in seconds. */
  position: number;
  dropped: ScheduledMessage[];
  resynced: boolean;
}
/** The worker only answers our checkpoints, so a long silence means it is gone. Shorter stalls come from a busy renderer and recover on their own. */
const WORKER_SILENCE_MS = 3000;
export const midiNow = () => performance.timeOrigin + performance.now();
/** Warm an idle worker before starting audio, with a bounded startup wait. */
export function prepareMidiScheduler() {
  const worker = new Worker(new URL("./midi-scheduler-worker.ts", import.meta.url), { type: "module" });
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    const timer = setTimeout(() => {
      const error = new Error("MIDI scheduler did not become ready. Reconnect or rearm before playing.");
      failedWorkers.set(worker, error);
      worker.terminate();
      reject(error);
    }, 2000);
    worker.onmessage = (event: MessageEvent<SchedulerReply>) => {
      if (event.data.type === "ready") {
        clearTimeout(timer);
        resolve();
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      const error = new Error("MIDI scheduling worker failed before playback. Rearm before playing.");
      failedWorkers.set(worker, error);
      worker.terminate();
      reject(error);
    };
    rejectReady = (error) => {
      clearTimeout(timer);
      reject(error);
    };
  });
  void ready.catch(() => {});
  return {
    worker,
    get ready() {
      const error = failedWorkers.get(worker);
      return error ? Promise.reject(error) : ready;
    },
    cancel() {
      const error = new Error("MIDI scheduler preparation cancelled.");
      failedWorkers.set(worker, error);
      worker.terminate();
      rejectReady(error);
    },
  };
}
/** The worker owns cue selection/timers. Window-only MIDI/Bluetooth APIs stay here. */
export function startMidiScheduler(
  config: SchedulerConfig,
  onSend: (message: ScheduledMessage) => void,
  onFault: (error: string) => void,
  prepared?: Worker,
  onDegraded?: (event: SchedulerDegraded) => void,
) {
  const worker = prepared ?? new Worker(new URL("./midi-scheduler-worker.ts", import.meta.url), { type: "module" });
  const failed = failedWorkers.get(worker);
  if (failed) throw failed;
  // Keep the playback request time while clock probes establish a separate monotonic alignment.
  const requestedAt = midiNow();
  let active = true,
    started = false,
    lastResponse = requestedAt;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let clockTimer: ReturnType<typeof setTimeout> | undefined;
  let clockProbe = NaN;
  let clockSamples = 0;
  let bestClock: { rendererAt: number; workerAt: number; roundTrip: number } | null = null;
  let sentStart = false;
  const pending: SchedulerRequest[] = [];
  // The quarter-frame stream as the worker last reported it, so a hand-over can carry it on after this schedule stops.
  let latestTimecode: TimecodeStream | null = null;
  const stop = () => {
    active = false;
    clearInterval(watchdog);
    clearTimeout(clockTimer);
    pending.length = 0;
    worker.terminate();
  };
  const fault = (message: string) => {
    if (!active) return;
    stop();
    onFault(message);
  };
  worker.onerror = () => fault("MIDI scheduling worker failed. Cues disarmed; check the pedal state before rearming.");
  const probeClock = () => {
    clockProbe = midiNow();
    worker.postMessage({ type: "clock", at: clockProbe } satisfies SchedulerRequest);
  };
  const post = (request: SchedulerRequest) => {
    if (!active) return;
    if (!sentStart) {
      pending.push(request);
      return;
    }
    try {
      worker.postMessage(request);
    } catch (error) {
      fault(String(error));
    }
  };
  worker.onmessage = (event: MessageEvent<SchedulerReply>) => {
    if (!active) return;
    const reply = event.data;
    if (reply.type === "ready") return;
    lastResponse = midiNow();
    if (reply.type === "clock") {
      if (sentStart || reply.at !== clockProbe) return;
      const roundTrip = lastResponse - reply.at;
      if (!Number.isFinite(reply.workerNow) || !Number.isFinite(roundTrip) || roundTrip < 0) {
        fault("MIDI worker clock calibration failed. Cues disarmed.");
        return;
      }
      const sample = { rendererAt: (reply.at + lastResponse) / 2, workerAt: reply.workerNow, roundTrip };
      if (!bestClock || roundTrip < bestClock.roundTrip) bestClock = sample;
      try {
        // The midpoint bounds the offset by half a round trip. Repeating avoids anchoring to module/startup congestion.
        if (++clockSamples < 3) {
          probeClock();
          return;
        }
        clearTimeout(clockTimer);
        sentStart = true;
        worker.postMessage({
          type: "start",
          at: requestedAt,
          clock: { rendererAt: bestClock.rendererAt, workerAt: bestClock.workerAt },
          config: { ...config, cues: config.cues.filter((c) => c.messages.length && !c.trigger).map((c) => ({ ...c, text: "" })) },
        } satisfies SchedulerRequest);
        for (const request of pending.splice(0)) worker.postMessage(request);
      } catch (error) {
        fault(String(error));
      }
      return;
    }
    if (reply.type === "started") {
      started = true;
      return;
    }
    if (reply.type === "heartbeat") return;
    if (reply.type === "fault") {
      fault(reply.error);
      return;
    }
    if (reply.type === "resync") {
      onDegraded?.({ position: reply.position, dropped: [], resynced: true });
      return;
    }
    if (reply.type !== "batch") return;
    if (reply.timecode !== undefined) latestTimecode = reply.timecode;
    // The bridge can delay a batch. Judge each message on its own: a late one is dropped (note-offs are still sent), the rest go out.
    const dropped = [...(reply.dropped ?? [])];
    try {
      for (const message of reply.messages) {
        if (!active) return;
        if (midiNow() - message.due > STALE_MS) {
          const action = lateAction(message.bytes);
          if (action === "drop") dropped.push(message);
          if (action !== "send") continue;
        }
        onSend(message);
      }
    } catch (error) {
      fault(error instanceof Error ? error.message : String(error));
      return;
    }
    if (dropped.length) onDegraded?.({ position: Math.min(...dropped.map((m) => m.time ?? (m.due - config.origin) / 1000)), dropped, resynced: false });
  };
  watchdog = setInterval(() => {
    if (midiNow() - (started ? lastResponse : requestedAt) > WORKER_SILENCE_MS)
      fault(started ? "MIDI scheduler stopped responding. Cues disarmed." : "MIDI scheduler did not acknowledge playback. Cues disarmed.");
  }, 50);
  try {
    clockTimer = setTimeout(() => fault("MIDI worker clock did not respond. Cues disarmed."), 2000);
    probeClock();
  } catch (error) {
    stop();
    throw error;
  }
  return {
    stop,
    sync(position: number) {
      post({ type: "sync", position, at: midiNow() });
    },
    /** Holds cues after song time `cap` and moves the schedule at a planned jump. See `MidiSchedule.plan`. */
    plan(cap: number | null, jump: SchedulerJump | null) {
      post({ type: "plan", cap, jump });
    },
    /** Adds messages due at fixed clock times (the MIDI click). They are sent by the worker's clock, like cues. */
    addTimed(messages: TimedMessage[]) {
      post({ type: "clicks", messages });
    },
    /** The quarter-frame stream last reported by the worker, or null when it sends no timecode. Still readable after `stop()`. */
    timecodeStream(): TimecodeStream | null {
      return latestTimecode;
    },
    /** Stops timecode at clock time `at` (the clock `midiNow` reads), or lifts the stop with null. Used by a hand-over. */
    endTimecode(at: number | null) {
      post({ type: "timecode-end", at });
    },
  };
}
