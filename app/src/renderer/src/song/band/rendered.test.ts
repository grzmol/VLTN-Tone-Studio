import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { checkRenderedLength, firstOnsetSeconds, fitToLength, lineUpLabel, lineUpOffer, shiftAudio } from "./rendered";

const RATE = 44100;

function mono(seconds: number, fill = 0): PcmAudio {
  return { sampleRate: RATE, channels: [new Float32Array(Math.round(seconds * RATE)).fill(fill)] };
}

/** Silence, then 60 ms tone bursts at each of `times` (seconds), stereo. */
function hits(seconds: number, times: number[]): PcmAudio {
  const frames = Math.round(seconds * RATE);
  const channel = new Float32Array(frames);
  for (const time of times) {
    const start = Math.round(time * RATE);
    for (let i = 0; i < Math.round(0.06 * RATE) && start + i < frames; i++) {
      channel[start + i] = 0.8 * Math.sin((2 * Math.PI * 220 * i) / RATE) * Math.exp(-i / (0.02 * RATE));
    }
  }
  return { sampleRate: RATE, channels: [channel, channel.slice()] };
}

describe("checkRenderedLength", () => {
  it("uses a file within half a second of the song silently", () => {
    expect(checkRenderedLength("drums.wav", 180.4, 180)).toEqual({ accepted: true, notice: null });
  });

  it("pads a file that is 0.5 to 5 s shorter, with a notice", () => {
    expect(checkRenderedLength("drums.wav", 177, 180)).toEqual({
      accepted: true,
      notice: "drums.wav is 3.0 s shorter than the song. It was padded with silence.",
    });
  });

  it("cuts a file that is 0.5 to 5 s longer, with a notice", () => {
    expect(checkRenderedLength("bass.wav", 182, 180)).toEqual({
      accepted: true,
      notice: "bass.wav is 2.0 s longer than the song. It was cut to the song's length.",
    });
  });

  it("refuses a file more than 5 s away from the song", () => {
    const check = checkRenderedLength("bass.wav", 186, 180);
    expect(check.accepted).toBe(false);
    expect(check.notice).toContain("over 5 s");
  });
});

describe("fitToLength and shiftAudio", () => {
  it("makes a mono file stereo and fits it to the song's length, padding or cutting the end", () => {
    const short = fitToLength(mono(1, 0.5), 2 * RATE);
    expect(short.channels).toHaveLength(2);
    expect(short.channels.map((c) => c.length)).toEqual([2 * RATE, 2 * RATE]);
    expect(short.channels[1][RATE - 10]).toBe(0.5);
    expect(short.channels[0][RATE * 1.5]).toBe(0);
    const long = fitToLength(mono(3, 0.5), RATE);
    expect(long.channels[0].length).toBe(RATE);
  });

  it("delays audio by padding its start, and advances it by cutting the start, keeping the length", () => {
    const impulse = mono(1);
    impulse.channels[0][0] = 1;
    const later = shiftAudio(impulse, 0.5, RATE);
    expect(later.channels[0][0]).toBe(0);
    expect(later.channels[0][Math.round(0.5 * RATE)]).toBe(1);
    expect(later.channels[0].length).toBe(RATE);

    const marked = mono(1);
    marked.channels[0][Math.round(0.5 * RATE)] = 1;
    const earlier = shiftAudio(marked, -0.5, RATE);
    expect(earlier.channels[0][0]).toBe(1);
    expect(earlier.channels[0].length).toBe(RATE);
  });
});

describe("firstOnsetSeconds", () => {
  it("finds the first hit after leading silence, to within 20 ms", () => {
    const onset = firstOnsetSeconds(hits(4, [0.8, 1.3, 1.8]));
    expect(onset).not.toBeNull();
    expect(Math.abs((onset ?? 0) - 0.8)).toBeLessThan(0.02);
  });

  it("is null for a file with no hit", () => {
    expect(firstOnsetSeconds(mono(3))).toBeNull();
  });
});

describe("lineUpOffer", () => {
  it("offers nothing within 20 ms of the first note", () => {
    expect(lineUpOffer(0.515, 0.5)?.offer).toBe(false);
    expect(lineUpOffer(0.49, 0.5)?.offer).toBe(false);
  });

  it("offers to move a late file earlier, by the gap", () => {
    const offer = lineUpOffer(0.8, 0.5);
    expect(offer?.offer).toBe(true);
    expect(offer?.shiftSeconds).toBeCloseTo(-0.3, 6);
    expect(offer?.text).toBe("The first hit is 300 ms after the first note.");
    expect(lineUpLabel(offer?.shiftSeconds ?? 0)).toBe("Line up with the first note (moves it 300 ms earlier)");
  });

  it("offers to move an early file later", () => {
    const offer = lineUpOffer(0.4, 0.5);
    expect(offer?.offer).toBe(true);
    expect(lineUpLabel(offer?.shiftSeconds ?? 0)).toBe("Line up with the first note (moves it 100 ms later)");
  });

  it("never offers a shift above 10 s, and does not look for one", () => {
    const offer = lineUpOffer(12.5, 0.5);
    expect(offer?.offer).toBe(false);
    expect(offer?.text).toContain("too far to line up");
  });

  it("is null when either time is unknown, such as a part that was never generated", () => {
    expect(lineUpOffer(null, 0.5)).toBeNull();
    expect(lineUpOffer(0.8, null)).toBeNull();
  });
});
