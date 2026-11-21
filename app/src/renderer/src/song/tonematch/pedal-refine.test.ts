// The refinement loop against a simulated pedal (a soft-clipping amp pushed by its Gain knob, then the five EQ bands),
// with the player playing a different performance every round, as in life.
import { describe, expect, it } from "vitest";
import { analyseGuitar } from "./analyse";
import { bestRound, isDone, MAX_ROUNDS, measure, nextKnobs, type Knobs, type Round } from "./pedal-refine";
import { renderChain, type Amp } from "./refine-offline";
import { plucks } from "./test-signals";

const SR = 44100;
const amp: Amp = (x) => x.map((v) => Math.tanh(2 * v));
const guitar = (seed: number) => plucks({ seconds: 20, sampleRate: SR, seed, gap: 0.15, decay: 0.6, amplitude: 0.3, harmonics: 10 });
/** What the pedal plays for these knobs: the Gain param 0-100 is -12..+24 dB in front of the amp. */
const pedal = (k: Knobs, seed: number) => renderChain(guitar(seed), SR, amp, { driveDb: -12 + (36 * k.gain) / 100, eqDb: k.eqDb });

describe("refinement loop", () => {
  it("brings a pedal that starts flat close to the song's tone, in at most MAX_ROUNDS takes", async () => {
    // the song's guitar: a hotter amp with a scooped-and-bright EQ, played by someone else
    const song = analyseGuitar(await renderChain(guitar(101), SR, amp, { driveDb: 12, eqDb: [3, -4, 2, 0, 5] }), SR);

    const history: Round[] = [];
    let knobs: Knobs = { gain: 40, eqDb: [0, 0, 0, 0, 0] };
    for (let take = 0; take < MAX_ROUNDS; take++) {
      history.push({ knobs, measure: measure(await pedal(knobs, 200 + take), SR, song) });
      if (isDone(history)) break;
      knobs = nextKnobs(history, song);
    }

    const start = history[0].measure.distance;
    const best = bestRound(history);
    console.log("rounds:", history.map((r) => `${r.measure.distance.toFixed(2)} (gain ${r.knobs.gain}, eq ${r.knobs.eqDb.map((g) => g.toFixed(1)).join("/")})`));
    expect(history.length).toBeLessThanOrEqual(MAX_ROUNDS);
    // never worse than where it started, and clearly closer
    expect(best.measure.distance).toBeLessThanOrEqual(start);
    expect(best.measure.distance).toBeLessThan(start * 0.7);
  }, 120_000);

  it("keeps the knobs inside what the pedal takes", () => {
    const m = { distance: 9, gainScore: 0.1, gapDb: [40, -40, 40, -40, 40] };
    const history: Round[] = [{ knobs: { gain: 95, eqDb: [11, -11, 0, 0, 0] }, measure: m }];
    const next = nextKnobs(history, { gain: { score: 0.9 } } as never);
    expect(next.gain).toBeGreaterThanOrEqual(0);
    expect(next.gain).toBeLessThanOrEqual(100);
    for (const g of next.eqDb) expect(Math.abs(g)).toBeLessThanOrEqual(12);
  });
});

describe("isDone / bestRound", () => {
  const round = (distance: number): Round => ({ knobs: { gain: 50, eqDb: [0, 0, 0, 0, 0] }, measure: { distance, gainScore: 0.5, gapDb: [0, 0, 0, 0, 0] } });
  it("stops after MAX_ROUNDS, or when two rounds in a row bring nothing", () => {
    expect(isDone([round(5)])).toBe(false);
    expect(isDone([round(5), round(3), round(2)])).toBe(false);
    expect(isDone([round(5), round(3), round(3.05), round(3.1)])).toBe(true);
    expect(isDone(Array.from({ length: MAX_ROUNDS }, (_, i) => round(10 - i)))).toBe(true);
  });
  it("picks the closest round, the first on a tie", () => {
    const h = [round(5), round(2), round(4), round(2)];
    expect(bestRound(h)).toBe(h[1]);
  });
});
