import { describe, expect, it } from "vitest";
import {
  sectionsFollowDetection,
  sectionsFromDetected,
  sectionsToApply,
  BAR_DETECT,
  TIME_DETECT,
  TIME_FRAME_S,
  barUnitSpans,
  boundaryHits,
  cosine,
  detectSections,
  nameSections,
  noveltyCurve,
  pickBoundaries,
  timeUnitSpans,
  type SectionUnit,
} from "./sections";

/** One block style per letter: I is an intro-like block, A and B carry vocals (B is louder), C is an instrumental solo. */
const STYLES: Record<string, { note: number; energy: number; vocals: boolean }> = {
  I: { note: 0, energy: 0.3, vocals: false },
  A: { note: 2, energy: 0.5, vocals: true },
  B: { note: 5, energy: 0.9, vocals: true },
  C: { note: 9, energy: 1.0, vocals: false },
};

/** A small deterministic generator, so the jitter in the fixtures is the same every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const BAR_S = 2;

/** One unit per bar: the chroma of the block's note, with a little jitter, and the block's energy and vocal flag. */
function barsOf(pattern: string, barsPerBlock: number, jitter = 0, seed = 1): SectionUnit[] {
  const next = random(seed);
  const units: SectionUnit[] = [];
  for (const [i, letter] of [...pattern].entries()) {
    const style = STYLES[letter];
    for (let bar = 0; bar < barsPerBlock; bar++) {
      const index = i * barsPerBlock + bar;
      const chroma = Array.from({ length: 12 }, (_, pitch) => (pitch === style.note ? 1 : 0) + (pitch === (style.note + 4) % 12 ? 0.5 : 0) + jitter * next());
      units.push({ start: index * BAR_S, end: (index + 1) * BAR_S, chroma, energy: style.energy * (1 + jitter * (next() - 0.5)), vocals: style.vocals });
    }
  }
  return units;
}

/** The bar boundaries a pattern should give, in seconds: every change of letter, where the pattern's blocks meet. */
function truthCuts(pattern: string, barsPerBlock: number): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < pattern.length; i++) if (pattern[i] !== pattern[i - 1]) cuts.push(i * barsPerBlock * BAR_S);
  return cuts;
}

/** The units of a song given as frames of `TIME_FRAME_S` seconds, one letter per frame. */
function framesOf(pattern: string, framesPerBlock: number): SectionUnit[] {
  const spans = timeUnitSpans(pattern.length * framesPerBlock * TIME_FRAME_S);
  return spans.map((span, i) => {
    const style = STYLES[pattern[Math.floor(i / framesPerBlock)]];
    const chroma = Array.from({ length: 12 }, (_, pitch) => (pitch === style.note ? 1 : 0));
    return { ...span, chroma, energy: style.energy, vocals: style.vocals };
  });
}

describe("barUnitSpans", () => {
  it("cuts the song on the bar lines from the first downbeat, with a pickup before it", () => {
    // Four beats a bar, one beat each second; the first downbeat is the second beat.
    const beats = Array.from({ length: 12 }, (_, i) => i + 0.5);
    const spans = barUnitSpans(beats, 1, 4, 12);
    expect(spans?.map((s) => s.start)).toEqual([0, 1.5, 5.5, 9.5]);
    expect(spans?.at(-1)?.end).toBe(12);
  });

  it("gives null when the grid is too short to bar", () => {
    expect(barUnitSpans([0.5, 1], 0, 4, 2)).toBeNull();
  });

  it("carries bars on past the grid's last beat, so a drum-free ending is bars and not one long unit", () => {
    // The tracker stopped at 12 s; the song runs to 30 s.
    const beats = Array.from({ length: 12 }, (_, i) => i);
    const spans = barUnitSpans(beats, 0, 4, 30)!;
    expect(spans.map((s) => s.start)).toEqual([0, 4, 8, 12, 16, 20, 24]);
    expect(spans.at(-1)?.end).toBe(30);
  });

  it("uses the grid's own bar starts when its bar lines move", () => {
    const beats = Array.from({ length: 20 }, (_, i) => i);
    const spans = barUnitSpans(beats, 0, 4, 20, [0, 4, 8, 10, 14])!;
    expect(spans.map((s) => s.start).slice(0, 5)).toEqual([0, 4, 8, 10, 14]);
  });
});

