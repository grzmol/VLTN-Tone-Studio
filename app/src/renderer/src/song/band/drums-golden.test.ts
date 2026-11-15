import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BAND_SETTINGS,
  planSections,
  type BandSettings,
} from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { generateDrums } from "./drums";
import type { StyleId } from "./styles/types";
import type { Section } from "../performance/sections";
import golden from "./drums-golden.snapshot.json";

// Golden drums for songs saved on engine 1 or 2. Engine 3 plays drums in phrases (spec 132); a song on an earlier engine must keep the notes
// it had, so these are pinned from the notes `main` gave before that spec. Run with UPDATE_GOLDEN=1 to write the file again; only do that for
// a change meant to alter the earlier drums.

const BARS = 40;
const BAR = 2;

const grid: BeatGrid = {
  beatsPerBar: 4,
  beats: Array.from({ length: BARS * 4 }, (_, i) => i * 0.5),
  downbeat: 0,
  bpm: 120,
  steady: null,
};

const sections: Section[] = [
  { id: "a", name: "Intro", start: 0, end: 4 * BAR, mode: "continue" },
  { id: "b", name: "Verse", start: 4 * BAR, end: 16 * BAR, mode: "continue" },
  {
    id: "c",
    name: "Pre-chorus",
    start: 16 * BAR,
    end: 20 * BAR,
    mode: "continue",
  },
  { id: "d", name: "Chorus", start: 20 * BAR, end: 28 * BAR, mode: "continue" },
  { id: "e", name: "Verse", start: 28 * BAR, end: 36 * BAR, mode: "continue" },
  {
    id: "f",
    name: "Chorus",
    start: 36 * BAR,
    end: BARS * BAR,
    mode: "continue",
  },
];

function notesFor(
  style: StyleId,
  engine: number,
  extra: Partial<BandSettings> = {},
) {
  const settings: BandSettings = {
    ...DEFAULT_BAND_SETTINGS,
    engine,
    style,
    complexity: 1,
    swing: 0,
    ghostNotes: true,
    crashOnSections: true,
    sections: { b: { fill: true }, d: { energy: 5 } },
    ...extra,
  };
  return generateDrums(
    grid,
    planSections(sections, BARS * BAR, settings),
    settings,
    7,
  );
}

const CASES: [StyleId, number, Partial<BandSettings>][] = [
  ["rock", 1, {}],
  ["rock", 2, {}],
  ["funk", 2, {}],
  ["metal", 2, {}],
  [
    "rock",
    2,
    {
      marks: [
        { time: 10 * BAR, kind: "fill" },
        { time: 12 * BAR, kind: "crash" },
        { time: 13 * BAR, kind: "stop" },
      ],
    },
  ],
];

describe("drums of songs on an earlier engine", () => {
  const actual = Object.fromEntries(
    CASES.map(([style, engine, extra], i) => [
      `${i} ${style} engine ${engine}`,
      notesFor(style, engine, extra),
    ]),
  );

  it("matches the golden notes", () => {
    if (process.env.UPDATE_GOLDEN)
      writeFileSync(
        join(__dirname, "drums-golden.snapshot.json"),
        JSON.stringify(actual),
      );
    expect(JSON.parse(JSON.stringify(actual))).toEqual(golden);
  });
});
