import { describe, expect, it } from "vitest";
import { parseBandSettings } from "../band/arrangement";
import { planSongMap, type SavedSong, type SongMapPart } from "./apply";
import { draftSongMap, songBrief, type BriefInput } from "./brief";
import { parseSongMap, writeSongMap } from "./songmap";

/** Eight bars of four beats, starting at half a second: bar 2 starts at 2.5 s. */
const beats = Array.from({ length: 32 }, (_, index) => 0.5 + index * 0.5);
const beatGrid = { beatsPerBar: 4, beats, downbeat: 0 };

const analysis = {
  audioId: "audio-1",
  version: 5,
  tempo: { bpm: 120, firstBeat: 0.5, steady: true },
  meter: { beatsPerBar: 4, confidence: 0.9 },
  loudness: { lufs: -14.2, peakDb: -1 },
  key: { source: "harmony", estimate: { name: "A minor" } },
  chords: {
    source: "harmony",
    chords: [
      { time: 0.5, name: "A", confidence: 0.9 },
      { time: 2.6, name: "E", confidence: 0.8 },
    ],
  },
  bassLine: {
    tuningCents: 0,
    beats: [
      { beat: 4, pc: 4, confidence: 0.9 },
      { beat: 5, pc: null, confidence: 0 },
      { beat: 6, pc: 9, confidence: 0.2 },
    ],
  },
  sections: [
    { start: 0, end: 10, name: "Intro", drumsOff: true, levelDb: -6 },
    { start: 10, end: 20, name: "Verse", bassOff: true, levelDb: -1.5 },
  ],
};

/** A song as the import leaves it: map ids, `continue` modes, and the band's choices keyed by those ids. */
const savedOptions: Record<string, unknown> = {
  songKey: "A minor",
  firstBeat: 0.5,
  beats: 4,
  beatsSource: "manual",
  tempoSource: "manual",
  songMapNotes: "Lift the bridge.",
  sections: [
    { id: "map-1", name: "Verse", start: 0, end: 10, mode: "continue" },
    { id: "map-2", name: "Chorus", start: 10, end: 20, mode: "continue" },
  ],
  band: parseBandSettings({
    sections: {
      "map-1": { style: "funk", energy: 4, play: { drums: false, bass: true }, bassPart: "groove" },
      "map-2": { play: { drums: true, bass: false } },
    },
    bassOverrides: [
      { start: 2, end: 4, pc: 7 },
      { start: 4, end: 6, pc: 0, octave: 1 },
    ],
  }),
  beatGrid,
  analysis,
};

const fullSong: BriefInput = {
  title: "Test song",
  durationSeconds: 61.2,
  bpm: "120",
  options: savedOptions,
  chart: "[00:00.50] [Am]Hello\n[00:10.00] [F]World",
  lyrics: "[00:00.50] Hello from the vocals",
};

/** The draft map's text out of a brief: the part between the four-backtick fences. */
function draftText(brief: string): string {
  const match = /````markdown\n([\s\S]*?)````/.exec(brief);
  if (!match) throw new Error("The brief has no draft map");
  return match[1];
}