describe("detectSections on repeated blocks", () => {
  it("finds the edges of the blocks and names them by how they repeat", () => {
    // Two A blocks in a row are one 16-bar verse: nothing changes between them.
    const sections = detectSections(barsOf("AABABCB", 8, 0.02), BAR_DETECT);
    expect(sections.map((s) => s.start)).toEqual([0, 16 * BAR_S, 24 * BAR_S, 32 * BAR_S, 40 * BAR_S, 48 * BAR_S]);
    expect(sections.map((s) => s.name)).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Solo", "Chorus 3"]);
    expect(sections.at(-1)?.end).toBe(56 * BAR_S);
  });

  it("starts with an intro and ends with an outro when the first and last blocks have no vocals", () => {
    const sections = detectSections(barsOf("IABABI", 8, 0.02), BAR_DETECT);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Outro"]);
  });

  it("never cuts a section shorter than four bars", () => {
    const sections = detectSections(barsOf("ABABABABABAB", 2, 0.02), BAR_DETECT);
    for (const section of sections) expect(section.end - section.start).toBeGreaterThanOrEqual(4 * BAR_S);
  });

  it("returns nothing for a song too short to hold two sections", () => {
    expect(detectSections(barsOf("AB", 3), BAR_DETECT)).toEqual([]);
  });

  it("covers the whole song with no gaps", () => {
    const sections = detectSections(barsOf("AABABCB", 8, 0.02), BAR_DETECT);
    for (let i = 1; i < sections.length; i++) expect(sections[i].start).toBe(sections[i - 1].end);
  });

  it("finds the same edges on time frames when there is no beat grid", () => {
    const sections = detectSections(framesOf("IABABI", 8), TIME_DETECT);
    // Blocks of eight frames: the edges are at 8, 16, 24, 32 and 40 frames.
    expect(sections.map((s) => s.start)).toEqual([0, 8 * TIME_FRAME_S, 16 * TIME_FRAME_S, 24 * TIME_FRAME_S, 32 * TIME_FRAME_S, 40 * TIME_FRAME_S]);
  });
});

describe("pickBoundaries", () => {
  it("prefers the multiple of four over a slightly stronger off-grid peak that is too close to it", () => {
    const novelty = Array.from({ length: 20 }, () => 0);
    // The off-grid peak at 10 is two bars from the on-grid peak at 8, so it is the one dropped, though it is stronger on its own.
    novelty[8] = 0.85;
    novelty[9] = 0.3;
    novelty[10] = 0.9;
    expect(pickBoundaries(novelty, BAR_DETECT)).toEqual([8]);
  });

  it("keeps an off-grid peak when nothing else is near it", () => {
    const novelty = Array.from({ length: 20 }, () => 0);
    novelty[10] = 0.8;
    expect(pickBoundaries(novelty, BAR_DETECT)).toEqual([10]);
  });

  it("drops peaks too close to either end of the song", () => {
    const novelty = Array.from({ length: 12 }, () => 0);
    novelty[2] = 0.9;
    novelty[9] = 0.9;
    expect(pickBoundaries(novelty, BAR_DETECT)).toEqual([]);
  });
});

describe("noveltyCurve and cosine", () => {
  it("is near zero inside a block and high across a change", () => {
    const vectors = [...Array.from({ length: 10 }, () => [1, 0]), ...Array.from({ length: 10 }, () => [0, 1])];
    const novelty = noveltyCurve(vectors, 4);
    expect(novelty[5]).toBe(0);
    // Across a change between orthogonal blocks, the same-side pairs score 1 and the cross pairs score -1 and 0 (orthogonal): half the kernel.
    expect(novelty[10]).toBeCloseTo(0.5);
  });

  it("matches a vector against itself and nothing against zero", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 0])).toBe(0);
  });
});

describe("nameSections", () => {
  it("numbers repeated names in song order and leaves a single name alone", () => {
    const info = (kind: number, vocals: boolean, energy: number) => ({ from: 0, to: 1, vector: [], energy, vocalEnergy: energy, vocals, kind });
    const names = nameSections([info(0, true, 0.5), info(1, true, 0.9), info(0, true, 0.5), info(1, true, 0.9), info(2, false, 1.5), info(1, true, 0.9)]);
    expect(names).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Solo", "Chorus 3"]);
  });
});

describe("boundary accuracy on synthetic songs", () => {
  // Each song is a pattern of blocks, with jitter, seeded per song. A boundary counts as found when a detected one is within one bar.
  const patterns = ["AABABCB", "IABABI", "IAABCBAB", "ABACAB", "IABABCBC", "AABBCCBB", "IBABCBCB", "ACBACBAB"];
  it("finds at least 70% of the boundaries within one bar", () => {
    let hits = 0;
    let total = 0;
    for (const [i, pattern] of patterns.entries()) {
      for (const seed of [1, 2, 3]) {
        const units = barsOf(pattern, 8, 0.05, seed * 10 + i);
        const found = detectSections(units, BAR_DETECT).map((s) => s.start);
        const truth = truthCuts(pattern, 8);
        // Section starts include 0, which is not a boundary to find.
        hits += boundaryHits(
          found.filter((t) => t > 0),
          truth,
          BAR_S,
        );
        total += truth.length;
      }
    }
    expect(hits / total).toBeGreaterThanOrEqual(0.7);
  });
});

