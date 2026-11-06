import { describe, expect, it } from "vitest";
import {
  integratedLoudness,
  loudnessFromOptions,
  loudnessStatus,
  measureSong,
  normalisingGain,
  normalisingGainDb,
  NORMALISE_GAIN_MAX,
  samplePeakDb,
  withLoudness,
} from "./loudness";

const RATE = 44100;

/** A stereo sine of `seconds` at `amplitude` and 1 kHz. */
function sine(amplitude: number, seconds: number): Float32Array[] {
  const frames = Math.round(seconds * RATE);
  const channel = Float32Array.from({ length: frames }, (_, i) => amplitude * Math.sin((2 * Math.PI * 1000 * i) / RATE));
  return [channel, channel.slice()];
}

describe("integrated loudness", () => {
  it("measures a 1 kHz sine at the level BS.1770 gives it", () => {
    // A stereo sine at amplitude A has a mean square of A² / 2 per channel, so -0.691 + 10·log10(A²) before weighting. The K-weighting
    // adds about 0.7 dB at 1 kHz, which puts -20 dB of amplitude at -20 LUFS.
    expect(integratedLoudness(sine(0.1, 10), RATE)).toBeCloseTo(-20, 1);
  });

  it("rises by 6 dB when the amplitude doubles", () => {
    const quiet = integratedLoudness(sine(0.05, 10), RATE);
    const loud = integratedLoudness(sine(0.1, 10), RATE);
    expect(loud - quiet).toBeCloseTo(6.02, 1);
  });

  it("is -Infinity for silence", () => {
    expect(integratedLoudness([new Float32Array(RATE * 2), new Float32Array(RATE * 2)], RATE)).toBe(-Infinity);
  });

  it("leaves out quiet passages, so a quiet tail does not pull the level down", () => {
    const loud = sine(0.1, 5);
    const quiet = sine(0.00001, 5);
    const joined = [Float32Array.from([...loud[0], ...quiet[0]]), Float32Array.from([...loud[1], ...quiet[1]])];
    // The block that straddles the join is loud enough to pass the gates, so the level moves by a fraction of a decibel, not more.
    expect(Math.abs(integratedLoudness(joined, RATE) - integratedLoudness(loud, RATE))).toBeLessThan(0.2);
  });

  it("gives the same answer however the channels are split between mono and stereo of the same signal", () => {
    const [left] = sine(0.1, 4);
    expect(integratedLoudness([left], RATE)).toBeCloseTo(integratedLoudness([left, left.slice()], RATE) - 3.01, 1);
  });
});

describe("measuring a song", () => {
  it("returns the loudness and the sample peak of the same channels", () => {
    // A sine of amplitude 0.1 has a sample peak of -20 dBFS, and the loudness test above puts it at -20 LUFS.
    const measure = measureSong(sine(0.1, 10), RATE);
    expect(measure.lufs).toBeCloseTo(-20, 1);
    expect(measure.peakDb).toBeCloseTo(-20, 2);
  });

  it("takes the peak across every channel", () => {
    expect(samplePeakDb([new Float32Array([0.1, -0.5]), new Float32Array([0.25])])).toBeCloseTo(20 * Math.log10(0.5), 5);
  });

  it("has a peak of -Infinity for silence", () => {
    expect(samplePeakDb([new Float32Array(4)])).toBe(-Infinity);
  });
});

