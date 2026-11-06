// Integrated loudness of a song, as ITU-R BS.1770 defines it (pure). The signal is K-weighted (a high shelf, then a high-pass), cut into
// 400 ms blocks that overlap by 75%, and gated twice: first at -70 LUFS, then at 10 LU below the level of what is left. The average of the
// blocks that survive is the song's loudness. A song that is quiet on average is raised to the target by `normalisingGain`.

/** The loudness a song is normalised to, in LUFS */
export const TARGET_LUFS = -14;
/** The largest gain normalisation may apply: +6 dB. A quieter song stays quiet rather than clipping its loud parts. */
export const NORMALISE_GAIN_MAX = 2;

const BLOCK_S = 0.4;
const STEP_S = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

/** One second-order filter section, with its a0 already divided out. */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The K-weighting's high shelf for `sampleRate` (BS.1770, from its analogue prototype) */
export function shelfFilter(sampleRate: number): Biquad {
  const f0 = 1681.974450955533,
    gain = 3.999843853973347,
    q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = 10 ** (gain / 20),
    vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** The K-weighting's high-pass (RLB) for `sampleRate`. Its numerator is the standard's unscaled [1, -2, 1]. */
export function highPassFilter(sampleRate: number): Biquad {
  const f0 = 38.13547087602444,
    q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

/** The samples after one filter section (direct form I). */
function applyBiquad(x: ArrayLike<number>, c: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const value = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = value;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = value;
  }
  return y;
}

/**
 * The integrated loudness of planar audio, in LUFS. Silence, and audio too quiet to pass the gates, is -Infinity. The channels are
 * weighted equally, which is the BS.1770 weighting for mono and stereo.
 */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const shelf = shelfFilter(sampleRate),
    highPass = highPassFilter(sampleRate);
  const frames = channels[0]?.length ?? 0;
  // Running sums of the squared, weighted samples, so each block's mean square is two lookups.
  const sums = new Float64Array(frames + 1);
  for (const channel of channels) {
    const weighted = applyBiquad(applyBiquad(channel, shelf), highPass);
    for (let i = 0; i < frames; i++) sums[i + 1] += weighted[i] * weighted[i];
  }
  // A running total is kept as a prefix sum: sums[i] becomes the sum of the squares up to sample i.
  for (let i = 1; i <= frames; i++) sums[i] += sums[i - 1];
  const block = Math.round(BLOCK_S * sampleRate),
    step = Math.round(STEP_S * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= frames; start += step) powers.push((sums[start + block] - sums[start]) / block);
  const loudnessOf = (power: number) => -0.691 + 10 * Math.log10(power);
  const aboveAbsolute = powers.filter((power) => loudnessOf(power) > ABSOLUTE_GATE_LUFS);
  if (!aboveAbsolute.length) return -Infinity;
  const relative = loudnessOf(aboveAbsolute.reduce((total, power) => total + power, 0) / aboveAbsolute.length) + RELATIVE_GATE_LU;
  const kept = aboveAbsolute.filter((power) => loudnessOf(power) > relative);
  if (!kept.length) return -Infinity;
  return loudnessOf(kept.reduce((total, power) => total + power, 0) / kept.length);
}

/** The sample peak of planar audio, in dBFS (-Infinity for silence). It is taken from the same samples the loudness is measured on. */
export function samplePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  }
  return 20 * Math.log10(peak);
}

/** A song's measured level: its integrated loudness and its sample peak, both from the same mix. */
export interface SongMeasure {
  lufs: number;
  peakDb: number;
}

/** Measures a song's loudness and sample peak in one pass over its channels. */
export function measureSong(channels: Float32Array[], sampleRate: number): SongMeasure {
  return { lufs: integratedLoudness(channels, sampleRate), peakDb: samplePeakDb(channels) };
}

/** The highest level a normalised song may peak at, in dBFS. A little below full scale, so the output never clips. */
export const PEAK_CEILING_DBFS = -1;
const NORMALISE_GAIN_MAX_DB = 20 * Math.log10(NORMALISE_GAIN_MAX);

/**
 * The gain, in dB, that brings a song measured at `lufs` to `target`. It is the smallest of the distance to the target, the +6 dB limit
 * and the headroom left below the peak ceiling. `limitedByPeak` says whether the peak set it. A song whose peak is not measured yet (null)
 * is not limited by one. Silence is left alone (gain 0 dB).
 */
export function normalisingGainDb(lufs: number, peakDb: number | null, target = TARGET_LUFS): { gainDb: number; limitedByPeak: boolean } {
  if (!Number.isFinite(lufs)) return { gainDb: 0, limitedByPeak: false };
  const toTarget = Math.min(target - lufs, NORMALISE_GAIN_MAX_DB);
  const toPeak = peakDb === null || !Number.isFinite(peakDb) ? Infinity : PEAK_CEILING_DBFS - peakDb;
  return { gainDb: Math.min(toTarget, toPeak), limitedByPeak: toPeak < toTarget };
}

/** The linear gain that brings a song measured at `lufs` to `target`, kept within the normalisation limits (see normalisingGainDb). */
export function normalisingGain(lufs: number, peakDb: number | null = null, target = TARGET_LUFS): number {
  return 10 ** (normalisingGainDb(lufs, peakDb, target).gainDb / 20);
}

/** A song's stored loudness: its measured level and peak, once measured, and whether it is normalised. */
export interface SongLoudness {
  /** The measured integrated loudness, or null before it has been measured */
  lufs: number | null;
  /** The measured sample peak in dBFS, or null before it has been measured (songs measured by earlier versions have none) */
  peakDb: number | null;
  normalise: boolean;
}

/** The loudness a song's options hold. A missing or broken entry reads as not measured and not normalised. */
export function loudnessFromOptions(json: string): SongLoudness {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    const options = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      lufs: typeof options.songLufs === "number" && Number.isFinite(options.songLufs) ? options.songLufs : null,
      peakDb: typeof options.songPeakDb === "number" && Number.isFinite(options.songPeakDb) ? options.songPeakDb : null,
      normalise: options.normaliseSong === true,
    };
  } catch {
    return { lufs: null, peakDb: null, normalise: false };
  }
}

/** The line under the loudness control: the measured level, the gain applied and whether the peak limited it. */
export function loudnessStatus(loudness: SongLoudness): string {
  if (loudness.lufs === null) return "Not measured yet";
  const { gainDb, limitedByPeak } = normalisingGainDb(loudness.lufs, loudness.peakDb);
  const measured = `Measured ${loudness.lufs.toFixed(1)} LUFS, gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`;
  if (loudness.peakDb === null) return `${measured} (peak not measured: turn normalising off and on to measure it)`;
  return limitedByPeak ? `${measured} (limited by the peak)` : measured;
}

/** The options JSON with a song's loudness written in. Everything else in the options is kept as it is. */
export function withLoudness(json: string, loudness: SongLoudness): string {
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) options = parsed as Record<string, unknown>;
  } catch {
    // A damaged options entry is replaced by the loudness alone.
  }
  return JSON.stringify({
    ...options,
    songLufs: loudness.lufs ?? undefined,
    songPeakDb: loudness.peakDb ?? undefined,
    normaliseSong: loudness.normalise,
  });
}
