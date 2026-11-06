// Gentle clean-up of the 16 kHz vocals before they reach the transcriber. Pure, so it is tested without audio hardware.

/**
 * A second-order high-pass (RBJ cookbook, Q 0.707). It removes rumble and the low end of the mix's bleed that
 * the transcriber can mistake for sound. Returns a new array.
 */
export function highPass(samples: Float32Array, sampleRate: number, cutoff = 80): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  const b0 = (1 + cos) / 2 / a0;
  const b1 = -(1 + cos) / a0;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Scales the loudest sample to `targetDb` dBFS. Silence comes back unchanged. Returns a new array. */
export function normalisePeak(samples: Float32Array, targetDb = -1): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return new Float32Array(samples);
  const gain = 10 ** (targetDb / 20) / peak;
  return samples.map((sample) => sample * gain);
}