describe("songBrief", () => {
  it("gives the header, the intro and the draft for a bare song, and nothing it does not have", () => {
    const brief = songBrief({ title: "Bare", durationSeconds: 30, bpm: "", options: {}, chart: "", lyrics: "" });
    expect(brief.startsWith("# Song brief: Bare\n")).toBe(true);
    expect(brief).toContain("This is what VLTN Tone Studio found in this song.");
    expect(brief).toContain("- Length: 0:30.00");
    expect(brief).toContain("## Draft song map");
    expect(brief).not.toContain("## Bars");
    expect(brief).not.toContain("## Chords");
    expect(brief).not.toContain("## Bass notes heard");
    expect(brief).not.toContain("## Lyrics as transcribed");
    expect(brief).not.toContain("## Detected sections");
  });

  it("gives every part of a song that has everything", () => {
    const brief = songBrief(fullSong);
    for (const heading of [
      "## What the app found",
      "## Bars",
      "## Detected sections",
      "## Chords",
      "## Bass notes heard",
      "## Lyrics as transcribed",
      "## Draft song map",
    ]) {
      expect(brief).toContain(heading);
    }
    expect(brief).toContain("- Tempo: 120 BPM");
    expect(brief).toContain("- Key: A minor");
    expect(brief).toContain("- Loudness: -14.2 LUFS");
  });

  it("groups the bars eight to a line", () => {
    const brief = songBrief(fullSong);
    expect(brief).toMatch(/^Bars 1–8: 0:00\.50 0:02\.50 /m);
    const longer = songBrief({
      ...fullSong,
      options: { ...savedOptions, beatGrid: { beatsPerBar: 4, beats: [...beats, ...beats.map((b) => b + 16)], downbeat: 0 } },
    });
    expect(longer).toMatch(/^Bars 9–16: /m);
  });

  it("lists each bar's chords, with the time of each", () => {
    expect(songBrief(fullSong)).toContain("Bar 1 0:00.50: A 0:00.50");
    expect(songBrief(fullSong)).toContain("Bar 2 0:02.50: E 0:02.60");
    expect(songBrief(fullSong)).toContain("Bar 3 0:04.50: -");
  });

  it("shows the bass notes the app is sure of, and a dash where it is not", () => {
    // Bar 2 covers beats 4 to 7: a sure E, a silent beat, an unsure A, and a beat with no reading.
    expect(songBrief(fullSong)).toContain("Bar 2 0:02.50: E - - -");
  });

  it("lists chords by time when there is no grid", () => {
    const brief = songBrief({ ...fullSong, options: { ...savedOptions, beatGrid: undefined } });
    expect(brief).toContain("- A 0:00.50");
    expect(brief).toContain("- E 0:02.60");
    expect(brief).not.toContain("## Bass notes heard");
    expect(brief).not.toContain("## Bars");
  });

  it("keeps the lyrics in a four-backtick fence", () => {
    expect(songBrief(fullSong)).toContain("````\n[00:00.50] Hello from the vocals\n````");
  });
});

describe("draftSongMap", () => {
  it("holds the saved sections, the band's choices, the bass notes, the chart and the notes", () => {
    const map = draftSongMap(fullSong);
    expect(map.sections.map((section) => section.name)).toEqual(["Verse", "Chorus"]);
    expect(map.sections[0]).toMatchObject({ start: 0, end: 10, bass: "groove", drums: false, style: "funk", energy: 4 });
    expect(map.sections[1]).toMatchObject({ drums: true, bass: "off" });
    expect(map.bassNotes).toEqual([
      { start: 2, end: 4, pc: 7 },
      { start: 4, end: 6, pc: 0, octave: 1 },
    ]);
    expect(map.chart).toBe(fullSong.chart);
    expect(map.notes).toBe("Lift the bridge.");
    expect(map.key).toMatchObject({ name: "A minor", tonic: 9, mode: "minor" });
    expect(map.bpm).toBe(120);
    expect(map.beatsPerBar).toBe(4);
    expect(map.firstBeat).toBe(0.5);
  });

  it("uses the detected sections when the song has none, and marks the silent drums and bass", () => {
    const map = draftSongMap({ ...fullSong, options: { ...savedOptions, sections: undefined } });
    expect(map.sections).toEqual([
      { start: 0, end: 10, name: "Intro", drums: false },
      { start: 10, end: 20, name: "Verse", bass: "off" },
    ]);
  });

  it("uses the lyrics chart when the song has no chart", () => {
    expect(draftSongMap({ ...fullSong, chart: "" }).chart).toBe(fullSong.lyrics);
  });

  it("leaves out a tempo the song does not have", () => {
    const map = draftSongMap({ ...fullSong, bpm: "", options: {} });
    expect(map.bpm).toBeUndefined();
    expect(map.firstBeat).toBeUndefined();
    expect(map.beatsPerBar).toBeUndefined();
  });
});