describe("applying detected sections", () => {
  const detected = [
    { start: 0, end: 16, name: "Verse 1" },
    { start: 16, end: 32, name: "Chorus 1" },
  ];

  it("follows a new detection only while the sections are still the detected ones, untouched", () => {
    const current = sectionsFromDetected(detected, ids());
    expect(sectionsFollowDetection(current, detected)).toBe(true);
    // A boundary moved by hand, a renamed section, a changed mode or colour, or a section removed: each keeps the list as it is.
    expect(sectionsFollowDetection([{ ...current[0], end: 15 }, current[1]], detected)).toBe(false);
    expect(sectionsFollowDetection([{ ...current[0], name: "Intro" }, current[1]], detected)).toBe(false);
    expect(sectionsFollowDetection([{ ...current[0], mode: "loop" }, current[1]], detected)).toBe(false);
    expect(sectionsFollowDetection([{ ...current[0], color: "#ff0000" }, current[1]], detected)).toBe(false);
    expect(sectionsFollowDetection([current[0]], detected)).toBe(false);
  });

  it("does not follow a detection for sections the performer made by hand", () => {
    const byHand = [
      { id: "a", name: "Verse 1", start: 0, end: 16, mode: "continue" as const },
      { id: "b", name: "Chorus 1", start: 16, end: 32, mode: "continue" as const },
    ];
    expect(sectionsFollowDetection(byHand, detected)).toBe(false);
    expect(sectionsFollowDetection([], detected)).toBe(false);
  });
  const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it("turns each detected section into a continue section marked as detected", () => {
    expect(sectionsFromDetected(detected, ids())).toEqual([
      { id: "id-1", name: "Verse 1", start: 0, end: 16, mode: "continue", source: "detected" },
      { id: "id-2", name: "Chorus 1", start: 16, end: 32, mode: "continue", source: "detected" },
    ]);
  });

  it("applies the detected sections to a song with none", () => {
    expect(sectionsToApply([], detected, ids())?.map((s) => s.name)).toEqual(["Verse 1", "Chorus 1"]);
  });

  it("leaves a song that has sections alone, and applies nothing when nothing was found", () => {
    const made = [{ id: "a", name: "Intro", start: 0, end: 8, mode: "continue" as const }];
    expect(sectionsToApply(made, detected)).toBeNull();
    expect(sectionsToApply([], [])).toBeNull();
    expect(sectionsToApply([], undefined)).toBeNull();
  });
});

/** One block of a song: its bars, the chord root of each bar (repeated), and each stem's level, linear. */
interface Block {
  bars: number;
  roots: number[];
  mix: number;
  vocals: boolean;
  /** The vocals' level when they are present. */
  vocal?: number;
  drums: number;
  bass: number;
}

/** The units of a song given as blocks. Each bar's chroma is its root and fifth, with a little jitter, so bars of one chord agree. */
function songOf(blocks: readonly Block[], seed = 7): SectionUnit[] {
  const next = random(seed);
  const units: SectionUnit[] = [];
  let index = 0;
  for (const block of blocks) {
    for (let bar = 0; bar < block.bars; bar++, index++) {
      const root = block.roots[bar % block.roots.length];
      const chroma = Array.from({ length: 12 }, (_, pitch) => (pitch === root ? 1 : 0) + (pitch === (root + 7) % 12 ? 0.5 : 0) + 0.02 * next());
      units.push({
        start: index * BAR_S,
        end: (index + 1) * BAR_S,
        chroma,
        energy: block.mix * (1 + 0.05 * (next() - 0.5)),
        vocals: block.vocals,
        vocalEnergy: block.vocals ? (block.vocal ?? block.mix) : 0.001,
        drumEnergy: block.drums,
        bassEnergy: block.bass,
      });
    }
  }
  return units;
}

const VERSE = [9, 4, 0, 2];
const CHORUS = [0, 2, 9, 4];
const QUIET_DRUMS = 0.01;

