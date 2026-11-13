import { describe, expect, it } from "vitest";
import { DRUM_PAN, PEAK_LIMIT, panGains, renderPart, sampleAttack } from "./render";
import { CLOSED_HAT, KICK, OPEN_HAT, SNARE, type NoteEvent } from "./note";
import { pickDrumSample, type BassSample, type DrumLayer, type SampleSet } from "./samples";
import type { PcmAudio } from "../types";

const RATE = 44100;
const CENTRE = panGains(0)[0];

const hit = (time: number, pitch: number, velocity = 100, duration = 0.1): NoteEvent => ({ time, pitch, velocity, duration });

/** One sample frame at `amplitude`, then silence. */
const impulse = (amplitude = 1, length = 64): PcmAudio => {
  const channel = new Float32Array(length);
  channel[0] = amplitude;
  return { sampleRate: RATE, channels: [channel] };
};

const constant = (value: number, length: number): PcmAudio => ({ sampleRate: RATE, channels: [new Float32Array(length).fill(value)] });

const sine = (hz: number, seconds: number): PcmAudio => {
  const channel = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < channel.length; i++) channel[i] = Math.sin((2 * Math.PI * hz * i) / RATE);
  return { sampleRate: RATE, channels: [channel] };
};

const layer = (audio: PcmAudio, velocity: [number, number] = [1, 127], nominal = 100, transpose = 0): DrumLayer => ({ velocity, nominal, transpose, takes: [audio] });

const bass = (root: number, audio: PcmAudio): BassSample => ({ root, layer: "p", velocity: [1, 127], audio });

function kit(drums: Partial<Record<number, DrumLayer[]>>, basses: BassSample[] = []): SampleSet {
  return { drums: new Map(Object.entries(drums).map(([pitch, layers]) => [Number(pitch), layers ?? []])), bass: basses };
}

function peak(channel: Float32Array): number {
  let max = 0;
  for (let i = 0; i < channel.length; i++) max = Math.max(max, Math.abs(channel[i]));
  return max;
}

/** How many times the signal crosses zero in [from, to). A sine at f Hz crosses 2f times a second. */
function crossings(channel: Float32Array, from: number, to: number): number {
  let count = 0;
  for (let i = from + 1; i < to; i++) if (channel[i - 1] < 0 !== channel[i] < 0) count++;
  return count;
}

