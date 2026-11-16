import { alignedClock, MidiSchedule, type SchedulerReply, type SchedulerRequest } from "./midi-scheduler";
let schedule: MidiSchedule | null = null,
  timer: ReturnType<typeof setInterval> | undefined;
// Playback uses a measured monotonic clock pair; start-message delivery time must not become a permanent clock lag.
let now = () => performance.timeOrigin + performance.now();
self.onmessage = (event: MessageEvent<SchedulerRequest>) => {
  const request = event.data;
  if (request.type === "clock") {
    self.postMessage({ type: "clock", at: request.at, workerNow: performance.now() } satisfies SchedulerReply);
    return;
  }
  if (request.type === "stop" || request.type === "start") {
    if (timer !== undefined) clearInterval(timer);
    schedule?.stop();
    schedule = null;
  }
  if (request.type === "start") {
    now = alignedClock(request.clock.rendererAt, () => performance.now(), request.clock.workerAt);
    schedule = new MidiSchedule(request.config, now(), (reply) => self.postMessage(reply));
    self.postMessage({ type: "started" });
    schedule.tick(now());
    timer = setInterval(() => schedule?.tick(now()), 20);
  } else if (request.type === "sync") {
    schedule?.sync(request.position, request.at, now());
    self.postMessage({ type: "heartbeat" });
  } else if (request.type === "plan") {
    schedule?.plan(request.cap, request.jump, now());
  } else if (request.type === "clicks") {
    schedule?.addTimed(request.messages);
  } else if (request.type === "timecode-end") {
    schedule?.endTimecode(request.at);
  }
};
self.postMessage({ type: "ready" });
