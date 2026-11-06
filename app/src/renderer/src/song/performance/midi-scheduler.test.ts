import { describe, expect, it } from "vitest";
import { alignedClock, BLUETOOTH_LOOKAHEAD, MidiSchedule, SYSTEM_LOOKAHEAD, type SchedulerConfig, type SchedulerReply } from "./midi-scheduler";
import { parseChart } from "./chart";
const config = (patch: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  cues: parseChart("[00:00] {midi:pc 1 1}\n[00:01] {midi:cc 2 12 127}"),
  position: 0,
  duration: 2,
  origin: 1000,
  bpm: 120,
  clock: false,
  tempo: null,
  ...patch,
});
function fixture(patch: Partial<SchedulerConfig> = {}) {
  const replies: SchedulerReply[] = [];
  const schedule = new MidiSchedule(config(patch), 1000, (r) => replies.push(r));
  return { schedule, replies, messages: () => replies.flatMap((r) => (r.type === "batch" ? r.messages : [])) };
}
it("queues each cue once on the fixed grid, preserves message order and applies start tempo after patch recall", () => {
  const f = fixture({
    tempo: [
      [191, 73, 0],
      [191, 74, 120],
    ],
  });
  f.schedule.tick(1000);
  f.schedule.sync(0.98, 1980, 1980);
  f.schedule.tick(1980); // a long poll resyncs instead of faulting
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [192, 1],
    [191, 73, 0],
    [191, 74, 120],
    [177, 12, 127],
  ]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(f.replies.some((r) => r.type === "resync")).toBe(true);
});
it("fills on-time cues without duplication and never emits after stop", () => {
  const f = fixture();
  for (let t = 1000; t <= 2020; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  expect(f.messages().map((m) => [m.bytes, m.due])).toEqual([
    [[192, 1], 1000],
    [[177, 12, 127], 2000],
  ]);
  f.schedule.stop();
  f.schedule.tick(2040);
  expect(f.messages()).toHaveLength(2);
});
it("does not replay cues before a seek as cues, only as chased state, and ignores cues beyond the song end", () => {
  const f = fixture({ position: 0.5, origin: 500, duration: 0.9 });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => [m.bytes, m.label])).toEqual([[[192, 1], "Chase state"]]);
});
it.each([90, 120, 180])("keeps 24 PPQN at %i BPM despite checkpoint jitter", (bpm) => {
  const f = fixture({ bpm, clock: true, cues: [], duration: 10 });
  for (let t = 1000; t < 11000; t += 20) {
    f.schedule.sync((t - 1000) / 1000 + 0.002, t, t);
    f.schedule.tick(t);
  }
  const pulses = f.messages().filter((m) => m.bytes[0] === 248);
  expect(pulses).toHaveLength((bpm / 60) * 24 * 10);
  pulses.forEach((p, i) => expect(p.due).toBeCloseTo(1000 + (i * 60000) / bpm / 24, 6));
});
it("faults once when the audio clock stops advancing and never produces catch-up commands", () => {
  const f = fixture({ cues: parseChart("[00:03] {midi:pc 1 2}"), duration: 10 });
  // The audio plays to song 0.5 at clock 1500, then freezes.
  const audio = (t: number) => (t < 1500 ? (t - 1000) / 1000 : 0.5);
  for (let t = 1000; t <= 2600; t += 20) {
    f.schedule.sync(audio(t), t, t);
    f.schedule.tick(t);
  }
  f.schedule.tick(3000);
  expect(f.replies.filter((r) => r.type === "fault")).toHaveLength(1);
  expect(f.replies.at(-1)?.type).toBe("fault");
  expect(f.messages()).toEqual([]);
});
it("resyncs when checkpoints disappear and only faults after three resyncs within five seconds", () => {
  const f = fixture({ cues: [] });
  for (let t = 1000; t < 1500; t += 20) f.schedule.tick(t);
  expect(f.replies.filter((r) => r.type === "resync")).toHaveLength(1);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  for (let t = 1500; t <= 2000; t += 20) f.schedule.tick(t);
  expect(f.replies.filter((r) => r.type === "fault")).toHaveLength(1);
});
it("keeps the session running through a frozen renderer: stale patch changes are dropped and counted, later ones still fire", () => {
  const f = fixture({ cues: parseChart("[00:00.30] {midi:pc 1 2}\n[00:00.35] {midi:pc 1 3}\n[00:01.00] {midi:pc 1 4}"), duration: 5 });
  f.schedule.tick(1000);
  f.schedule.sync(0, 1000, 1000);
  // Nothing runs for 700 ms, then everything resumes.
  f.schedule.sync(0.7, 1700, 1700);
  for (let t = 1700; t <= 2000; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  const dropped = f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : []));
  expect(dropped.map((m) => m.bytes)).toEqual([
    [192, 2],
    [192, 3],
  ]);
  // The dropped changes are replayed as one chase (only the latest patch), then the later cue fires.
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [192, 3],
    [192, 4],
  ]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(f.replies.some((r) => r.type === "resync")).toBe(true);
});
it("sends a late note-off, drops a late note-on and silently drops late clock pulses", () => {
  const f = fixture({ cues: parseChart("[00:00.10] {midi:note 1 60 100}\n[00:00.10] {midi:off 1 60 0}"), clock: true, duration: 5 });
  f.schedule.sync(0.7, 1700, 1700);
  f.schedule.tick(1700);
  const dropped = f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : []));
  expect(dropped.map((m) => m.bytes)).toEqual([[144, 60, 100]]);
  expect(f.messages().map((m) => m.bytes)).toContainEqual([128, 60, 0]);
  expect(
    f
      .messages()
      .filter((m) => m.bytes[0] === 248)
      .every((m) => 1700 - m.due <= 250),
  ).toBe(true);
  expect(dropped.some((m) => m.bytes[0] === 248)).toBe(false);
});
it("emits system MIDI cues 0.2 s ahead with exact due times, and only 120 ms ahead for Bluetooth", () => {
  const cues = parseChart("[00:00.05] {midi:pc 1 1}\n[00:00.15] {midi:pc 1 2}\n[00:00.40] {midi:pc 1 3}");
  const usb = fixture({ cues, duration: 5, lookahead: SYSTEM_LOOKAHEAD });
  usb.schedule.tick(1000);
  expect(usb.messages().map((m) => [m.bytes, m.due])).toEqual([
    [[192, 1], 1050],
    [[192, 2], 1150],
  ]);
  const ble = fixture({ cues, duration: 5, lookahead: BLUETOOTH_LOOKAHEAD });
  ble.schedule.tick(1000);
  expect(ble.messages().map((m) => m.bytes)).toEqual([[192, 1]]);
});