describe("renderPart: drums", () => {
  // A sample's attack is not its first frame: a kick may be silent for 5 ms. The voice starts early by that, so the attack (the half-peak of
  // a short envelope, the same measure the beat grid uses on the original drums) lands on the note's time and not 5 ms after it.
  it("renders a hit with its attack on the note's time, to within one sample", () => {
    const attackAt = Math.round(0.005 * RATE);
    const slow = new Float32Array(attackAt + 400).fill(0);
    slow.fill(0.8, attackAt);
    const audio = { sampleRate: RATE, channels: [slow] };
    expect(sampleAttack(audio)).toBe(attackAt);
    const rendered = renderPart([hit(0.5, KICK)], "drums", kit({ [KICK]: [layer(audio)] }), RATE * 2).audio;
    const around = { sampleRate: RATE, channels: [rendered.channels[0].slice(22050 - 1000)] };
    expect(Math.abs(sampleAttack(around) - 1000)).toBeLessThanOrEqual(1);
  });

  it("does not start a voice before the first frame when its attack is later than the note", () => {
    const slow = new Float32Array(500);
    slow.fill(0.8, 300);
    const rendered = renderPart([hit(0, KICK)], "drums", kit({ [KICK]: [layer({ sampleRate: RATE, channels: [slow] })] }), 2000).audio;
    expect(rendered.channels[0][0]).toBe(0);
    expect(rendered.channels[0][300]).toBeGreaterThan(0);
  });

  it("starts a bass note early by its sample's attack too", () => {
    const attackAt = Math.round(0.004 * RATE);
    const body = new Float32Array(attackAt + 6000);
    for (let i = attackAt; i < body.length; i++) body[i] = 0.8 * Math.sin((2 * Math.PI * 110 * i) / RATE);
    const rendered = renderPart(
      [{ time: 0.5, pitch: 40, velocity: 100, duration: 0.2 }],
      "bass",
      kit({}, [bass(40, { sampleRate: RATE, channels: [body] })]),
      RATE * 2,
      RATE,
    ).audio;
    const around = { sampleRate: RATE, channels: [rendered.channels[0].slice(22050 - 1000)] };
    expect(Math.abs(sampleAttack(around) - 1000)).toBeLessThanOrEqual(2);
  });

  it("chooses the velocity layer and gain the picker chooses", () => {
    const soft = impulse(0.2);
    const hard = impulse(1);
    const drums = kit({ [KICK]: [layer(soft, [1, 62], 40), layer(hard, [63, 127], 100)] });

    const picked = pickDrumSample(drums, KICK, 50);
    expect(picked.audio).toBe(soft);
    expect(picked.gain).toBeCloseTo(50 / 40);
    const quiet = renderPart([hit(0, KICK, 50)], "drums", drums, 1000).audio.channels[0][0];
    expect(quiet).toBeCloseTo(0.2 * (50 / 40) * CENTRE, 6);

    const loud = renderPart([hit(0, KICK, 100)], "drums", drums, 1000).audio.channels[0][0];
    expect(loud).toBeCloseTo(1 * CENTRE, 6);
  });

  it("outputs exactly lengthFrames, and drops hits past the end", () => {
    const drums = kit({ [SNARE]: [layer(impulse(1))] });
    const { audio } = renderPart([hit(0.1, SNARE), hit(10, SNARE)], "drums", drums, 1000);
    expect(audio.channels).toHaveLength(2);
    expect(audio.channels[0]).toHaveLength(1000);
    expect(audio.channels[1]).toHaveLength(1000);
  });

  it("limits the peak to -1 dBFS and reports the factor when many loud hits overlap", () => {
    const notes = Array.from({ length: 200 }, () => hit(0, KICK, 127));
    const { audio, gain } = renderPart(notes, "drums", kit({ [KICK]: [layer(impulse(1))] }), 4410);
    const peakOut = Math.max(peak(audio.channels[0]), peak(audio.channels[1]));
    expect(peakOut).toBeCloseTo(PEAK_LIMIT, 5);
    expect(20 * Math.log10(peakOut)).toBeCloseTo(-1, 3);
    expect(gain).toBeLessThan(1);
  });

  it("leaves a quiet part unscaled and reports a gain of 1", () => {
    const { audio, gain } = renderPart([hit(0, KICK, 100)], "drums", kit({ [KICK]: [layer(impulse(1))] }), 100);
    expect(gain).toBe(1);
    expect(audio.channels[0][0]).toBeCloseTo(CENTRE, 6);
  });

  it("chokes a ringing open hat when a closed hat plays", () => {
    const drums = kit({ [OPEN_HAT]: [layer(constant(0.5, RATE))], [CLOSED_HAT]: [layer(constant(0, 8))] });
    const { audio } = renderPart([hit(0, OPEN_HAT, 100, 0.5), hit(0.2, CLOSED_HAT)], "drums", drums, RATE);
    const left = audio.channels[0];
    const chokeFrame = Math.round(0.2 * RATE);
    expect(Math.abs(left[chokeFrame - 10])).toBeGreaterThan(0.1);
    // Halfway through the 10 ms fade the hat is about half as loud as it was just before the choke.
    expect(Math.abs(left[chokeFrame + 220]) / Math.abs(left[chokeFrame - 1])).toBeCloseTo(0.5, 1);
    expect(Math.abs(left[chokeFrame + 441 + 2])).toBeLessThan(1e-6);
  });

  it("lets an open hat ring when nothing chokes it", () => {
    const drums = kit({ [OPEN_HAT]: [layer(constant(0.5, RATE))] });
    const { audio } = renderPart([hit(0, OPEN_HAT, 100, 0.5)], "drums", drums, RATE);
    expect(Math.abs(audio.channels[0][Math.round(0.9 * RATE)])).toBeGreaterThan(0.1);
  });

  it("pans a hat to the right, and the kick to the centre", () => {
    const drums = kit({ [CLOSED_HAT]: [layer(impulse(1))], [KICK]: [layer(impulse(1))] });
    const hat = renderPart([hit(0, CLOSED_HAT)], "drums", drums, 100).audio;
    expect(hat.channels[1][0]).toBeGreaterThan(hat.channels[0][0]);
    const [left, right] = panGains(DRUM_PAN[CLOSED_HAT]);
    expect(hat.channels[0][0]).toBeCloseTo(left, 6);
    expect(hat.channels[1][0]).toBeCloseTo(right, 6);

    const kick = renderPart([hit(0, KICK)], "drums", drums, 100).audio;
    expect(kick.channels[0][0]).toBeCloseTo(kick.channels[1][0], 6);
  });

  it("transposes a sample by resampling it", () => {
    // A 110 Hz sine played up an octave sounds at 220 Hz: about 220 zero crossings in half a second. The sample is two seconds long,
    // so it still sounds for the whole window.
    const drums = kit({ [SNARE]: [layer(sine(110, 2), [1, 127], 100, 12)] });
    const left = renderPart([hit(0, SNARE, 100, 1)], "drums", drums, RATE).audio.channels[0];
    expect(Math.abs(crossings(left, Math.round(0.1 * RATE), Math.round(0.6 * RATE)) - 220)).toBeLessThanOrEqual(4);
  });
});

