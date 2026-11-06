import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { BASS_BELOW_SONG_LU, DRUMS_BELOW_SONG_LU, LEVEL_CEILING_DB, levelStatus, loudnessOf, matchLoudness, targetLoudness } from "./level";

const RATE = 44100;

/** A stereo tone of `seconds` at `amplitude`, with both channels the same. A steady tone's loudness is set by its amplitude alone. */
function tone(amplitude: number, seconds = 10, rate = RATE): PcmAudio {
  const frames = Math.round(seconds * rate);
  const channel = new Float32Array(frames);
  for (let i = 0; i < frames; i++) channel[i] = amplitude * Math.sin((2 * Math.PI * 110 * i) / rate);
  return { sampleRate: rate, channels: [channel, channel.slice()] };
}

/** The sample peak of a part, in dB. */
function peakDb(audio: PcmAudio): number {
  let peak = 0;
  for (const channel of audio.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  return 20 * Math.log10(peak);
}

describe("loudnessOf", () => {
  it("is louder for a louder tone, and -Infinity for silence", () => {
    expect(loudnessOf(tone(0.2))).toBeGreaterThan(loudnessOf(tone(0.1)));
    expect(loudnessOf(tone(0))).toBe(-Infinity);
  });
});

describe("matchLoudness", () => {
  it("moves a part to the target within 0.5 LU", () => {
    const part = tone(0.1);
    for (const target of [-20, -26, -30]) {
      const match = matchLoudness(part, { lufs: target });
      expect(Math.abs(loudnessOf(match.audio) - target), `target ${target}`).toBeLessThan(0.5);
      expect(match.limitedByPeak).toBe(false);
    }
  });

  it("reports the gain it applied, and the level after it", () => {
    const part = tone(0.1);
    const before = loudnessOf(part);
    const match = matchLoudness(part, { lufs: before - 6 });
    expect(match.gainDb).toBeCloseTo(-6, 0);
    expect(match.lufs).toBeCloseTo(before - 6, 0);
  });

  it("holds the gain back so the peak stays at or under the ceiling, and says so", () => {
    // A tone with a short loud click: a loud average with a peak almost at full scale, so the gain it needs would clip it.
    const quiet = tone(0.02);
    const spike = quiet.channels.map((channel) => channel.slice());
    spike[0][1000] = 0.9;
    spike[1][1000] = 0.9;
    const part: PcmAudio = { sampleRate: RATE, channels: spike };
    const match = matchLoudness(part, { lufs: -10 });
    expect(match.limitedByPeak).toBe(true);
    expect(peakDb(match.audio)).toBeLessThanOrEqual(LEVEL_CEILING_DB + 0.01);
    expect(match.gainDb).toBeCloseTo(LEVEL_CEILING_DB - peakDb(part), 1);
    expect(match.lufs).toBeLessThan(-10);
  });

  it("uses the ceiling it is given", () => {
    const part = tone(0.1);
    const match = matchLoudness(part, { lufs: -5 }, -6);
    expect(peakDb(match.audio)).toBeLessThanOrEqual(-6 + 0.01);
    expect(match.limitedByPeak).toBe(true);
  });

  it("returns a silent part unchanged, with a gain of 0", () => {
    const silent = tone(0);
    const match = matchLoudness(silent, { lufs: -20 });
    expect(match.gainDb).toBe(0);
    expect(match.limitedByPeak).toBe(false);
    expect(match.lufs).toBe(-Infinity);
  });
});

describe("targetLoudness", () => {
  const song = tone(0.2);
  const songLufs = loudnessOf(song);

  it("uses the original stem's loudness when there is one", () => {
    const stem = tone(0.05);
    expect(targetLoudness("bass", song, stem).lufs).toBeCloseTo(loudnessOf(stem), 6);
  });

  it("uses the song less 7 LU for bass and 4 LU for drums when there is no stem", () => {
    expect(BASS_BELOW_SONG_LU).toBe(7);
    expect(DRUMS_BELOW_SONG_LU).toBe(4);
    expect(targetLoudness("bass", song).lufs).toBeCloseTo(songLufs - 7, 6);
    expect(targetLoudness("drums", song).lufs).toBeCloseTo(songLufs - 4, 6);
  });

  it("ignores a near-silent stem and uses the song", () => {
    const nearSilent = tone(0.00001);
    expect(loudnessOf(nearSilent)).toBeLessThan(-60);
    expect(targetLoudness("drums", song, nearSilent).lufs).toBeCloseTo(songLufs - 4, 6);
  });

  it("takes a song loudness the caller already measured", () => {
    expect(targetLoudness("bass", song, undefined, -20).lufs).toBe(-27);
  });
});

describe("levelStatus", () => {
  it("says both parts, with the first one set", () => {
    expect(levelStatus({ drums: { gainDb: 3, belowSongDb: 4, limitedByPeak: false }, bass: { gainDb: 1, belowSongDb: 7.2, limitedByPeak: false } })).toBe(
      "Drums set 4.0 dB under the song, bass 7.2 dB under.",
    );
  });

  it("names one part alone, and says when the peak held it back", () => {
    expect(levelStatus({ bass: { gainDb: 1, belowSongDb: 7, limitedByPeak: false } })).toBe("Bass set 7.0 dB under the song.");
    expect(levelStatus({ bass: { gainDb: 1, belowSongDb: 9.5, limitedByPeak: true } })).toBe("Bass set 9.5 dB under the song (held back by the peak).");
  });

  it("returns null when no part was matched", () => {
    expect(levelStatus(undefined)).toBeNull();
    expect(levelStatus({})).toBeNull();
  });
});
