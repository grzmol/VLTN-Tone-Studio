import { describe, expect, it } from "vitest";
import { encodeRhythmBank, RHYTHM_BANK_RECORD_BYTES, RHYTHM_BANK_MAX_NOTES, rhythmBankName, type RhythmBankPattern } from "./rhythm-bank";

const pattern = (): RhythmBankPattern => ({
  name: "Insomnia",
  bpm: 140,
  numerator: 4,
  denominator: 4,
  totalBars: 12,
  endTick: 23_040,
  parts: [
    { startBar: 1, bars: 1 },
    { startBar: 2, bars: 4 },
    { startBar: 6, bars: 1 },
    { startBar: 7, bars: 4 },
    { startBar: 11, bars: 1 },
    { startBar: 12, bars: 1 },
  ],
  notes: [
    { tick: 0, duration: 96, pitch: 36, velocity: 100 },
    { tick: 480, duration: 96, pitch: 38, velocity: 90 },
  ],
});

describe("native rhythm bank", () => {
  it("writes the fixed bank layout and all six assignments as observed in converter exports", () => {
    const file = encodeRhythmBank([pattern()]);
    const view = new DataView(file.buffer);
    expect(file.length).toBe(2_005_812);
    expect(new TextDecoder().decode(file.slice(0, 8))).toBe("PTN_0000");
    expect(view.getUint32(8, true)).toBe(40_116);
    expect(new TextDecoder().decode(file.slice(12, 20))).toBe("Insomnia");
    expect(Array.from(file.slice(20, 32))).toEqual([0, 0, 0, 0, 0, 0, 140, 0, 4, 4, 0, 0]);
    // Each descriptor has zero-based From, Bars, source total bars, zero, and events including the sentinel.
    expect(Array.from(file.slice(32, 48))).toEqual([0, 0, 1, 0, 12, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0]);
    const starts = [0, 1, 5, 6, 10, 11],
      lengths = [1, 4, 1, 4, 1, 1];
    for (let i = 0; i < 6; i++) {
      const at = 32 + i * 16;
      expect(view.getUint16(at, true)).toBe(starts[i]);
      expect(view.getUint16(at + 2, true)).toBe(lengths[i]);
      expect(view.getUint32(at + 4, true)).toBe(12);
      expect(view.getUint32(at + 8, true)).toBe(0);
      expect(view.getUint32(at + 12, true)).toBe(3);
    }
    // At 96 PPQ: first hit at 0, second at 96, terminal reaches 4608. No note-off records.
    expect(Array.from(file.slice(128, 140))).toEqual([0, 0, 36, 100, 96, 0, 38, 90, 160, 17, 0, 0]);
    expect(file.subarray(140).some((byte) => byte !== 0)).toBe(false);
  });

  it("supports a playlist bank, per-song lengths, integer tempo and eight-character names", () => {
    const first = pattern(),
      second = { ...pattern(), name: "Confession", bpm: 149.9 };
    const bytes = encodeRhythmBank([first, second]);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(8, true)).toBe(2 * RHYTHM_BANK_RECORD_BYTES);
    const offset = 12 + RHYTHM_BANK_RECORD_BYTES;
    expect(new TextDecoder().decode(bytes.slice(offset, offset + 8))).toBe("Confessi");
    expect(view.getUint16(offset + 14, true)).toBe(150);
    expect(rhythmBankName("Café song long")).toBe("Cafe son");
  });

  it("quantises each absolute position to 96 PPQ and preserves simultaneous event order", () => {
    const input = pattern();
    input.notes = [
      { tick: 9, duration: 1, pitch: 36, velocity: 100 },
      { tick: 9, duration: 1, pitch: 42, velocity: 80 },
      { tick: 16, duration: 1, pitch: 38, velocity: 90 },
    ];
    const file = encodeRhythmBank([input]);
    expect(Array.from(file.slice(128, 140))).toEqual([1, 0, 36, 100, 0, 0, 42, 80, 2, 0, 38, 90]);
  });

  it("uses true 6/8 bar lengths and quarter-note BPM", () => {
    const input = { ...pattern(), numerator: 6, denominator: 8, endTick: 17_280, bpm: 150 };
    const file = encodeRhythmBank([input]);
    const view = new DataView(file.buffer);
    expect(Array.from(file.slice(28, 30))).toEqual([6, 8]);
    expect(view.getUint16(136, true)).toBe(3360); // 12*3*96 minus the second hit at96.
  });

  it("rejects unsupported or oversized patterns instead of truncating them", () => {
    for (const bpm of [39, 351, NaN]) expect(() => encodeRhythmBank([{ ...pattern(), bpm }])).toThrow("tempo");
    expect(() => encodeRhythmBank([])).toThrow("1–50");
    expect(() => encodeRhythmBank(Array.from({ length: 51 }, pattern))).toThrow("1–50");
    const fills = pattern();
    fills.parts = fills.parts.map((part, index) => (index === 2 ? { startBar: 6, bars: 2 } : part));
    expect(() => encodeRhythmBank([fills])).toThrow("one bar");
    expect(() => encodeRhythmBank([{ ...pattern(), notes: Array.from({ length: RHYTHM_BANK_MAX_NOTES + 1 }, () => pattern().notes[0]) }])).toThrow("9999");
    expect(() => encodeRhythmBank([{ ...pattern(), endTick: 23_039 }])).toThrow("endpoint");
    expect(() => encodeRhythmBank([{ ...pattern(), notes: [{ tick: 23_040, duration: 1, pitch: 36, velocity: 100 }] }])).toThrow("invalid");
  });
});
