// Native rhythm banks preserve the six division assignments. Layout and tick conversion were checked against converter exports.
import { EXPORT_PPQ, type SmfTickNote } from "../performance/smf";

export const RHYTHM_BANK_SLOTS = 50;
export const RHYTHM_BANK_RECORD_BYTES = 40_116;
export const RHYTHM_BANK_HEADER_BYTES = 12;
export const RHYTHM_BANK_PPQ = 96;
export const RHYTHM_BANK_MAX_NOTES = 9_999;

export interface RhythmBankPattern {
  name: string;
  /** Quarter-note BPM. Native banks store an integer. */
  bpm: number;
  numerator: number;
  denominator: number;
  /** Studio is 0; the other kit indices are 1–15. */
  kit?: number;
  totalBars: number;
  endTick: number;
  /** Intro, Pattern 1, Fill 1, Pattern 2, Fill 2, Ending, in that order. Starts are one-based. */
  parts: readonly { startBar: number; bars: number }[];
  /** Positions are at EXPORT_PPQ. Note-offs are not stored by the native rhythm format. */
  notes: readonly SmfTickNote[];
}

/** The pedal displays eight ASCII characters. Keep the full title in filenames and the import guide. */
export function rhythmBankName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]/g, "-")
      .trim()
      .slice(0, 8) || "Rhythm"
  );
}

/** Writes a complete native bank with zero-filled empty slots. Import loads its list; Apply is a separate device action. */
export function encodeRhythmBank(patterns: readonly RhythmBankPattern[]): Uint8Array {
  if (!patterns.length || patterns.length > RHYTHM_BANK_SLOTS) throw new Error("Choose 1–50 rhythms for a bank.");
  const bytes = new Uint8Array(RHYTHM_BANK_HEADER_BYTES + RHYTHM_BANK_SLOTS * RHYTHM_BANK_RECORD_BYTES);
  bytes.set(new TextEncoder().encode("PTN_0000"));
  const view = new DataView(bytes.buffer);
  view.setUint32(8, patterns.length * RHYTHM_BANK_RECORD_BYTES, true);
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  for (const [index, pattern] of patterns.entries()) {
    const offset = RHYTHM_BANK_HEADER_BYTES + index * RHYTHM_BANK_RECORD_BYTES;
    const bpm = Math.round(pattern.bpm);
    if (!Number.isFinite(pattern.bpm) || pattern.bpm < 40 || pattern.bpm > 350) throw new Error("The rhythm tempo must be 40–350 quarter-note BPM.");
    const supported = (pattern.denominator === 4 && integer(pattern.numerator, 2, 7)) || (pattern.denominator === 8 && integer(pattern.numerator, 5, 15));
    if (!supported || !integer(pattern.totalBars, 1, 65_535)) throw new Error("The native rhythm has an unsupported meter or length.");
    if (!integer(pattern.kit ?? 0, 0, 15)) throw new Error("Choose a drum kit from 1 to 16.");
    if (pattern.notes.length > RHYTHM_BANK_MAX_NOTES || pattern.notes.length === 0) throw new Error("A native rhythm needs 1–9999 drum hits.");
    const expectedEnd = pattern.totalBars * pattern.numerator * (4 / pattern.denominator) * EXPORT_PPQ;
    if (pattern.endTick !== expectedEnd) throw new Error("The rhythm endpoint must match its complete musical bars.");
    if (pattern.parts.length !== 6) throw new Error("Assign all six rhythm parts before exporting.");
    const name = rhythmBankName(pattern.name).padEnd(8, " ");
    bytes.set(new TextEncoder().encode(name), offset);
    view.setUint16(offset + 12, pattern.kit ?? 0, true);
    view.setUint16(offset + 14, bpm, true);
    bytes[offset + 16] = pattern.numerator;
    bytes[offset + 17] = pattern.denominator;
    for (const [role, part] of pattern.parts.entries()) {
      if (!integer(part.startBar, 1, pattern.totalBars) || !integer(part.bars, 1, pattern.totalBars - part.startBar + 1))
        throw new Error("A rhythm part is outside the exported passage.");
      if ((role === 2 || role === 4) && part.bars !== 1) throw new Error("The two fills must each be exactly one bar.");
      const at = offset + 20 + role * 16;
      view.setUint16(at, part.startBar - 1, true);
      view.setUint16(at + 2, part.bars, true);
      view.setUint32(at + 4, pattern.totalBars, true);
      view.setUint32(at + 12, pattern.notes.length + 1, true);
    }
    const sorted = [...pattern.notes].sort((a, b) => a.tick - b.tick);
    let previous = 0;
    for (let i = 0; i <= sorted.length; i++) {
      const note = sorted[i];
      if (note && (!integer(note.tick, 0, pattern.endTick - 1) || !integer(note.pitch, 1, 127) || !integer(note.velocity, 1, 127)))
        throw new Error("A native drum hit has an invalid position, pitch or velocity.");
      const tick = Math.floor(((note?.tick ?? pattern.endTick) * RHYTHM_BANK_PPQ) / EXPORT_PPQ);
      const delta = tick - previous;
      if (!integer(delta, 0, 65_535)) throw new Error("The rhythm has a gap too long for the native format. Choose shorter passages.");
      const at = offset + 116 + i * 4;
      view.setUint16(at, delta, true);
      bytes[at + 2] = note?.pitch ?? 0;
      bytes[at + 3] = note?.velocity ?? 0;
      previous = tick;
    }
  }
  return bytes;
}
