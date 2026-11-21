// A built-in room for the generated drums (spec 133). The drums are convolved with a short stereo room impulse response (samples/room/),
// the wet signal is high-passed so the kick does not get muddy, and a share of it is mixed under the dry drums. It runs in the band worker
// after the drums are rendered. Pure: no WebAudio.

import { fft } from "../tonematch/fft";
import type { PcmAudio } from "../types";

/** The wet signal is high-passed here, so the overheads get the room and the kick stays tight. */
export const ROOM_HIGH_PASS_HZ = 150;

/** The FFT block size of the convolution. Each block carries (size - impulse length + 1) new samples. */
const BLOCK_SIZE = 65536;

const nextPowerOfTwo = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Convolves a stereo signal with a stereo impulse response by FFT overlap-add and returns the first `signal` length of the result. The
 * two channels share one complex transform per block (the left as the real part, the right as the imaginary part), and are told apart
 * again by the symmetry of a real signal's spectrum, so a block costs one forward and one inverse transform for both channels.
 */
export function convolveStereo(signal: readonly [Float32Array, Float32Array], impulse: readonly [Float32Array, Float32Array]): [Float32Array, Float32Array] {
  const frames = signal[0].length;
  const outLeft = new Float32Array(frames);
  const outRight = new Float32Array(frames);
  const impulseLength = Math.max(impulse[0].length, impulse[1].length);
  if (frames === 0 || impulseLength === 0) return [outLeft, outRight];
  const size = Math.max(nextPowerOfTwo(impulseLength * 2), Math.min(BLOCK_SIZE, nextPowerOfTwo(frames + impulseLength)));
  const hop = size - impulseLength + 1;

  // The spectra of the two impulse channels, each from its own real transform.
  const hLeftRe = new Float64Array(size);
  const hLeftIm = new Float64Array(size);
  const hRightRe = new Float64Array(size);
  const hRightIm = new Float64Array(size);
  hLeftRe.set(impulse[0]);
  hRightRe.set(impulse[1]);
  fft(hLeftRe, hLeftIm);
  fft(hRightRe, hRightIm);

  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let start = 0; start < frames; start += hop) {
    const count = Math.min(hop, frames - start);
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < count; i++) {
      re[i] = signal[0][start + i];
      im[i] = signal[1][start + i];
    }
    fft(re, im);
    // Split the combined spectrum into the left's (X) and the right's (Z), multiply each by its impulse spectrum, and put them back
    // together as Y = YL + j YR.
    for (let k = 0; k <= size / 2; k++) {
      const m = (size - k) % size;
      const xRe = (re[k] + re[m]) / 2;
      const xIm = (im[k] - im[m]) / 2;
      const zRe = (im[k] + im[m]) / 2;
      const zIm = (re[m] - re[k]) / 2;
      const ylRe = xRe * hLeftRe[k] - xIm * hLeftIm[k];
      const ylIm = xRe * hLeftIm[k] + xIm * hLeftRe[k];
      const yrRe = zRe * hRightRe[k] - zIm * hRightIm[k];
      const yrIm = zRe * hRightIm[k] + zIm * hRightRe[k];
      re[k] = ylRe - yrIm;
      im[k] = ylIm + yrRe;
      if (m !== k) {
        // The mirror bin: the left's and right's spectra are conjugates there.
        re[m] = ylRe + yrIm;
        im[m] = -ylIm + yrRe;
      }
    }
    fft(re, im, true);
    const length = Math.min(count + impulseLength - 1, frames - start);
    for (let i = 0; i < length; i++) {
      outLeft[start + i] += re[i];
      outRight[start + i] += im[i];
    }
  }
  return [outLeft, outRight];
}

/** A one-pole high-pass, in place. */
function highPass(channel: Float32Array, hz: number, sampleRate: number): void {
  const a = 1 / (1 + (2 * Math.PI * hz) / sampleRate);
  let previousIn = 0;
  let previousOut = 0;
  for (let i = 0; i < channel.length; i++) {
    const input = channel[i];
    previousOut = a * (previousOut + input - previousIn);
    previousIn = input;
    channel[i] = previousOut;
  }
}

/**
 * The drums with the room mixed under them: the dry signal plus `amount` of the high-passed convolution. Returns the audio as it is at
 * amount 0 or with no impulse. A mono impulse is used for both channels, and a mono part is treated as a stereo part with equal channels.
 */
export function addRoom(drums: PcmAudio, room: PcmAudio | undefined, amount: number): PcmAudio {
  if (!room || amount <= 0 || room.channels.length === 0) return drums;
  const left = drums.channels[0];
  const right = drums.channels[1] ?? left;
  const impulse: [Float32Array, Float32Array] = [room.channels[0], room.channels[1] ?? room.channels[0]];
  const [wetLeft, wetRight] = convolveStereo([left, right], impulse);
  highPass(wetLeft, ROOM_HIGH_PASS_HZ, drums.sampleRate);
  highPass(wetRight, ROOM_HIGH_PASS_HZ, drums.sampleRate);
  const outLeft = new Float32Array(left.length);
  const outRight = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) {
    outLeft[i] = left[i] + amount * wetLeft[i];
    outRight[i] = right[i] + amount * wetRight[i];
  }
  return { sampleRate: drums.sampleRate, channels: [outLeft, outRight] };
}
