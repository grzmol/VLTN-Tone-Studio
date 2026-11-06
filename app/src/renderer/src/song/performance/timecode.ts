/*
 * MIDI Time Code (pure). A song's position is written as a frame count from 00:00:00:00, plus the song's offset. The scheduler
 * (midi-scheduler.ts) decides when each message goes out; this file only says what the bytes are.
 *
 * Frame rates are 24, 25 and 30 fps, all non-drop. 29.97 drop-frame is not offered: its frame count skips numbers, which the
 * song-time maths here cannot express, and no rig in use needs it.
 *
 * A full frame (F0 7F 7F 01 01 hh mm ss ff F7) is sent at a start, seek, jump, loop wrap or speed swap. The eight quarter frames
 * (F1 nn) that follow it carry the time two frames behind the current frame, as the MIDI specification describes.
 */

export const TIMECODE_RATES = [24, 25, 30] as const;
export type TimecodeRate = (typeof TIMECODE_RATES)[number];
/** The default frame rate, which suits the PAL-style songs the app is mostly used for */
export const DEFAULT_TIMECODE_RATE: TimecodeRate = 25;

const DAY_FRAMES = (fps: number) => 24 * 3600 * fps;

/** The rate code carried in the top bits of the hours byte (full frame) and the last quarter frame. */
export function rateCode(fps: TimecodeRate): number {
  return fps === 24 ? 0 : fps === 25 ? 1 : 3;
}

export function isTimecodeRate(value: unknown): value is TimecodeRate {
  return (TIMECODE_RATES as readonly unknown[]).includes(value);
}

/**
 * Parses `HH:MM:SS:FF` into a frame count from 00:00:00:00. The frame field must be below the rate. Returns an error message, not a
 * throw, so the settings form can show it.
 */
export function parseOffset(text: string, fps: TimecodeRate): { frames: number } | { error: string } {
  const match = /^(\d{1,2}):(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(text.trim());
  if (!match) return { error: "Use HH:MM:SS:FF, for example 00:00:00:00." };
  const [hours, minutes, seconds, frames] = match.slice(1).map(Number);
  if (hours > 23) return { error: "Hours must be 0 to 23." };
  if (minutes > 59 || seconds > 59) return { error: "Minutes and seconds must be 0 to 59." };
  if (frames >= fps) return { error: `Frames must be 0 to ${fps - 1} at ${fps} fps.` };
  return { frames: ((hours * 60 + minutes) * 60 + seconds) * fps + frames };
}

/** The `HH:MM:SS:FF` text for a frame count, wrapped to 24 hours. */
export function formatOffset(frames: number, fps: TimecodeRate): string {
  const { hours, minutes, seconds, frame } = splitFrames(frames, fps);
  return [hours, minutes, seconds, frame].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Breaks a frame count into clock fields. The count wraps at 24 hours, as the wire format does. */
export function splitFrames(frames: number, fps: TimecodeRate): { hours: number; minutes: number; seconds: number; frame: number } {
  const wrapped = ((Math.floor(frames) % DAY_FRAMES(fps)) + DAY_FRAMES(fps)) % DAY_FRAMES(fps);
  const frame = wrapped % fps,
    totalSeconds = (wrapped - frame) / fps;
  return { hours: Math.floor(totalSeconds / 3600), minutes: Math.floor(totalSeconds / 60) % 60, seconds: totalSeconds % 60, frame };
}

/** The frame count at a song position (seconds) when the song's offset is `offset` frames. Positions before zero read as zero. */
export function framesAt(position: number, offset: number, fps: TimecodeRate): number {
  return offset + Math.floor(Math.max(0, position) * fps + 1e-6);
}

/** The full-frame SysEx for a frame count: F0 7F 7F 01 01 hh mm ss ff F7. */
export function fullFrame(frames: number, fps: TimecodeRate): number[] {
  const { hours, minutes, seconds, frame } = splitFrames(frames, fps);
  return [0xf0, 0x7f, 0x7f, 0x01, 0x01, (rateCode(fps) << 5) | hours, minutes, seconds, frame, 0xf7];
}

/**
 * Quarter frame `index` for a frame count: `F1 nn`, where the piece is `index` modulo 8. The eight pieces of one cycle carry the
 * frame count given, so a cycle is only meaningful with the same count throughout.
 */
export function quarterFrame(index: number, frames: number, fps: TimecodeRate): number[] {
  const piece = ((index % 8) + 8) % 8,
    { hours, minutes, seconds, frame } = splitFrames(frames, fps);
  const data = [
    frame & 15,
    frame >> 4,
    seconds & 15,
    seconds >> 4,
    minutes & 15,
    minutes >> 4,
    hours & 15,
    ((hours >> 4) & 1) | (rateCode(fps) << 1),
  ][piece];
  return [0xf1, (piece << 4) | data];
}

/**
 * The frame count a quarter frame belongs to. Quarter frames are counted from the anchor; each eight-piece cycle is two frames on,
 * so the value follows the song at the MIDI standard's two-frame lag.
 */
export function cycleFrames(index: number, anchorFrames: number): number {
  return anchorFrames + 2 * Math.floor(index / 8);
}

/** The timecode choice the session plays with: whether it is on (saved with the MIDI setup), its rate, and the song's offset text. */
export interface TimecodeSetting {
  enabled: boolean;
  fps: TimecodeRate;
  /** `HH:MM:SS:FF` from the song's options. Empty means 00:00:00:00. */
  offset: string;
}
export const NO_TIMECODE: TimecodeSetting = { enabled: false, fps: DEFAULT_TIMECODE_RATE, offset: "" };

/**
 * The frame count the scheduler starts from, or null when timecode is off. Throws when the offset is not valid at the rate, so a
 * Play with timecode on fails with the reason rather than sending a wrong position.
 */
export function timecodeOffsetFrames(setting: TimecodeSetting): number | null {
  if (!setting.enabled) return null;
  const parsed = parseOffset(setting.offset || "00:00:00:00", setting.fps);
  if ("error" in parsed) throw new Error(`MIDI timecode offset: ${parsed.error}`);
  return parsed.frames;
}
