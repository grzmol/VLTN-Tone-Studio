import { describe, expect, it } from "vitest";
import { lateAction, MidiSchedule, type SchedulerConfig, type SchedulerReply } from "./midi-scheduler";
import { cycleFrames, fullFrame, quarterFrame } from "./timecode";

/** A schedule with no cues, so only timecode (and clock, when asked) is in the output. Origin 1000 ms is song position zero. */
function fixture(patch: Partial<SchedulerConfig> = {}) {
  const replies: SchedulerReply[] = [];
  const config: SchedulerConfig = {
    cues: [],
    position: 0,
    duration: 10,
    origin: 1000,
    bpm: 120,
    clock: false,
    tempo: null,
    timecode: { fps: 25, offset: 0 },
    ...patch,
  };
  const schedule = new MidiSchedule(config, 1000, (r) => replies.push(r));
  const timecode = () => replies.flatMap((r) => (r.type === "batch" ? r.messages : [])).filter((m) => m.label.startsWith("MIDI timecode"));
  return { schedule, replies, timecode };
}

describe("MIDI timecode in the schedule", () => {
  it("sends a full frame at the start, then quarter frames every 10 ms at 25 fps", () => {
    const f = fixture();
    f.schedule.tick(1000);
    const sent = f.timecode();
    // A 120 ms lookahead from 1000 ms reaches quarter frames due before 1120 ms: indexes 0 to 11.
    expect(sent[0]).toMatchObject({ bytes: fullFrame(0, 25), due: 1000 });
    expect(sent.slice(1).map((m) => m.due)).toEqual(Array.from({ length: 12 }, (_, i) => 1000 + i * 10));
    expect(sent[1].bytes).toEqual(quarterFrame(0, 0, 25));
    // Index 8 starts the second two-frame cycle, which carries frame 2.
    expect(sent[9].bytes).toEqual([0xf1, 0x02]);
  });

  it("follows the offset, so the full frame and pieces carry 01:02:03:04", () => {
    const f = fixture({ timecode: { fps: 25, offset: 93079 } });
    f.schedule.tick(1000);
    const [full, first] = f.timecode();
    expect(full.bytes).toEqual([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7]);
    expect(first.bytes).toEqual([0xf1, 0x04]);
  });

  it("sends nothing during a count-in: the start is at song position zero, which the origin marks", () => {
    const f = fixture({ origin: 1500 });
    f.schedule.tick(1000);
    expect(f.timecode()).toEqual([]);
    f.schedule.tick(1400);
    const sent = f.timecode();
    expect(sent[0].bytes[0]).toBe(0xf0);
    expect(sent[0].due).toBe(1500);
    expect(sent.every((m) => m.due >= 1500)).toBe(true);
  });

  it("restarts at a jump with a full frame at the new position and piece 0, and sends nothing of the old passage after it", () => {
    const f = fixture();
    f.schedule.tick(1000);
    f.schedule.plan(null, { at: 1500, position: 2 }, 1000);
    f.schedule.tick(1400);
    // Quarters due before the jump still belong to the old passage, and none is due at or after it.
    expect(f.timecode().filter((m) => m.due >= 1500)).toEqual([]);
    f.schedule.tick(1500);
    const after = f.timecode().filter((m) => m.due >= 1500);
    const frames = 50; // 2 s at 25 fps
    expect(after[0]).toMatchObject({ due: 1500, bytes: fullFrame(frames, 25) });
    expect(after.slice(1, 4).map((m) => m.bytes)).toEqual([0, 1, 2].map((i) => quarterFrame(i, frames, 25)));
    expect(after[1].due).toBe(1500);
  });

  it("follows a speed swap: quarter spacing scales by 1 / rate (10 ms at 1x becomes 8 ms at 1.25x), and the restart is a full frame", () => {
    const f = fixture();
    f.schedule.tick(1000);
    f.schedule.plan(null, { at: 1500, position: 2, rate: 1.25 }, 1000);
    f.schedule.tick(1500);
    const after = f.timecode().filter((m) => m.due >= 1500);
    expect(after[0].bytes[0]).toBe(0xf0);
    expect(after.slice(1, 4).map((m) => m.due)).toEqual([1500, 1508, 1516]);
  });

  it("drops late quarter frames rather than sending them in a burst, and counts the stall once", () => {
    const f = fixture();
    f.schedule.tick(1000);
    f.schedule.sync(0.6, 1600, 1600);
    f.schedule.tick(1600);
    const batches = f.replies.filter((r): r is Extract<SchedulerReply, { type: "batch" }> => r.type === "batch");
    const last = batches[batches.length - 1];
    const dueTimes = last.messages.filter((m) => m.label === "MIDI timecode").map((m) => m.due);
    // Quarter frames due more than 250 ms ago (before 1350) are skipped; those still in time are sent.
    expect(dueTimes[0]).toBeGreaterThanOrEqual(1350);
    expect(dueTimes.length).toBe(37);
    expect(last.dropped?.map((m) => m.label)).toEqual(["MIDI timecode (late)"]);
    expect(last.messages.some((m) => m.bytes[0] === 0xf1 && m.due < 1350)).toBe(false);
  });

  it("stops quarter frames at a hand-over, so the next song's full frame is not followed by the old one", () => {
    const f = fixture();
    f.schedule.endTimecode(1050);
    f.schedule.tick(1000);
    f.schedule.tick(1100);
    expect(f.timecode().length).toBeGreaterThan(0);
    expect(f.timecode().every((m) => m.due < 1050)).toBe(true);
  });

  it("resumes quarter frames when a chain is dropped and its stop is lifted", () => {
    const f = fixture();
    f.schedule.endTimecode(1050);
    f.schedule.endTimecode(null);
    f.schedule.tick(1000);
    expect(f.timecode().some((m) => m.due >= 1050)).toBe(true);
  });

  it("never runs clock alongside timecode", () => {
    const f = fixture({ clock: true });
    f.schedule.tick(1000);
    const bytes = f.replies.flatMap((r) => (r.type === "batch" ? r.messages : [])).map((m) => m.bytes);
    expect(bytes.some((b) => b[0] === 0xf8)).toBe(false);
    expect(bytes.some((b) => b[0] === 0xf1)).toBe(true);
  });

  it("with no timecode configured, sends no timecode", () => {
    const f = fixture({ timecode: undefined });
    f.schedule.tick(1000);
    expect(f.timecode()).toEqual([]);
  });

  it("keeps the cycle frame count two frames on per eight pieces", () => {
    expect(cycleFrames(15, 4)).toBe(6);
  });
});

