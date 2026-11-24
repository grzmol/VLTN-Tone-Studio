import type { PcmAudio, Stems } from "../types";
import { bandAudioId } from "./dependencies";

/** How long the end of the song is, in seconds, when asking whether it fades. */
const TAIL_SECONDS = 2;
/** The end is a fade when it is this many dB below the whole song. */
const FADE_DB = 20;

/**
 * The original audio that keeps playing under the generated band: every stem but the drums and bass, which the band replaces, or the
 * source mix when the song has no other stem.
 */
export function keptOriginals(stems: Stems | null, mix: PcmAudio | undefined): PcmAudio[] {
  const others = Object.entries(stems ?? {}).flatMap(([name, audio]) => (name === "drums" || name === "bass" || !audio ? [] : [audio]));
  return others.length > 0 ? others : mix ? [mix] : [];
}

/** Sum of the squared mixed sample over the frames [from, to). Reads the channels in place; nothing is copied. */
function mixedEnergy(audios: readonly PcmAudio[], from: number, to: number): number {
  let energy = 0;
  for (let frame = from; frame < to; frame++) {
    let mixed = 0;
    for (const audio of audios) {
      const channels = audio.channels;
      let sum = 0;
      for (const channel of channels) sum += channel[frame] ?? 0;
      mixed += channels.length > 0 ? sum / channels.length : 0;
    }
    energy += mixed * mixed;
  }
  return energy;
}

/**
 * Whether the mix of these tracks fades out: its last two seconds are more than 20 dB quieter (RMS) than the whole song. Silence and
 * audio shorter than twice the tail do not count as fading.
 */
export function fadesOut(audios: readonly PcmAudio[]): boolean {
  const first = audios[0];
  if (!first) return false;
  const frames = Math.max(...audios.map((audio) => audio.channels[0]?.length ?? 0));
  const tail = Math.round(TAIL_SECONDS * first.sampleRate);
  if (frames < tail * 2) return false;
  const whole = mixedEnergy(audios, 0, frames) / frames;
  if (whole <= 0) return false;
  const end = mixedEnergy(audios, frames - tail, frames) / tail;
  return 10 * Math.log10(end / whole) < -FADE_DB;
}

let last: { key: string; result: boolean } | null = null;

/** fadesOut, remembered for the same audio objects, so a render does not read the whole song again. */
export function fadesOutCached(audios: readonly PcmAudio[]): boolean {
  const key = audios.map(bandAudioId).join(",");
  if (last?.key === key) return last.result;
  const result = fadesOut(audios);
  last = { key, result };
  return result;
}
