import { describe, expect, it } from "vitest";
import { DEFAULT_BAND_SETTINGS, planSections, type BandSettings, type SectionOverride } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateBass } from "./bass";
import { chooseVariation } from "./bass-phrases";
import { parseChordName, type ChordAtBeat } from "./harmony";
import type { NoteEvent } from "./note";
import { createRandom } from "./random";
import type { Section } from "../performance/sections";
import { findStyle } from "./styles";

const gridOf = (bars: number): BeatGrid => ({
  beatsPerBar: 4,
  beats: Array.from({ length: bars * 4 }, (_, i) => i * 0.5),
  downbeat: 0,
  bpm: 120,
  steady: null,
});
const harmonyOf = (names: readonly string[]): ChordAtBeat[] =>
  names.flatMap((name, bar) => [0, 1, 2, 3].map((b) => ({ beat: bar * 4 + b, time: (bar * 4 + b) * 0.5, chord: parseChordName(name) })));
const section = (id: string, name: string, start: number, end: number): Section => ({ id, name, start, end, mode: "continue" });
const settingsWith = (sections: Record<string, SectionOverride>): BandSettings => ({
  ...DEFAULT_BAND_SETTINGS,
  complexity: 1,
  lockToKick: false,
  bassMode: "roots",
  bassRange: "normal",
  sections,
});

/** A song of `bars` bars of one chord (the last bar is the ending), in one section of the given name and overrides. */
function songOf(bars: number, name: string, override: SectionOverride, chord = "C"): NoteEvent[] {
  const settings = settingsWith({ s: override });
  const plans = planSections([section("s", name, 0, bars * 2)], bars * 2, settings);
  return generateBass(gridOf(bars), harmonyOf(Array(bars).fill(chord)), plans, settings, [], 5);
}

describe("bass technique defaults", () => {
  const defaultsOf = (style: string) => {
    const [plan] = planSections([section("s", "Verse", 0, 8)], 8, { ...DEFAULT_BAND_SETTINGS, style: style as never });
    return { slides: plan.slides, deadNotes: plan.deadNotes, pickups: plan.pickups };
  };

  it("gives funk dead notes and no slides, and ballad slides and no dead notes", () => {
    expect(defaultsOf("funk")).toEqual({ slides: false, deadNotes: true, pickups: true });
    expect(defaultsOf("ballad")).toEqual({ slides: true, deadNotes: false, pickups: true });
  });

  it("gives rock and metal pickups, and the other styles pickups only", () => {
    expect(defaultsOf("rock")).toEqual({ slides: false, deadNotes: false, pickups: true });
    expect(defaultsOf("metal")).toEqual({ slides: false, deadNotes: false, pickups: true });
    expect(defaultsOf("pop")).toEqual({ slides: false, deadNotes: false, pickups: true });
    expect(defaultsOf("reggae")).toEqual({ slides: false, deadNotes: false, pickups: true });
  });

  it("keeps the defaults in the style data, and a section's own choice over them", () => {
    expect(findStyle("funk")?.bass.techniques).toEqual({ slides: false, deadNotes: true, pickups: true });
    const [plan] = planSections([section("s", "Verse", 0, 8)], 8, settingsWith({ s: { style: "funk", deadNotes: false, slides: true } }));
    expect(plan).toMatchObject({ deadNotes: false, slides: true, pickups: true });
  });
});

describe("bass slides", () => {
  // Pulse at loud 1 plays quarter notes of 0.2 s, so every bar's downbeat follows a rest of 0.3 s, longer than half a beat.
  const pulse: SectionOverride = { bassPart: "pulse", busy: 2, loud: 1, slides: true, deadNotes: false, fills: 0 };

  it("slides into some downbeats after a rest, two semitones below the note", () => {
    const notes = songOf(41, "Verse", pulse);
    const slides = notes.filter((note) => note.slideFrom !== undefined);
    expect(slides.length).toBeGreaterThanOrEqual(4);
    expect(slides.length).toBeLessThanOrEqual(20);
    expect(slides.every((note) => note.slideFrom === 2)).toBe(true);
  });

  it("slides only on a downbeat", () => {
    const notes = songOf(41, "Verse", pulse);
    for (const note of notes.filter((entry) => entry.slideFrom !== undefined)) expect(Math.abs(note.time / 2 - Math.round(note.time / 2))).toBeLessThan(1e-9);
  });

  it("does not slide when the section turns slides off", () => {
    expect(songOf(41, "Verse", { ...pulse, slides: false }).some((note) => note.slideFrom !== undefined)).toBe(false);
  });
});

describe("bass dead notes", () => {
  // Ring at busy 3 plays two half notes a bar, a second apart: an empty sixteenth fits before each of them.
  const ring: SectionOverride = { bassPart: "ring", busy: 3, deadNotes: true, slides: false, fills: 0 };

  it("plays soft, short dead notes on the chance, in the empty sixteenth before a note, on the note's pitch", () => {
    const notes = songOf(21, "Verse", ring);
    const dead = notes.filter((note) => note.dead);
    expect(dead.length).toBeGreaterThanOrEqual(5);
    expect(dead.length).toBeLessThanOrEqual(30);
    for (const note of dead) {
      expect(note.velocity).toBe(30);
      expect(note.duration).toBeCloseTo(0.04, 6);
      const before = notes.filter((other) => !other.dead && other.time < note.time).at(-1)!;
      expect(note.pitch).toBe(before.pitch);
      const after = notes.find((other) => !other.dead && other.time > note.time)!;
      expect(after.time - note.time).toBeGreaterThanOrEqual(0.124);
    }
  });

  it("stops the note before a dead note where the dead note starts", () => {
    const notes = songOf(21, "Verse", ring);
    for (const note of notes.filter((entry) => !entry.dead)) {
      const dead = notes.find((other) => other.dead && other.time > note.time && other.time < note.time + 1);
      if (dead) expect(note.time + note.duration).toBeLessThanOrEqual(dead.time + 1e-9);
    }
  });

  it("plays no dead notes below busy 3", () => {
    expect(songOf(21, "Verse", { ...ring, busy: 2 }).some((note) => note.dead)).toBe(false);
  });

  it("plays no dead notes when the section turns them off", () => {
    expect(songOf(21, "Verse", { ...ring, deadNotes: false }).some((note) => note.dead)).toBe(false);
  });
});

describe("pickups off", () => {
  it("never plays a pickup, so a phrase still varies by the other kinds", () => {
    for (let phrase = 0; phrase < 4; phrase++) {
      const random = createRandom(3 + phrase);
      const kinds = new Set(Array.from({ length: 200 }, () => chooseVariation(3, "groove", phrase, random, false)?.kind));
      expect(kinds.has("pickup")).toBe(false);
      expect(kinds.size).toBeGreaterThan(1);
    }
  });
});