describe("renderPart: bass", () => {
  it("holds a monophonic line: a new note fades out the one before it", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE * 2)), bass(47, constant(0.25, RATE * 2))]);
    const notes: NoteEvent[] = [hit(0, 45, 100, 1), hit(0.2, 47, 100, 0.5)];
    const left = renderPart(notes, "bass", bassKit, RATE).audio.channels[0];
    expect(left[Math.round(0.1 * RATE)]).toBeCloseTo(0.5 * CENTRE, 4);
    // Past the 10 ms cut, only the second note is sounding.
    expect(left[Math.round(0.2 * RATE) + 441 + 20]).toBeCloseTo(0.25 * CENTRE, 4);
  });

  it("releases a note over 30 ms after its duration", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE * 2))]);
    const left = renderPart([hit(0, 45, 100, 0.5)], "bass", bassKit, RATE).audio.channels[0];
    expect(left[Math.round(0.5 * RATE) - 10]).toBeCloseTo(0.5 * CENTRE, 4);
    expect(left[Math.round(0.5 * RATE) + Math.round(0.03 * RATE) + 2]).toBe(0);
  });

  it("is centred: the same level in both channels", () => {
    const bassKit = kit({}, [bass(45, constant(0.5, RATE))]);
    const { audio } = renderPart([hit(0, 45)], "bass", bassKit, 1000);
    expect(audio.channels[0][0]).toBeCloseTo(audio.channels[1][0], 6);
  });

  it("plays a pitch above its sample's root by changing the playback rate", () => {
    // The sample is 110 Hz at its root, 45. Note 57 is 12 semitones above it, so the rate doubles: 220 Hz.
    const bassKit = kit({}, [bass(45, sine(110, 3))]);
    const left = renderPart([hit(0, 57, 100, 1)], "bass", bassKit, RATE).audio.channels[0];
    expect(Math.abs(crossings(left, Math.round(0.1 * RATE), Math.round(0.6 * RATE)) - 220)).toBeLessThanOrEqual(4);
  });
});

describe("bass slides and dead notes", () => {
  // A sine at 1 kHz as the bass sample, read at the note's own pitch (root 40, rate 1) for the first test.
  const tone = (hz: number) => ({ root: 40, layer: "p" as const, velocity: [1, 127] as [number, number], audio: sine(hz, 0.5) });
  const crossingsIn = (audio: PcmAudio, fromMs: number, toMs: number): number => {
    const channel = audio.channels[0];
    let count = 0;
    for (let i = Math.round((fromMs / 1000) * RATE) + 1; i < Math.round((toMs / 1000) * RATE); i++) {
      if (channel[i - 1] < 0 && channel[i] >= 0) count++;
    }
    return count;
  };
  const samplesOf = (hz: number): SampleSet => ({ drums: new Map(), bass: [tone(hz)] });

  it("rises into a slide: the first 40 ms sound lower than the note after it, and the note reaches its pitch", () => {
    const slide = renderPart([{ time: 0, pitch: 40, velocity: 100, duration: 0.3, slideFrom: 2 }], "bass", samplesOf(1000), RATE, RATE).audio;
    // The start is two semitones down, so the first 20 ms cross zero at about 890 Hz, and 60 to 80 ms at 1000 Hz.
    const early = crossingsIn(slide, 0, 20);
    const settled = crossingsIn(slide, 60, 80);
    expect(early).toBeLessThan(settled);
    expect(settled).toBeGreaterThanOrEqual(19);
    expect(settled).toBeLessThanOrEqual(21);
  });

  it("plays a note with no slide at its own pitch from the start", () => {
    const plain = renderPart([{ time: 0, pitch: 40, velocity: 100, duration: 0.3 }], "bass", samplesOf(1000), RATE, RATE).audio;
    expect(crossingsIn(plain, 0, 20)).toBeGreaterThanOrEqual(19);
  });

  it("plays a dead note for 40 ms, with a short fade, and softer than the note it follows", () => {
    const dead = renderPart([{ time: 0, pitch: 40, velocity: 30, duration: 0.04, dead: true }], "bass", samplesOf(1000), RATE, RATE).audio;
    const live = renderPart([{ time: 0, pitch: 40, velocity: 30, duration: 0.3 }], "bass", samplesOf(1000), RATE, RATE).audio;
    const energy = (audio: PcmAudio, fromMs: number, toMs: number) => {
      let sum = 0;
      for (let i = Math.round((fromMs / 1000) * RATE); i < Math.round((toMs / 1000) * RATE); i++) sum += audio.channels[0][i] ** 2;
      return sum;
    };
    // Silent once the 40 ms and its 10 ms fade are over, and nothing before the note starts.
    expect(energy(dead, 52, 200)).toBe(0);
    expect(energy(dead, 0, 40)).toBeGreaterThan(0);
    expect(energy(dead, 0, 40)).toBeLessThan(energy(live, 0, 40));
  });

  it("filters a dead note: a high tone sounds weaker than the same note played live", () => {
    const high = samplesOf(4000);
    const dead = renderPart([{ time: 0, pitch: 40, velocity: 30, duration: 0.04, dead: true }], "bass", high, RATE, RATE).audio;
    const live = renderPart([{ time: 0, pitch: 40, velocity: 30, duration: 0.04 }], "bass", high, RATE, RATE).audio;
    const power = (audio: PcmAudio) => audio.channels[0].reduce((sum, value) => sum + value * value, 0);
    expect(power(dead)).toBeLessThan(power(live) * 0.5);
  });
});