it("a pause emits nothing after it, even for a USB cue that is inside the 0.2 s window", () => {
  const cues = parseChart("[00:00.10] {midi:pc 1 1}\n[00:00.30] {midi:pc 1 2}");
  const f = fixture({ cues, duration: 5, lookahead: SYSTEM_LOOKAHEAD });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([[192, 1]]);
  // The 0.30 s cue is due at 1300 and inside the window from 1150 on, but the pause has already stopped the schedule.
  f.schedule.stop();
  f.schedule.tick(1150);
  f.schedule.tick(1300);
  expect(f.messages()).toHaveLength(1);
});
it("does not apply the start tempo late: it is dropped and the session carries on", () => {
  const replies: SchedulerReply[] = [];
  const schedule = new MidiSchedule(config({ cues: [], tempo: [[191, 74, 120]] }), 1500, (r) => replies.push(r));
  schedule.tick(1500);
  expect(replies.some((r) => r.type === "fault")).toBe(false);
  expect(replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : [])).map((m) => m.bytes)).toEqual([[191, 74, 120]]);
});
const chaseCues = "[00:00] {midi:cc 1 0 0} {midi:pc 1 1}\n[00:40] {midi:pc 1 2}\n[01:10] {midi:cc 1 0 0} {midi:pc 1 3}\n[01:40] {midi:pc 1 9}";
it("chases the patch in force when starting at 1:30, before the start tempo, 30 ms ahead of the start", () => {
  const f = fixture({ cues: parseChart(chaseCues), position: 90, origin: 1000 - 90_000, duration: 200, tempo: [[191, 74, 120]] });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([[176, 0, 0], [192, 3], [191, 74, 120]]);
  expect(f.messages()[0].due).toBe(1000);
  f.schedule.tick(1020);
  expect(f.messages()).toHaveLength(3);
});
it("does not chase when starting from the beginning", () => {
  const f = fixture();
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([[192, 1]]);
});
it("replays dropped patch changes as a chase after a stall instead of leaving the pedal on the old patch", () => {
  const f = fixture({ cues: parseChart("[00:00.30] {midi:pc 1 2}\n[00:01.00] {midi:pc 1 4}"), duration: 5 });
  f.schedule.tick(1000);
  f.schedule.sync(0.7, 1700, 1700);
  f.schedule.tick(1700);
  expect(f.replies.flatMap((r) => (r.type === "batch" ? (r.dropped ?? []) : [])).map((m) => m.bytes)).toEqual([[192, 2]]);
  expect(f.messages().map((m) => m.bytes)).toEqual([[192, 2]]);
});

it("sends the start tempo at the start of a count-in, with the first cue at the audio start two seconds later", () => {
  // One bar at 120 BPM: the count-in starts at 1.0 s on the clock and the audio, with cue 0:00, at 3.0 s.
  const f = fixture({
    cues: parseChart("[00:00] {midi:pc 1 1}"),
    position: 0,
    duration: 2,
    origin: 3000,
    tempoAt: 1000,
    lookahead: 2.5,
    tempo: [[191, 74, 120]],
  });
  f.schedule.tick(1000);
  const tempo = f.messages().find((m) => m.label === "Song tempo");
  const cue = f.messages().find((m) => m.label === "Song cue");
  expect(tempo?.due).toBe(1000);
  expect(cue?.due).toBe(3000);
});

/**
 * Runs a schedule the way the worker does: a tick every 20 ms and a checkpoint every 50 ms, taken from `audio(now)`.
 * `actions` run at the given clock times, before that tick, so a test can plan a jump at a chosen moment.
 */
function run(
  f: ReturnType<typeof fixture>,
  from: number,
  to: number,
  audio: (now: number) => number,
  actions: [number, () => void][] = [],
) {
  for (let now = from; now <= to; now += 20) {
    for (const [time, action] of actions) if (time === now) action();
    f.schedule.tick(now);
    if ((now - from) % 50 === 0) f.schedule.sync(audio(now), now, now);
  }
}

