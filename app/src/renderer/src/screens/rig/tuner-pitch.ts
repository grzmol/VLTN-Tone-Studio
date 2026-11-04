// Chromatic tuner maths: pitch of a mono buffer (YIN) and the nearest note. The audio plumbing lives in Tuner.tsx.

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
/** Drop-tuned guitars and the top of a 24th fret are in; a 5-string bass's low B (31 Hz) is out. */
const MIN_HZ = 60;
const MAX_HZ = 1300;
/** YIN threshold: lower is stricter (fewer octave errors, more "no pitch"). */
const THRESHOLD = 0.15;
const MIN_RMS = 0.008;

/** Fundamental in Hz, or null for silence / noise. `buf` should hold at least 2 periods of MIN_HZ (4096 at 48 kHz). */
export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  let sum = 0;
  for (const v of buf) sum += v * v;
  if (Math.sqrt(sum / buf.length) < MIN_RMS) return null;

  const minTau = Math.floor(sampleRate / MAX_HZ);
  const maxTau = Math.min(Math.floor(sampleRate / MIN_HZ), buf.length >> 1);
  const w = buf.length - maxTau;
  // cumulative mean normalised difference
  const cmnd = new Float32Array(maxTau + 1);
  let running = 0;
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let d = 0;
    for (let j = 0; j < w; j++) {
      const x = buf[j] - buf[j + tau];
      d += x * x;
    }
    running += d;
    cmnd[tau] = running ? (d * tau) / running : 1;
  }
  for (let tau = minTau; tau < maxTau; tau++) {
    if (cmnd[tau] >= THRESHOLD) continue;
    while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
    // parabolic interpolation around the minimum
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const shift = a - 2 * b + c ? (a - c) / (2 * (a - 2 * b + c)) : 0;
    return sampleRate / (tau + shift);
  }
  return null;
}

export interface Note {
  /** "A4", "F♯2" */
  name: string;
  /** -50…+50 from the nearest note, positive = sharp */
  cents: number;
}

export function noteOf(hz: number, a4 = 440): Note {
  const midi = 69 + 12 * Math.log2(hz / a4);
  const n = Math.round(midi);
  return { name: `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`, cents: Math.round((midi - n) * 100) };
}
