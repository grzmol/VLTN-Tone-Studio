import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings, type SectionOverride } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateBass } from "./bass";
import { parseChordName, type ChordAtBeat } from "./harmony";
import type { NoteEvent } from "./note";
import type { Section } from "../performance/sections";

/**
 * The bass as it was before sections had their own parts (spec 85, stage 2). The snapshot holds the time, pitch and velocity of every
 * note for each song bass mode and seed, taken from the code before stage 2. A song whose sections all play the groove part, with busy
 * set to the energy, must still give those notes. The snapshot also predates fills and hit-the-one, so the sections here have both off.
 * The durations change on purpose (the lengths are new), so they are not compared.
 */
const SNAPSHOT = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "bass-migration.snapshot.json"), "utf8")) as Record<
  string,
  [number, number, number][]
>;

const BARS = 16;
const grid: BeatGrid = {
  beatsPerBar: 4,
  beats: Array.from({ length: BARS * 4 }, (_, i) => i * 0.5),
  downbeat: 0,
  bpm: 120,
  steady: { bpm: 120, firstBeat: 0 },
};
const NAMES = ["C", "Am", "F", "G"];
const harmony: ChordAtBeat[] = grid.beats.map((time, beat) => ({ beat, time, chord: parseChordName(NAMES[Math.floor(beat / 4) % 4]) }));
const kick: NoteEvent[] = [];
for (let bar = 0; bar < BARS; bar++) for (const beat of [0, 2]) kick.push({ time: (bar * 4 + beat) * 0.5, pitch: 36, velocity: 100, duration: 0.1 });
const sections: Section[] = [
  { id: "i", name: "Intro", start: 0, end: 4, mode: "continue" },
  { id: "v", name: "Verse", start: 4, end: 12, mode: "continue" },
  { id: "c", name: "Chorus", start: 12, end: 20, mode: "continue" },
  { id: "o", name: "Outro", start: 20, end: 32, mode: "continue" },
];

describe("bass before sections had their own parts", () => {
  for (const mode of ["roots", "fifths", "octaves", "melodic", "walking"] as const) {
    for (const seed of [3, 11]) {
      it(`gives the same notes for ${mode}, seed ${seed}, with every section on the groove part`, () => {
        // These notes are the earlier bass (engine 1): the figures of engine 2 play other notes in a groove part.
        const base: BandSettings = { ...DEFAULT_BAND_SETTINGS, engine: 1, bassMode: mode, complexity: 0.5, lockToKick: true, bassRange: "normal" };
        const overrides: Record<string, SectionOverride> = Object.fromEntries(
          sections.map((section) => [section.id, { bassPart: "groove" as const, fills: 0 as const, hitTheOne: false }]),
        );
        const settings: BandSettings = { ...base, sections: overrides };
        const notes = generateBass(grid, harmony, planSections(sections, 32, settings), settings, kick, seed);
        expect(notes.map((note) => [note.time, note.pitch, note.velocity])).toEqual(SNAPSHOT[`${mode}-${seed}`]);
      });
    }
  }
});