/** Song 0–16 with the clock on, a section 8–16 looped three times, then released. The loop is planned two seconds ahead of each boundary. */
it("loops a section three times with the clock running: no Stop, a continuous pulse, and cues once per pass", () => {
  const f = fixture({
    cues: parseChart("[00:08.50] {midi:pc 1 5}\n[00:12.00] {midi:pc 1 7}"),
    clock: true,
    duration: 40,
    origin: 1000,
    bpm: 120,
    lookahead: SYSTEM_LOOKAHEAD,
  });
  // Pass ends at clock 17000, 25000, 33000. Audio: song 0–16 first, then 8–16 on each pass of the loop.
  const audio = (now: number) => (now < 17000 ? (now - 1000) / 1000 : 8 + ((now - 17000) % 8000) / 1000);
  const loopPlan = (boundary: number) => () => f.schedule.plan(16, { at: boundary, position: 8 }, boundary - 2000);
  run(f, 1000, 36000, audio, [
    [15000, loopPlan(17000)],
    [23000, loopPlan(25000)],
    [31000, loopPlan(33000)],
    // Released: no plan at 33000, so the song plays on past the section.
  ]);
  const messages = f.messages();
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(messages.some((m) => m.bytes[0] === 252)).toBe(false);
  const pulses = messages.filter((m) => m.bytes[0] === 248).map((m) => m.due);
  const period = 60000 / 120 / 24;
  expect(pulses.length).toBeGreaterThan(0);
  pulses.forEach((due, i) => expect(due).toBeCloseTo(1000 + i * period, 6));
  const cueDues = messages.filter((m) => m.bytes[0] === 192 && m.bytes[1] === 5).map((m) => m.due);
  expect(cueDues).toEqual([9500, 17500, 25500, 33500]);
});

/** A whole song set to loop: the player wraps at the song end back to its start, and the session plans that jump a second ahead. */
it("keeps cues and the clock running past the wrap of a looping song, with no stall fault and no disarm", () => {
  const f = fixture({ cues: parseChart("[00:02.00] {midi:pc 1 5}"), clock: true, duration: 10, origin: 1000, bpm: 120 });
  // Song 0-10 plays to clock 11000, then jumps back to 2 s and plays on, wrapping again at clock 19000.
  const audio = (now: number) => (now < 11000 ? (now - 1000) / 1000 : 2 + ((now - 11000) % 8000) / 1000);
  const loopPlan = (boundary: number) => () => f.schedule.plan(10, { at: boundary, position: 2 }, boundary - 1000);
  run(f, 1000, 24000, audio, [
    [10000, loopPlan(11000)],
    [18000, loopPlan(19000)],
  ]);
  const messages = f.messages();
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  expect(messages.some((m) => m.bytes[0] === 252)).toBe(false);
  // The pulse is unbroken to the end, well past the 1 s the stall rule would have allowed after the wrap.
  const pulses = messages.filter((m) => m.bytes[0] === 248).map((m) => m.due);
  expect(pulses.at(-1)).toBeGreaterThan(23000);
  pulses.forEach((due, i) => expect(due).toBeCloseTo(1000 + i * (60000 / 120 / 24), 6));
  // The cue at 2 s is passed again on each pass: once at the start, then when each wrap lands on it.
  expect(messages.filter((m) => m.bytes[0] === 192 && m.bytes[1] === 5).map((m) => m.due)).toEqual([3000, 11000, 19000]);
});

it("does not send cues beyond the cap until the plan lifts it", () => {
  const f = fixture({ cues: parseChart("[00:06.00] {midi:pc 1 9}"), duration: 10, origin: 1000 });
  f.schedule.plan(5, null, 1000);
  run(f, 1000, 8000, (now) => (now - 1000) / 1000);
  expect(f.messages().some((m) => m.bytes[1] === 9)).toBe(false);
  f.schedule.plan(null, null, 8000);
  run(f, 8020, 8200, (now) => (now - 1000) / 1000);
  expect(f.messages().filter((m) => m.bytes[0] === 192 && m.bytes[1] === 9)).toHaveLength(1);
});