describe("normalising gain", () => {
  it("is 1 for a song already at the target", () => {
    expect(normalisingGain(-14)).toBeCloseTo(1, 10);
  });

  it("raises a quiet song to the target", () => {
    expect(normalisingGain(-20)).toBeCloseTo(10 ** (6 / 20), 10);
  });

  it("lowers a loud song to the target", () => {
    expect(normalisingGain(-8)).toBeCloseTo(10 ** (-6 / 20), 10);
  });

  it("never raises a song by more than the limit, and leaves silence alone", () => {
    expect(normalisingGain(-40)).toBeCloseTo(NORMALISE_GAIN_MAX, 10);
    expect(normalisingGain(-Infinity)).toBe(1);
  });

  it("is limited by the peak, so the song peaks at -1 dBFS", () => {
    // -19.8 LUFS would take +5.8 dB, but a -3 dBFS peak has only 2 dB of headroom below -1 dBFS.
    expect(normalisingGainDb(-19.8, -3)).toEqual({ gainDb: 2, limitedByPeak: true });
    expect(normalisingGain(-19.8, -3)).toBeCloseTo(10 ** (2 / 20), 10);
  });

  it("is limited by the loudness target when the peak leaves more headroom", () => {
    expect(normalisingGainDb(-19.8, -10).limitedByPeak).toBe(false);
    expect(normalisingGainDb(-19.8, -10).gainDb).toBeCloseTo(5.8, 10);
  });

  it("is still limited to +6 dB when the peak leaves more headroom than that", () => {
    // -25 LUFS would take +11 dB, but the +6 dB limit applies, and the peak has 9 dB of headroom.
    expect(normalisingGainDb(-25, -10)).toEqual({ gainDb: 20 * Math.log10(NORMALISE_GAIN_MAX), limitedByPeak: false });
  });

  it("leaves a loud song's negative gain as it is when its peak is well below -1 dBFS", () => {
    expect(normalisingGainDb(-8, -6)).toEqual({ gainDb: -6, limitedByPeak: false });
  });

  it("pulls a loud song down further when its peak is above the ceiling", () => {
    // -10 LUFS would take -4 dB, but a +4 dBFS peak only allows -5 dB to bring it to -1 dBFS.
    expect(normalisingGainDb(-10, 4)).toEqual({ gainDb: -5, limitedByPeak: true });
  });

  it("is not limited by a peak that has not been measured", () => {
    expect(normalisingGainDb(-19.8, null).gainDb).toBeCloseTo(5.8, 10);
    expect(normalisingGainDb(-19.8, null).limitedByPeak).toBe(false);
  });
});

describe("a song's stored loudness", () => {
  it("reads a measured level and peak, and whether the song is normalised", () => {
    expect(loudnessFromOptions('{"songLufs":-17.5,"songPeakDb":-2,"normaliseSong":true,"shift":2}')).toEqual({
      lufs: -17.5,
      peakDb: -2,
      normalise: true,
    });
  });

  it("reads a song measured before the peak was stored as having no peak", () => {
    expect(loudnessFromOptions('{"songLufs":-17.5,"normaliseSong":true}')).toEqual({ lufs: -17.5, peakDb: null, normalise: true });
  });

  it("reads a song that has not been measured as not measured, and not normalised", () => {
    expect(loudnessFromOptions("")).toEqual({ lufs: null, peakDb: null, normalise: false });
    expect(loudnessFromOptions("{broken")).toEqual({ lufs: null, peakDb: null, normalise: false });
    expect(loudnessFromOptions('{"songLufs":"loud","songPeakDb":"quiet"}')).toEqual({ lufs: null, peakDb: null, normalise: false });
  });

  it("writes the loudness and peak in and keeps the rest of the options", () => {
    const written = JSON.parse(withLoudness('{"shift":2,"songLufs":-30}', { lufs: -16, peakDb: -3, normalise: true }));
    expect(written).toEqual({ shift: 2, songLufs: -16, songPeakDb: -3, normaliseSong: true });
    expect(JSON.parse(withLoudness('{"songLufs":-16,"normaliseSong":true}', { lufs: null, peakDb: null, normalise: false }))).toEqual({
      normaliseSong: false,
    });
  });
});

describe("the loudness status line", () => {
  it("says the song is not measured yet", () => {
    expect(loudnessStatus({ lufs: null, peakDb: null, normalise: false })).toBe("Not measured yet");
  });

  it("says when the peak limited the gain", () => {
    expect(loudnessStatus({ lufs: -19.8, peakDb: -3, normalise: true })).toBe("Measured -19.8 LUFS, gain +2.0 dB (limited by the peak)");
  });

  it("gives the gain alone when the loudness target set it", () => {
    expect(loudnessStatus({ lufs: -20, peakDb: -10, normalise: true })).toBe("Measured -20.0 LUFS, gain +6.0 dB");
  });

  it("says a negative gain without a peak note", () => {
    expect(loudnessStatus({ lufs: -8, peakDb: -6, normalise: true })).toBe("Measured -8.0 LUFS, gain -6.0 dB");
  });

  it("asks for a measurement when the peak was never stored", () => {
    expect(loudnessStatus({ lufs: -19.8, peakDb: null, normalise: true })).toBe(
      "Measured -19.8 LUFS, gain +5.8 dB (peak not measured: turn normalising off and on to measure it)",
    );
  });
});
