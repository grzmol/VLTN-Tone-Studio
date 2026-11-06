// Rendered parts (spec 84): a drum or bass part that the performer bounced from their own DAW, from the exported MIDI, and brought back
// as audio. Pure: the length rules, the first onset of the file, and the offer to line the file up with the first generated note. The
// Band panel decodes the file and applies the result. The length rules are the multitrack import's (tracks.ts), so a rendered part is
// checked the way an imported track is.

import { alignChannels, stereoOf } from "../import/align";
import { LENGTH_REJECT_S, lengthVerdict } from "../tracks";
import type { PcmAudio } from "../types";
import { onsetStrength } from "./beat-grid";

/** A first onset this close to the first note counts as lined up, and nothing is offered. */
export const LINE_UP_MIN_S = 0.02;
/** A first onset further than this from the first note is too far to be a pre-roll, so nothing is offered. */
export const LINE_UP_MAX_S = 10;
/** Seconds from the start of the file that are searched for its first onset. */
export const ONSET_SCAN_S = 20;
/** The fraction of the scanned onset peak that counts as a hit. */
const ONSET_THRESHOLD = 0.2;

export interface LengthCheck {
  /** False when the file is too far from the song's length to be used. */
  accepted: boolean;
  /** What the panel tells the user, or null when the length was within the tolerance and nothing needs saying. */
  notice: string | null;
}

/**
 * The multitrack import's length rule for a rendered part: within 0.5 s is used silently, 0.5 to 5 s is padded or cut with a notice, and
 * further than 5 s is refused.
 */
export function checkRenderedLength(name: string, seconds: number, songSeconds: number): LengthCheck {
  const verdict = lengthVerdict(seconds, songSeconds);
  const difference = seconds - songSeconds;
  const gap = Math.abs(difference).toFixed(1);
  if (verdict === "ok") return { accepted: true, notice: null };
  if (verdict === "reject")
    return { accepted: false, notice: `${name} is ${gap} s away from the song's length (over ${LENGTH_REJECT_S} s), so it was not used.` };
  if (difference < 0) return { accepted: true, notice: `${name} is ${gap} s shorter than the song. It was padded with silence.` };
  return { accepted: true, notice: `${name} is ${gap} s longer than the song. It was cut to the song's length.` };
}

/** The audio as stereo at exactly `frames` frames: a mono file is copied to both channels, and the end is padded or cut. */
export function fitToLength(audio: PcmAudio, frames: number): PcmAudio {
  return { sampleRate: audio.sampleRate, channels: alignChannels(stereoOf(audio.channels), frames) };
}

/**
 * The audio moved by `seconds` and fitted to `frames`. A positive shift delays it, which pads silence at the start; a negative shift
 * advances it, which cuts the start. Nothing else changes.
 */
export function shiftAudio(audio: PcmAudio, seconds: number, frames: number): PcmAudio {
  const offset = Math.round(seconds * audio.sampleRate);
  const channels = stereoOf(audio.channels).map((channel) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const source = i - offset;
      if (source >= 0 && source < channel.length) out[i] = channel[source];
    }
    return out;
  });
  return { sampleRate: audio.sampleRate, channels };
}

/**
 * The time of the file's first hit, in seconds, from the first ONSET_SCAN_S of it. A hit is the first frame whose onset strength reaches
 * a fraction of the strongest frame in the scan, so a quiet pre-roll does not count. Null when the scan has no hit at all.
 */
export function firstOnsetSeconds(audio: PcmAudio): number | null {
  const scanFrames = Math.min(audio.channels[0].length, Math.round(ONSET_SCAN_S * audio.sampleRate));
  const head = stereoOf(audio.channels).map((channel) => channel.subarray(0, scanFrames));
  const { onset, frameRate } = onsetStrength([{ sampleRate: audio.sampleRate, channels: head }], audio.sampleRate);
  let peak = 0;
  for (const value of onset) peak = Math.max(peak, value);
  if (!(peak > 0)) return null;
  const threshold = ONSET_THRESHOLD * peak;
  for (let frame = 0; frame < onset.length; frame++) if (onset[frame] >= threshold) return frame / frameRate;
  return null;
}

export interface LineUp {
  /** The shift that puts the file's first hit on the first note, in seconds: negative moves the file earlier. */
  shiftSeconds: number;
  /** True when the panel should offer the shift. Never offered silently. */
  offer: boolean;
  /** What the panel says about the gap between the file's first hit and the first note. */
  text: string;
}

/**
 * Compares the file's first hit with the part's first generated note. Null when either is unknown, such as a part that was never
 * generated, so there is nothing to line up with.
 */
export function lineUpOffer(onsetSeconds: number | null, noteSeconds: number | null): LineUp | null {
  if (onsetSeconds === null || noteSeconds === null) return null;
  const shiftSeconds = noteSeconds - onsetSeconds;
  const gap = Math.abs(shiftSeconds);
  if (gap <= LINE_UP_MIN_S) return { shiftSeconds: 0, offer: false, text: "The first hit lines up with the first note." };
  if (gap > LINE_UP_MAX_S) {
    return { shiftSeconds, offer: false, text: `The first hit is ${Math.round(gap)} s from the first note, too far to line up. The file is used as it is.` };
  }
  const ms = Math.round(gap * 1000);
  const when = shiftSeconds < 0 ? "after" : "before";
  return { shiftSeconds, offer: true, text: `The first hit is ${ms} ms ${when} the first note.` };
}

/** The button's label for a line-up: how far the file moves, and which way. */
export function lineUpLabel(shiftSeconds: number): string {
  const ms = Math.round(Math.abs(shiftSeconds) * 1000);
  return `Line up with the first note (moves it ${ms} ms ${shiftSeconds < 0 ? "earlier" : "later"})`;
}