describe("timecode across a join", () => {
  // Song A plays at 0.84x with 25 fps, so its quarter frames are 11.9 ms apart. The join is clock time 1500, where song B's origin puts
  // B's song position zero. The hand-over comes 500 ms earlier, at 1000.
  const interval = 1000 / (4 * 25 * 0.84);
  const join = 1500;
  const outgoing = { anchor: { time: 1000, frames: 3600 * 25 }, next: 0, fps: 25 as const, rate: 0.84, end: join };
  const incoming = { origin: join, timecode: { fps: 25 as const, offset: 0 }, lookahead: 0.2, timecodeTail: outgoing };

  /** Ticks the incoming schedule every 20 ms from the hand-over to `to`, and returns the timecode it sent in order. */
  function sentFrom(patch: Partial<SchedulerConfig>, to = 1600, stopAt?: number) {
    const f = fixture(patch);
    let before = 0;
    for (let t = 1000; t <= to; t += 20) {
      if (t === stopAt) {
        f.schedule.stop();
        before = f.timecode().length;
      }
      f.schedule.tick(t);
    }
    return { sent: f.timecode(), before };
  }

  it("carries the outgoing quarter frames to the join, then the incoming full frame, with no gap larger than one quarter frame", () => {
    const { sent } = sentFrom(incoming);
    const full = sent.find((m) => m.bytes[0] === 0xf0)!;
    const before = sent.filter((m) => m.bytes[0] === 0xf1 && m.due < join);
    expect(full.due).toBe(join);
    expect(before[0].due).toBe(1000);
    expect(join - Math.max(...before.map((m) => m.due))).toBeLessThanOrEqual(interval + 1);
    // Nothing of the outgoing song is sent after the incoming full frame.
    expect(sent.slice(sent.indexOf(full) + 1).some((m) => m.due < join)).toBe(false);
  });

  it("stops the outgoing quarter frames when the schedule is stopped during the tail", () => {
    const { sent, before } = sentFrom(incoming, 1600, 1040);
    expect(before).toBeGreaterThan(0);
    expect(sent.length).toBe(before);
  });
});

describe("late timecode in lateAction", () => {
  it("drops late quarter frames", () => {
    expect(lateAction([0xf1, 0x72])).toBe("drop");
  });

  it("sends a late full frame, since it is the one message that sets the position", () => {
    expect(lateAction(fullFrame(93079, 25))).toBe("send");
  });

  it("still drops other SysEx late, and keeps the clock ignored", () => {
    expect(lateAction([0xf0, 0x7d, 0x01, 0xf7])).toBe("drop");
    expect(lateAction([0xf8])).toBe("ignore");
  });
});