it("a backward jump chases the state at the new position once, with no duplicates, and replays cues from there", () => {
  const f = fixture({
    cues: parseChart(
      "[00:01.00] {midi:pc 1 2}\n[00:03.00] {midi:cc 1 20 127}\n[00:10.00] {midi:pc 1 5}\n[00:12.00] {midi:cc 1 21 40}\n[00:17.00] {midi:cc 1 22 9}",
    ),
    duration: 30,
    origin: 1000,
  });
  // Plays 0–20 on clock 1000–21000. A jump at 21000 returns to song 15, so the cue at 17.00 plays again.
  const audio = (now: number) => (now < 21000 ? (now - 1000) / 1000 : 15 + (now - 21000) / 1000);
  run(f, 1000, 19000, (now) => (now - 1000) / 1000);
  f.schedule.plan(20, { at: 21000, position: 15 }, 19000);
  run(f, 19020, 24000, audio);
  const chase = f.messages().filter((m) => m.label === "Chase state");
  // Two chases: the start, and the jump. The jump's is the one at clock 21000.
  const atJump = chase.filter((m) => m.due >= 21000).map((m) => m.bytes);
  expect(atJump).toEqual([
    [192, 5],
    [176, 20, 127],
    [176, 21, 40],
  ]);
  expect(f.messages().filter((m) => m.bytes[1] === 22)).toHaveLength(2);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("does not fault on a jump, and ignores a checkpoint taken before the jump", () => {
  const f = fixture({ cues: parseChart("[00:01.00] {midi:pc 1 2}"), duration: 30, origin: 1000 });
  run(f, 1000, 4000, (now) => (now - 1000) / 1000);
  f.schedule.plan(3, { at: 4000, position: 1 }, 4000);
  // A jump backwards: the position falls from 3 to 1 on the clock. Without the jump the stall check would fire.
  run(f, 4020, 6000, (now) => (now < 4000 ? 3 : 1 + (now - 4000) / 1000));
  // A checkpoint sampled just before the jump arrives late: it describes the old passage and must be ignored.
  f.schedule.sync(2.9, 3990, 6000);
  expect(f.replies.some((r) => r.type === "fault" || r.type === "resync")).toBe(false);
});

it("sends each cue at its rated clock time: a song second takes 1 / rate of clock time", () => {
  // 50% from clock 1000: the cue at song 1 s is due a clock second later.
  const f = fixture({ rate: 0.5, duration: 4, origin: 1000 });
  for (let t = 1000; t <= 3040; t += 20) {
    f.schedule.sync(((t - 1000) / 1000) * 0.5, t, t);
    f.schedule.tick(t);
  }
  expect(f.messages().map((m) => [m.bytes, m.due])).toEqual([
    [[192, 1], 1000],
    [[177, 12, 127], 3000],
  ]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it.each([0.5, 0.8, 1.25])("sends 24 PPQN at the effective BPM at rate %f", (rate) => {
  const bpm = 120;
  const f = fixture({ bpm, rate, clock: true, cues: [], duration: 10 });
  // The song is 10 song seconds long, which takes 10 / rate seconds on the clock.
  const end = 1000 + 10000 / rate;
  for (let t = 1000; t <= end + 100; t += 20) {
    f.schedule.sync(((t - 1000) / 1000) * rate, t, t);
    f.schedule.tick(t);
  }
  const clocks = f.messages().filter((m) => m.bytes[0] === 248);
  // Pulses count song beats, so the song always has the same number of them whatever its rate.
  expect(Math.abs(clocks.length - (10 * 24 * bpm) / 60)).toBeLessThanOrEqual(2);
  for (let i = 1; i < clocks.length; i++) {
    const gap = clocks[i].due - clocks[i - 1].due;
    expect(gap).toBeCloseTo(60000 / (24 * bpm * rate), 5);
  }
});

it("sends the first clock pulses on the grid when the audio starts at the origin", () => {
  // The scheduler starts with its origin at the audio start (session.ts holds the audio back by CLOCK_LEAD_MS), so no pulse is overdue.
  const f = fixture({ clock: true, cues: [], duration: 10, origin: 1000 });
  run(f, 1000, 1400, (now) => (now - 1000) / 1000);
  const pulses = f.messages().filter((m) => m.bytes[0] === 248).map((m) => m.due);
  expect(pulses.length).toBeGreaterThan(1);
  const period = 60000 / 120 / 24;
  pulses.forEach((due, i) => expect(due).toBeCloseTo(1000 + i * period, 6));
});

it("keeps the clock's pulse spacing steady across a rate-aware jump", () => {
  const f = fixture({ bpm: 120, rate: 0.5, clock: true, cues: [], duration: 20 });
  f.schedule.plan(null, { at: 1000 + 2000, position: 10 }, 1000);
  for (let t = 1000; t <= 4000; t += 20) {
    f.schedule.sync(((t - 1000) / 1000) * 0.5, t, t);
    f.schedule.tick(t);
  }
  const clocks = f.messages().filter((m) => m.bytes[0] === 248);
  for (let i = 1; i < clocks.length; i++) expect(clocks[i].due - clocks[i - 1].due).toBeCloseTo(60000 / (24 * 120 * 0.5), 5);
});

it("re-anchors cues and clock pulses at a speed swap, with no duplicates and no stall fault", () => {
  const cues = parseChart("[00:02] {midi:pc 3 2}\n[00:05] {midi:pc 3 5}\n[00:08] {midi:pc 3 8}");
  const f = fixture({ cues, bpm: 120, rate: 1, clock: true, duration: 10, origin: 1000 });
  // Until the swap the song plays at 1x, holding cues after song 3 s. The swap lands at clock 4000 on song 3 s, at 50%.
  f.schedule.plan(3, { at: 4000, position: 3, rate: 0.5, keepsPosition: true }, 1000);
  for (let t = 1000; t <= 16000; t += 20) {
    const song = t < 4000 ? (t - 1000) / 1000 : 3 + (t - 4000) / 2000;
    f.schedule.sync(song, t, t);
    f.schedule.tick(t);
  }
  const cueSent = (value: number) => f.messages().find((m) => m.label === "Song cue" && m.bytes[1] === value)?.due;
  expect(cueSent(2)).toBeCloseTo(3000, 0);
  // Song 5 s is 2 s of song after the swap at 50%, so 4 s of clock after the swap.
  expect(cueSent(5)).toBeCloseTo(8000, 0);
  expect(cueSent(8)).toBeCloseTo(14000, 0);
  // The swap keeps the song position, so the pedals keep their state and nothing is chased.
  expect(f.messages().some((m) => m.label === "Chase state")).toBe(false);
  const cueMessages = f.messages().filter((m) => m.label === "Song cue");
  expect(new Set(cueMessages.map((m) => m.bytes[1])).size).toBe(cueMessages.length);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  const clocks = f.messages().filter((m) => m.bytes[0] === 248).map((m) => m.due);
  expect(new Set(clocks).size).toBe(clocks.length);
  const before = clocks.filter((t) => t < 4000);
  const after = clocks.filter((t) => t > 4100);
  for (let i = 1; i < before.length; i++) expect(before[i] - before[i - 1]).toBeCloseTo(60000 / (24 * 120), 3);
  for (let i = 1; i < after.length; i++) expect(after[i] - after[i - 1]).toBeCloseTo(60000 / (24 * 120 * 0.5), 3);
});

it("carries out a due speed-swap jump when the plan is cleared before the next tick", () => {
  const f = fixture({ bpm: 120, rate: 1, clock: true, cues: [], duration: 20, origin: 1000 });
  f.schedule.plan(null, { at: 4000, position: 3, rate: 0.77, keepsPosition: true }, 1000);
  for (let t = 1000; t <= 3980; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  // The audio passes the swap at clock 4000 and the session clears the plan at 4010, before the worker's next tick at 4020.
  f.schedule.plan(null, null, 4010);
  for (let t = 4020; t <= 12000; t += 20) {
    f.schedule.sync(3 + ((t - 4000) / 1000) * 0.77, t, t);
    f.schedule.tick(t);
  }
  const clocks = f.messages().filter((m) => m.bytes[0] === 248).map((m) => m.due);
  // Pulses after the swap follow the new rate, not the 120 BPM spacing the clear would have left behind.
  const after = clocks.filter((t) => t > 4100);
  expect(after.length).toBeGreaterThan(10);
  for (let i = 1; i < after.length; i++) expect(after[i] - after[i - 1]).toBeCloseTo(60000 / (24 * 120 * 0.77), 3);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("still cancels a jump that is not due yet", () => {
  const f = fixture({ bpm: 120, rate: 1, clock: true, cues: [], duration: 20, origin: 1000 });
  f.schedule.plan(null, { at: 4000, position: 3, rate: 0.77, keepsPosition: true }, 1000);
  for (let t = 1000; t <= 3980; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  // The clear arrives at 3990, before the swap is due, so the swap is cancelled and the song keeps its 1x rate.
  f.schedule.plan(null, null, 3990);
  for (let t = 4000; t <= 8000; t += 20) {
    f.schedule.sync((t - 1000) / 1000, t, t);
    f.schedule.tick(t);
  }
  const clocks = f.messages().filter((m) => m.bytes[0] === 248).map((m) => m.due);
  const after = clocks.filter((t) => t > 4100);
  expect(after.length).toBeGreaterThan(10);
  for (let i = 1; i < after.length; i++) expect(after[i] - after[i - 1]).toBeCloseTo(60000 / (24 * 120), 3);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("a loop wrap sends the cue at the loop start once, and chases no state that cue sets", () => {
  // Pedal 16 gets the 68/69 patches on every 4 s, and pedal 1 gets the matching 0/1 patches with them.
  const cues = parseChart(
    [
      "[00:00] {midi:pc 16 68} {midi:pc 1 0}",
      "[00:04] {midi:pc 16 69} {midi:pc 1 1}",
      "[00:08] {midi:pc 16 68} {midi:pc 1 0}",
      "[00:12] {midi:pc 16 69} {midi:pc 1 1}",
      "[00:16] {midi:pc 16 68} {midi:pc 1 0}",
      "[00:20] {midi:pc 16 69} {midi:pc 1 1}",
      "[00:24] {midi:pc 16 68} {midi:pc 1 0}",
      "[00:28] {midi:pc 16 69} {midi:pc 1 1}",
      "[00:32] {midi:pc 16 68} {midi:pc 1 0}",
    ].join("\n"),
  );
  const f = fixture({ cues, duration: 40, origin: 1000, pedalChannel: 16, lookahead: BLUETOOTH_LOOKAHEAD });
  // Section 16–32 loops: the audio jumps from song 32 s back to 16 s at clock 33000.
  const audio = (now: number) => (now < 33000 ? (now - 1000) / 1000 : 16 + (now - 33000) / 1000);
  run(f, 1000, 40000, audio, [[31000, () => f.schedule.plan(32, { at: 33000, position: 16 }, 31000)]]);
  // The cue at 32 is held (it is not sent), and the cue at 16 goes out with no chase for pedal 1 or pedal 16 at the same time.
  expect(f.messages().filter((m) => m.due === 33000).map((m) => m.bytes)).toEqual([
    [192, 0],
    [207, 68],
  ]);
  expect(f.messages().some((m) => m.label === "Chase state")).toBe(false);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("a cue at a pause boundary is held while paused and fires on resume, not before the pause", () => {
  const cues = parseChart("[00:03] {midi:pc 1 2}");
  // Playing to song 3 s at clock 4000. The plan holds the cue on the boundary, then the pause stops this schedule.
  const playing = fixture({ cues, duration: 10, origin: 1000 });
  playing.schedule.plan(3, null, 1000);
  run(playing, 1000, 4000, (now) => Math.min((now - 1000) / 1000, 3));
  playing.schedule.stop();
  expect(playing.messages().some((m) => m.bytes[1] === 2)).toBe(false);
  // Resuming from song 3 s at clock 5000 starts a new schedule there, so the cue is due at the start.
  const resumed = fixture({ cues, position: 3, origin: 2000, duration: 10 });
  resumed.schedule.tick(5000);
  expect(resumed.messages().map((m) => [m.bytes, m.due])).toEqual([[[192, 2], 5000]]);
});

it("a cue at a speed-swap position is sent once, at the swap's clock time", () => {
  const cues = parseChart("[00:02] {midi:pc 3 2}\n[00:03] {midi:pc 3 3}\n[00:05] {midi:pc 3 5}\n[00:08] {midi:pc 3 8}");
  const f = fixture({ cues, bpm: 120, rate: 1, clock: true, duration: 10, origin: 1000 });
  // The swap lands at clock 4000 on song 3 s, at 50%. The cue on song 3 s is held by the plan, then sent by the swap.
  f.schedule.plan(3, { at: 4000, position: 3, rate: 0.5, keepsPosition: true }, 1000);
  for (let t = 1000; t <= 16000; t += 20) {
    const song = t < 4000 ? (t - 1000) / 1000 : 3 + (t - 4000) / 2000;
    f.schedule.sync(song, t, t);
    f.schedule.tick(t);
  }
  const atSwap = f.messages().filter((m) => m.label === "Song cue" && m.bytes[1] === 3);
  expect(atSwap.map((m) => m.due)).toEqual([4000]);
  expect(f.messages().some((m) => m.label === "Chase state")).toBe(false);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("a start at exactly a cue time sends no chase for the channels and controllers that cue sets", () => {
  const cues = parseChart(
    "[00:00] {midi:pc 16 68} {midi:pc 1 0}\n[00:12] {midi:pc 16 69} {midi:cc 1 7 100} {midi:pc 1 1}\n[00:16] {midi:pc 16 68} {midi:pc 1 0} {midi:cc 1 7 90}",
  );
  // Starting at song 16 s, on the clock at 1000. The chase would otherwise bring pedal 16 to 69 and pedal 1 to 1 and volume to 100.
  const f = fixture({ cues, position: 16, origin: 1000 - 16_000, duration: 40, pedalChannel: 16 });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => [m.bytes, m.label])).toEqual([
    [[192, 0], "Song cue"],
    [[176, 7, 90], "Song cue"],
    [[207, 68], "Song cue"],
  ]);
});

it("a start on a cue that sends only a program change keeps the bank in force, and not the chased program", () => {
  // Pedal 16 is on bank 1 from 2 s. The cue at 16 s sends a bare program change, so the bank must still be sent before it.
  const cues = parseChart("[00:02] {midi:cc 16 0 1} {midi:pc 16 5}\n[00:16] {midi:pc 16 9}");
  const f = fixture({ cues, position: 16, origin: 1000 - 16_000, duration: 40, pedalChannel: 16 });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [191, 0, 1],
    [207, 9],
  ]);
});

it("a start on a cue that sends its own bank leaves the chased bank out", () => {
  const cues = parseChart("[00:02] {midi:cc 16 0 1} {midi:pc 16 5}\n[00:16] {midi:cc 16 0 0} {midi:pc 16 9}");
  const f = fixture({ cues, position: 16, origin: 1000 - 16_000, duration: 40, pedalChannel: 16 });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => [m.bytes, m.label])).toEqual([
    [[191, 0, 0], "Song cue"],
    [[207, 9], "Song cue"],
  ]);
});

it("a section jump to another position still chases the state there", () => {
  const cues = parseChart("[00:02] {midi:pc 3 2}\n[00:05] {midi:pc 3 5}\n[00:08] {midi:pc 3 8}");
  const f = fixture({ cues, duration: 10, origin: 1000 });
  // From song 3 s the section jumps to song 6 s at clock 4000. The pedals last saw patch 2 at song 2 s and patch 5 at song 5 s.
  const audio = (now: number) => (now < 4000 ? (now - 1000) / 1000 : 6 + (now - 4000) / 1000);
  run(f, 1000, 6000, audio, [[4000, () => f.schedule.plan(null, { at: 4000, position: 6 }, 4000)]]);
  const atJump = f.messages().filter((m) => m.label === "Chase state" && m.due >= 4000);
  expect(atJump.map((m) => m.bytes)).toEqual([[194, 5]]);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

describe("MIDI triggers and file cues in the schedule", () => {
  it("sends play triggers once with the start, and not again when a loop jumps back over the start", () => {
    const f = fixture({ cues: [], duration: 10, playTriggers: [[177, 80, 127]] });
    f.schedule.tick(1000);
    f.schedule.plan(null, { at: 1500, position: 0 }, 1000);
    for (let t = 1020; t <= 2600; t += 20) {
      f.schedule.sync((t - 1000) / 1000, t, t);
      f.schedule.tick(t);
    }
    const plays = f.messages().filter((m) => m.label === "Song play trigger");
    expect(plays.map((m) => m.bytes)).toEqual([[177, 80, 127]]);
  });
  it("never schedules a trigger cue by its time", () => {
    const cues = parseChart("{midi@load: pc 1 5}\n{midi@end: pc 1 6}\n[00:00.50] {midi:pc 1 7}");
    const f = fixture({ cues, duration: 2 });
    f.schedule.tick(1000);
    f.schedule.tick(1600);
    expect(f.messages().map((m) => m.bytes)).toEqual([[192, 7]]);
  });
  it("plays a file cue at the song rate, so a 125% song reaches its cue sooner on the clock", () => {
    const f = fixture({ cues: [{ time: 1, text: "", messages: [[192, 9]], fromFile: true }], rate: 1.25, duration: 5 });
    f.schedule.tick(1000);
    f.schedule.tick(1700);
    expect(f.messages().map((m) => [m.bytes, m.due])).toEqual([[[192, 9], 1800]]);
  });
  it("replays the latest song select as state when starting mid-song", () => {
    const cues = parseChart("[00:00.20] {midi:songselect 1}\n[00:00.60] {midi:songselect 4} {midi:pc 1 2}\n[00:01.00] {midi:start}");
    const f = fixture({ cues, position: 1.5, origin: 500, duration: 5 });
    f.schedule.tick(1000);
    expect(f.messages().map((m) => [m.bytes, m.label])).toEqual([
      [[243, 4], "Chase state"],
      [[192, 2], "Chase state"],
    ]);
  });
});

it("fires a cue inside a loop once per pass, and a play trigger only at the start", () => {
  const cues = parseChart("[00:00.50] {midi:pc 1 7}\n{midi@load: pc 1 1}");
  const f = fixture({ cues, duration: 10, playTriggers: [[192, 2]] });
  f.schedule.tick(1000);
  // Loop back to the start at 1.0 s of song time, three times over.
  f.schedule.plan(null, { at: 1600, position: 0 }, 1000);
  for (let t = 1020; t <= 4000; t += 20) {
    f.schedule.sync(Math.max(0, (t - 1000) / 1000), t, t);
    f.schedule.tick(t);
    if (t === 2600) f.schedule.plan(null, { at: 2700, position: 0 }, t);
  }
  const bytes = f.messages().map((m) => m.bytes);
  expect(bytes.filter((b) => b[0] === 192 && b[1] === 7)).toHaveLength(3);
  expect(bytes.filter((b) => b[0] === 192 && b[1] === 2)).toHaveLength(1);
  expect(bytes.filter((b) => b[0] === 192 && b[1] === 1)).toHaveLength(0);
});

it("sends the other pedal's message before the GP-180's when a cue is due together, and keeps cues at different times apart", () => {
  const together = fixture({ cues: parseChart("[00:00] {midi:pc 16 68} {midi:pc 1 0}"), pedalChannel: 16 });
  together.schedule.tick(1000);
  expect(together.messages().map((m) => m.bytes)).toEqual([
    [192, 0],
    [207, 68],
  ]);
  const apart = fixture({ cues: parseChart("[00:00] {midi:pc 16 68}\n[00:01] {midi:pc 1 0}"), pedalChannel: 16, lookahead: 1 });
  apart.schedule.tick(1000);
  expect(apart.messages().map((m) => m.bytes)).toEqual([
    [207, 68],
    [192, 0],
  ]);
});
it("skips an assigned trigger controller in the chase, and sends the chase CHASE_LEAD_MS before the audio position", () => {
  // The audio is at song 30 s at clock 2000 (origin 1000 + 1000 - 30000), so the chase is due 100 ms before it.
  const f = fixture({
    cues: parseChart("[00:10] {midi:cc 1 11 90}\n[00:20] {midi:cc 2 70 127}"),
    position: 30,
    origin: 1000 + 1000 - 30_000,
    duration: 200,
    chaseTriggers: [[2, 70]],
  });
  f.schedule.tick(1000);
  expect(f.messages().map((m) => [m.bytes, m.label, m.due])).toEqual([[[176, 11, 90], "Chase state", 1900]]);
});

describe("the audio start-up grace", () => {
  it("does not fault when the audio starts two seconds late, and re-anchors the cues on the actual start", () => {
    // Planned start at clock 1000. The output wakes and the audio only starts at clock 3000, so song position stays at 0 until then.
    const f = fixture({ cues: parseChart("[00:00] {midi:pc 1 1}\n[00:01] {midi:cc 2 12 127}"), duration: 10, lookahead: SYSTEM_LOOKAHEAD });
    const audio = (now: number) => Math.max(0, (now - 3000) / 1000);
    run(f, 1000, 4500, audio);
    expect(f.replies.some((r) => r.type === "fault")).toBe(false);
    expect(f.replies.some((r) => r.type === "resync")).toBe(true);
    // The 1 s cue is held while the audio is silent, so it is never due before the actual start.
    const later = f.messages().find((m) => m.bytes[0] === 177);
    expect(later?.due).toBeCloseTo(4000, 6);
  });

  it("faults with the start-up message when the audio never starts within the grace", () => {
    const f = fixture({ cues: [], duration: 10 });
    run(f, 1000, 6100, () => 0);
    const faults = f.replies.filter((r) => r.type === "fault");
    expect(faults).toEqual([{ type: "fault", error: "The audio did not start. Cues disarmed." }]);
  });

  it("does not fault before the grace ends", () => {
    const f = fixture({ cues: [], duration: 10 });
    run(f, 1000, 5900, () => 0);
    expect(f.replies.some((r) => r.type === "fault")).toBe(false);
  });

  it("still faults on a 1.2 s freeze once the audio has started", () => {
    const f = fixture({ cues: [], duration: 10 });
    const audio = (now: number) => (Math.min(now, 2000) - 1000) / 1000;
    run(f, 1000, 3300, audio);
    const faults = f.replies.filter((r) => r.type === "fault");
    expect(faults).toEqual([{ type: "fault", error: "MIDI timing interrupted: the audio clock stopped advancing." }]);
  });
});

it("follows a steady +105 ms audio offset: later cues and clock pulses move 105 ms, with no resync and no fault", () => {
  const f = fixture({ cues: parseChart("[00:00.50] {midi:pc 1 1}\n[00:02.00] {midi:pc 1 2}"), clock: true, duration: 4 });
  // The audio reports song time 105 ms behind the clock from the first checkpoint on.
  for (let t = 1200; t <= 3300; t += 50) {
    f.schedule.sync((t - 1105) / 1000, t, t);
    f.schedule.tick(t);
  }
  const cues = f.messages().filter((m) => m.label !== "MIDI clock");
  expect(cues.map((m) => m.due)).toEqual([1605, 3105]);
  const pulses = f.messages().filter((m) => m.bytes[0] === 248 && m.due >= 2000);
  expect(pulses.length).toBeGreaterThan(0);
  // Pulse k is due 1105 ms plus k pulse periods; the shift moves the whole grid, not only the pulses after it.
  const period = 60000 / 120 / 24;
  pulses.forEach((p) => expect((p.due - 1105) / period).toBeCloseTo(Math.round((p.due - 1105) / period), 3));
  expect(f.replies.some((r) => r.type === "resync")).toBe(false);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("does not move anything for one checkpoint 100 ms late, followed by on-time checkpoints", () => {
  const f = fixture({ cues: parseChart("[00:02.00] {midi:pc 1 2}"), duration: 4 });
  for (let t = 1200; t <= 3300; t += 50) {
    // Only the checkpoint at 1300 is late. Its position still advances, so it is judged by the drift rule.
    f.schedule.sync((t - 1000) / 1000, t === 1300 ? t + 100 : t, t);
    f.schedule.tick(t);
  }
  expect(f.messages().map((m) => m.due)).toEqual([3000]);
  expect(f.replies.some((r) => r.type === "resync")).toBe(false);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

it("still resyncs on each drift above STALE_MS and faults on the third", () => {
  const f = fixture({ cues: [], duration: 10 });
  // Each checkpoint is 300 ms later than the origin the previous resync left behind.
  let late = 0;
  for (let t = 1100; t <= 1300; t += 50) {
    late += 300;
    f.schedule.sync((t - 1000) / 1000, t + late, t);
    f.schedule.tick(t);
  }
  expect(f.replies.filter((r) => r.type === "resync")).toHaveLength(2);
  expect(f.replies.filter((r) => r.type === "fault")).toHaveLength(1);
});

it("follows a steady -60 ms audio offset (audio ahead), so later cues fire 60 ms earlier", () => {
  const f = fixture({ cues: parseChart("[00:02.00] {midi:pc 1 2}"), duration: 4 });
  for (let t = 1200; t <= 3300; t += 50) {
    f.schedule.sync((t - 940) / 1000, t, t);
    f.schedule.tick(t);
  }
  expect(f.messages().map((m) => m.due)).toEqual([2940]);
  expect(f.replies.some((r) => r.type === "resync")).toBe(false);
  expect(f.replies.some((r) => r.type === "fault")).toBe(false);
});

describe("worker clock", () => {
  const HOURS = 3 * 3600 * 1000;
  const RENDERER_START = 1000;
  /**
   * Runs a worker's schedule against the renderer's checkpoints for two seconds. `workerNow(t)` is the worker's clock when the renderer's
   * clock reads `t`: the same instant, read on the worker's clock.
   */
  function runWorker(workerNow: (t: number) => number) {
    const replies: SchedulerReply[] = [];
    const schedule = new MidiSchedule(config({ origin: RENDERER_START }), workerNow(RENDERER_START), (r) => replies.push(r));
    schedule.tick(workerNow(RENDERER_START));
    for (let t = RENDERER_START + 20; t <= RENDERER_START + 2000; t += 20) {
      schedule.sync((t - RENDERER_START) / 1000, t, workerNow(t));
      schedule.tick(workerNow(t));
    }
    return { replies, messages: () => replies.flatMap((r) => (r.type === "batch" ? r.messages : [])) };
  }

  it("a schedule whose clock is hours from the renderer's faults on start, which is the sleep fault", () => {
    const { replies } = runWorker((t) => t + HOURS);
    expect(replies.some((r) => r.type === "fault")).toBe(true);
  });

  it("a worker whose own time origin is hours away still runs on the renderer's clock, from the start request", () => {
    // The worker's clock counts from its own start, so its time origin plays no part once the request's clock time anchors it.
    let elapsed = 0;
    const clock = alignedClock(RENDERER_START, () => elapsed);
    const { replies, messages } = runWorker((t) => {
      elapsed = t - RENDERER_START;
      return clock();
    });
    expect(replies.some((r) => r.type === "fault" || r.type === "resync")).toBe(false);
    expect(messages().map((m) => [m.bytes, m.due])).toEqual([
      [[192, 1], 1000],
      [[177, 12, 127], 2000],
    ]);
  });
});

it("sends timed click messages at their own clock time, ahead by the lookahead, once, and not before they are near", () => {
  const f = fixture({ cues: [], lookahead: SYSTEM_LOOKAHEAD });
  f.schedule.addTimed([
    { bytes: [153, 37, 100], due: 1500 },
    { bytes: [137, 37, 0], due: 1550 },
  ]);
  f.schedule.tick(1000);
  expect(f.messages()).toEqual([]);
  f.schedule.sync(0.3, 1300, 1300);
  f.schedule.tick(1310);
  expect(f.messages().map((m) => [m.bytes, m.due, m.label])).toEqual([[[153, 37, 100], 1500, "Click"]]);
  f.schedule.sync(0.35, 1350, 1350);
  f.schedule.tick(1360);
  f.schedule.tick(1380);
  expect(f.messages().map((m) => m.bytes)).toEqual([
    [153, 37, 100],
    [137, 37, 0],
  ]);
});

it("takes no timed click messages once stopped", () => {
  const f = fixture({ cues: [], lookahead: SYSTEM_LOOKAHEAD });
  f.schedule.stop();
  f.schedule.addTimed([{ bytes: [153, 37, 100], due: 1010 }]);
  f.schedule.tick(1005);
  expect(f.messages()).toEqual([]);
});