describe("the brief's draft map", () => {
  it("reads back with no problems and holds the song's parts", () => {
    const result = parseSongMap(draftText(songBrief(fullSong)));
    expect(result.problems).toEqual([]);
    expect(result.map?.sections).toHaveLength(2);
    expect(result.map?.bassNotes).toHaveLength(2);
    expect(result.map?.chart).toBe(fullSong.chart);
  });

  it("keeps the chart fence intact inside the outer fence", () => {
    const brief = songBrief(fullSong);
    expect(brief).toContain("```chart\n[00:00.50] [Am]Hello");
    expect(parseSongMap(draftText(brief)).map?.chart).toBe(fullSong.chart);
  });

  it("offers nothing when the draft is imported unchanged, so nothing is written", () => {
    const saved: SavedSong = { bpm: "120", options: savedOptions, chart: fullSong.chart, lyrics: fullSong.lyrics };
    const map = parseSongMap(draftText(songBrief(fullSong))).map;
    expect(map).not.toBeNull();
    const plan = planSongMap(saved, map!);
    expect(plan.parts).toEqual([]);
    expect(plan.values([])).toEqual({});
  });
});

describe("a song the app made itself", () => {
  // The song as the analysis and the Performance screen save it: analysis section ids, a loop mode, a colour, lyrics only, band overrides.
  const madeOptions: Record<string, unknown> = {
    songKey: "A minor",
    firstBeat: 0.5,
    beats: 4,
    analysis,
    sections: [
      { id: "x7f", name: "Verse", start: 0, end: 10, mode: "loop", color: "#ff0000" },
      { id: "q2", name: "Chorus", start: 10, end: 20, mode: "skip", source: "detected" },
    ],
    band: parseBandSettings({
      sections: { x7f: { style: "funk", play: { drums: false, bass: true } }, q2: { energy: 4 } },
      bassOverrides: [{ start: 2, end: 4, pc: 7 }],
    }),
    beatGrid,
  };
  const madeInput: BriefInput = { title: "Made", durationSeconds: 20, bpm: "120", options: madeOptions, chart: "", lyrics: "[00:00.50] Hello" };
  const madeSaved: SavedSong = { bpm: "120", options: madeOptions, chart: "", lyrics: madeInput.lyrics };
  const everyPart: SongMapPart[] = ["tempo", "key", "sections", "band", "bassNotes", "chart", "notes"];

  it("offers no part when the draft is imported unchanged", () => {
    const map = parseSongMap(writeSongMap(draftSongMap(madeInput))).map!;
    const plan = planSongMap(madeSaved, map);
    expect(plan.parts).toEqual([]);
    expect(plan.values(everyPart)).toEqual({});
  });

  it("offers only the drums and bass that were changed, and keeps the sections", () => {
    const map = parseSongMap(writeSongMap(draftSongMap(madeInput))).map!;
    map.sections[0].drums = true;
    const plan = planSongMap(madeSaved, map);
    expect(plan.parts.map((part) => part.part)).toEqual(["band"]);
    const options = JSON.parse(plan.values(["band"])[":options"]);
    expect(options.sections).toEqual(JSON.parse(JSON.stringify(madeOptions.sections)));
    expect(options.band.sections.x7f.play).toEqual({ drums: true, bass: true });
  });

  it("writes the song's marks in the draft, and imports them back unchanged", () => {
    const marked = {
      ...madeOptions,
      band: parseBandSettings({
        marks: [
          { time: 4.5, kind: "stop", beats: 2 },
          { time: 8.5, kind: "no-fill" },
        ],
      }),
    };
    const input: BriefInput = { ...madeInput, options: marked };
    const text = writeSongMap(draftSongMap(input));
    expect(text).toContain("## Marks");
    expect(text).toContain("| 0:04.50 | stop | 2 |");
    const map = parseSongMap(text).map!;
    expect(map.marks).toEqual([
      { kind: "stop", beats: 2, time: 4.5 },
      { kind: "no-fill", time: 8.5 },
    ]);
    expect(planSongMap({ ...madeSaved, options: marked }, map).parts.map((part) => part.part)).not.toContain("marks");
    expect(songBrief(input)).toContain("`## Marks`");
  });
});