describe("nameSections with vocals over every section", () => {
  const span = (kind: number, vocalEnergy: number, bass = 0.4, drums = 0.3) => ({
    from: 0,
    to: 1,
    vector: [],
    energy: vocalEnergy,
    vocalEnergy,
    vocals: true,
    kind,
    bassEnergy: bass,
    drumEnergy: drums,
  });

  it("names a middle section where the bass drops out a bridge, though the singer goes on", () => {
    const names = nameSections([span(0, 0.4), span(1, 0.8), span(0, 0.4), span(2, 0.5, 0.001), span(1, 0.8)]);
    expect(names).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Bridge", "Chorus 2"]);
  });

  it("names a loud section that is not a repeat a chorus, as a last chorus with other chords", () => {
    const names = nameSections([span(0, 0.4), span(1, 0.8), span(0, 0.4), span(1, 0.8), span(2, 0.82)]);
    expect(names).toEqual(["Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Chorus 3"]);
  });

  it("keeps a quieter section that is not a repeat a bridge", () => {
    const names = nameSections([span(0, 0.4), span(1, 0.8), span(0, 0.4), span(2, 0.5), span(1, 0.8)]);
    expect(names[3]).toBe("Bridge");
  });
});

describe("detectSections on songs whose sections share chords and vocals", () => {
  it("finds the verses and choruses of a ballad where the vocals run throughout and the chorus is louder", () => {
    const verse: Block = { bars: 8, roots: VERSE, mix: 0.5, vocals: true, vocal: 0.4, drums: 0.2, bass: 0.4 };
    const chorus: Block = { bars: 8, roots: CHORUS, mix: 0.9, vocals: true, vocal: 0.8, drums: 0.5, bass: 0.6 };
    const intro: Block = { bars: 8, roots: VERSE, mix: 0.3, vocals: false, drums: 0.05, bass: 0.3 };
    const sections = detectSections(songOf([intro, verse, chorus, verse, chorus]), BAR_DETECT);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2"]);
  });

  it("names a drum-free last section an outro, even while the vocals continue", () => {
    const verse: Block = { bars: 8, roots: VERSE, mix: 0.5, vocals: true, vocal: 0.4, drums: 0.2, bass: 0.4 };
    const chorus: Block = { bars: 8, roots: CHORUS, mix: 0.9, vocals: true, vocal: 0.8, drums: 0.5, bass: 0.6 };
    const intro: Block = { bars: 8, roots: VERSE, mix: 0.3, vocals: false, drums: 0.05, bass: 0.3 };
    const outro: Block = { bars: 8, roots: CHORUS, mix: 0.6, vocals: true, vocal: 0.5, drums: QUIET_DRUMS, bass: 0.4 };
    const sections = detectSections(songOf([intro, verse, chorus, verse, chorus, outro]), BAR_DETECT);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Verse 1", "Chorus 1", "Verse 2", "Chorus 2", "Outro"]);
  });

  it("says where the song's own drums and bass stop, and how loud each section is", () => {
    const verse: Block = { bars: 8, roots: VERSE, mix: 0.5, vocals: true, vocal: 0.4, drums: 0.2, bass: 0.4 };
    const chorus: Block = { bars: 8, roots: CHORUS, mix: 0.9, vocals: true, vocal: 0.8, drums: 0.5, bass: 0.6 };
    const intro: Block = { bars: 8, roots: VERSE, mix: 0.3, vocals: false, drums: 0.05, bass: 0.3 };
    const outro: Block = { bars: 8, roots: CHORUS, mix: 0.6, vocals: true, vocal: 0.5, drums: QUIET_DRUMS, bass: 0.4 };
    const sections = detectSections(songOf([intro, verse, chorus, verse, chorus, outro]), BAR_DETECT);
    const last = sections.at(-1)!;
    expect(last.drumsOff).toBe(true);
    expect(sections.filter((s) => s.name.startsWith("Chorus")).every((s) => !s.drumsOff && !s.bassOff)).toBe(true);
    const chorusLevel = sections.find((s) => s.name.startsWith("Chorus"))!.levelDb!;
    const verseLevel = sections.find((s) => s.name.startsWith("Verse"))!.levelDb!;
    expect(chorusLevel).toBeGreaterThan(verseLevel);
  });

  it("names an instrumental section where the bass drops out a bridge", () => {
    const verse: Block = { bars: 8, roots: VERSE, mix: 0.5, vocals: true, vocal: 0.4, drums: 0.2, bass: 0.4 };
    const chorus: Block = { bars: 8, roots: CHORUS, mix: 0.9, vocals: true, vocal: 0.8, drums: 0.5, bass: 0.6 };
    const intro: Block = { bars: 8, roots: VERSE, mix: 0.3, vocals: false, drums: 0.05, bass: 0.3 };
    const bridge: Block = { bars: 8, roots: [5, 7, 5, 7], mix: 0.6, vocals: false, drums: 0.3, bass: QUIET_DRUMS };
    const sections = detectSections(songOf([intro, verse, chorus, verse, bridge, chorus]), BAR_DETECT);
    expect(sections.map((s) => s.name)).toEqual(["Intro", "Verse 1", "Chorus 1", "Verse 2", "Bridge", "Chorus 2"]);
  });
});
