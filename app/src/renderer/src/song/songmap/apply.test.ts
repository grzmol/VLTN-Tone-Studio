import { describe, expect, it } from "vitest";
import { parseBandSettings } from "../band/arrangement";
import { planSongMap, type SavedSong, type SongMapPart } from "./apply";
import type { SongMap } from "./songmap";

const blank: SavedSong = { bpm: "", options: {}, chart: "", lyrics: "" };

/** A map with the given parts, and nothing else. */
function mapWith(extra: Partial<SongMap> = {}): SongMap {
  return { sections: [], bassNotes: [], extra: {}, ignored: [], ...extra };
}

/** Parses the `:options` value a plan writes. */
function optionsOf(values: Record<string, string>): Record<string, unknown> {
  return JSON.parse(values[":options"]);
}

const verse = { start: 0, end: 20, name: "Verse", drums: true, bass: "groove" as const };
const chorus = { start: 20, end: 40, name: "Chorus", drums: false, bass: "off" as const, energy: 4 as const, loud: 5 as const };

describe("planSongMap: the parts", () => {
  it("offers only the parts the map holds", () => {
    const plan = planSongMap(blank, mapWith());
    expect(plan.parts).toEqual([]);
  });

  it("offers the band only with sections", () => {
    const plan = planSongMap(blank, mapWith({ bassNotes: [{ start: 0, end: 4, pc: 9 }] }));
    expect(plan.parts.map((part) => part.part)).toEqual(["bassNotes"]);
  });

  it("describes the tempo with its meter and first beat", () => {
    const plan = planSongMap(blank, mapWith({ bpm: 128.5, beatsPerBar: 4, meterText: "4/4", firstBeat: 0.42 }));
    expect(plan.parts[0]).toEqual({ part: "tempo", summary: "Tempo 128.5 BPM, 4/4, first beat 0:00.42", replaces: null });
  });

  it("says what the tempo replaces when the saved values differ", () => {
    const saved: SavedSong = { bpm: "120", options: { firstBeat: 0.1, beats: 3 }, chart: "", lyrics: "" };
    const plan = planSongMap(saved, mapWith({ bpm: 128.5, beatsPerBar: 4, firstBeat: 0.42 }));
    expect(plan.parts[0].replaces).toBe("Replaces 120 BPM, first beat 0:00.10, 3/4");
  });

  it("gives the key's name as the Performance screen saves it", () => {
    const plan = planSongMap(blank, mapWith({ key: { tonic: 6, mode: "minor", name: "Gb minor" } }));
    expect(plan.parts[0]).toEqual({ part: "key", summary: "Key F# minor", replaces: null });
  });

  it("says a saved key is replaced", () => {
    const plan = planSongMap(
      { bpm: "", options: { songKey: "A major" }, chart: "", lyrics: "" },
      mapWith({ key: { tonic: 9, mode: "minor", name: "A minor" } }),
    );
    expect(plan.parts[0].replaces).toBe("Replaces A major");
  });

  it("says how many sections the song has now", () => {
    const saved: SavedSong = { bpm: "", options: { sections: [{ id: "a", name: "Intro", start: 0, end: 5, mode: "continue" }] }, chart: "", lyrics: "" };
    const plan = planSongMap(saved, mapWith({ sections: [verse, chorus] }));
    expect(plan.parts.find((part) => part.part === "sections")).toEqual({ part: "sections", summary: "2 sections", replaces: "Replaces your 1 section" });
    expect(plan.parts.find((part) => part.part === "band")?.summary).toBe("Drums and bass for 2 sections");
  });

  it("counts the bass notes and says what they replace", () => {
    const saved: SavedSong = { bpm: "", options: { band: { bassOverrides: [{ start: 0, end: 1, pc: 0 }] } }, chart: "", lyrics: "" };
    const plan = planSongMap(
      saved,
      mapWith({
        bassNotes: [
          { start: 0, end: 4, pc: 9 },
          { start: 4, end: 8, pc: 2 },
        ],
      }),
    );
    expect(plan.parts[0]).toEqual({ part: "bassNotes", summary: "2 bass notes", replaces: "Replaces your 1 bass note" });
  });

  it("says the chart replaces a chart the song has, and not one it lacks", () => {
    const withChart = planSongMap({ bpm: "", options: {}, chart: "[Verse]\nA", lyrics: "" }, mapWith({ chart: "[Verse]\nG" }));
    expect(withChart.parts[0].replaces).toBe("Replaces your chart");
    const without = planSongMap(blank, mapWith({ chart: "[Verse]\nG" }));
    expect(without.parts[0].replaces).toBeNull();
  });

  it("cuts a long notes summary to 60 characters", () => {
    const notes = "x".repeat(100);
    const plan = planSongMap(blank, mapWith({ notes }));
    // The summary is "Notes: " and then the text, cut to 60 characters.
    expect(plan.parts[0].summary).toHaveLength("Notes: ".length + 60);
    expect(plan.parts[0].summary.startsWith("Notes: ")).toBe(true);
    expect(plan.parts[0].summary.endsWith("…")).toBe(true);
  });
});

describe("planSongMap: the values", () => {
  const full = mapWith({
    bpm: 128.56,
    beatsPerBar: 6,
    meterText: "6/8",
    firstBeat: 0.42,
    key: { tonic: 6, mode: "minor", name: "F# minor" },
    style: "pop",
    sections: [verse, chorus],
    bassNotes: [{ start: 2, end: 4, pc: 7, octave: -1 }],
    chart: "[Verse]\nG",
    notes: "Hold the second chorus.",
  });

  it("gives no settings for an empty choice", () => {
    expect(planSongMap(blank, full).values([])).toEqual({});
  });

  it("writes the tempo to the tenth of a BPM, as manual, and keeps other options", () => {
    const saved: SavedSong = { bpm: "", options: { mixer: 2, tempoSource: "detected" }, chart: "", lyrics: "" };
    const values = planSongMap(saved, full).values(["tempo"]);
    expect(values[":bpm"]).toBe("128.6");
    const options = optionsOf(values);
    expect(options).toMatchObject({ mixer: 2, tempoSource: "manual", firstBeat: 0.42, beats: 6, beatsSource: "manual" });
    expect(values[""]).toBeUndefined();
  });

  it("writes the key as the override name, and keeps the rest", () => {
    const values = planSongMap({ bpm: "", options: { tempoSource: "detected" }, chart: "", lyrics: "" }, full).values(["key"]);
    expect(optionsOf(values)).toMatchObject({ songKey: "F# minor", tempoSource: "detected" });
  });

  it("writes one section per map section, with ids map-1 and onward", () => {
    const options = optionsOf(planSongMap(blank, full).values(["sections"]));
    expect(options.sections).toEqual([
      { id: "map-1", name: "Verse", start: 0, end: 20, mode: "continue" },
      { id: "map-2", name: "Chorus", start: 20, end: 40, mode: "continue" },
    ]);
  });

  it("writes drums and bass per section, and the song style, with the sections", () => {
    const options = optionsOf(planSongMap(blank, full).values(["sections", "band"]));
    const band = options.band as { style: string; sections: Record<string, unknown> };
    expect(band.style).toBe("pop");
    expect(band.sections["map-1"]).toEqual({ play: { drums: true, bass: true }, bassPart: "groove" });
    expect(band.sections["map-2"]).toEqual({ play: { drums: false, bass: false }, energy: 4, loud: 5 });
  });

  it("writes a section's fill size with its band", () => {
    const map = mapWith({ sections: [{ ...verse, fill: 2 }, { ...chorus, fill: true }], style: "pop" });
    const band = optionsOf(planSongMap(blank, map).values(["sections", "band"])).band as { sections: Record<string, { fill?: unknown }> };
    expect(band.sections["map-1"].fill).toBe(2);
    expect(band.sections["map-2"].fill).toBe(true);
  });

  it("writes a section's shape with its band", () => {
    const map = mapWith({ sections: [{ ...verse, shape: "build" }, chorus], style: "pop" });
    const band = optionsOf(planSongMap(blank, map).values(["sections", "band"])).band as { sections: Record<string, { shape?: unknown }> };
    expect(band.sections["map-1"].shape).toBe("build");
    expect(band.sections["map-2"].shape).toBeUndefined();
  });

  it("writes the song style with the band, and no section overrides, when the song has no sections yet", () => {
    const band = optionsOf(planSongMap(blank, full).values(["band"])).band as { style: string; sections: Record<string, unknown> };
    expect(band.style).toBe("pop");
    expect(band.sections).toEqual({});
  });

  it("drops band overrides for sections the map does not have", () => {
    const saved: SavedSong = {
      bpm: "",
      options: { band: { sections: { "old-1": { energy: 2 }, "map-1": { fills: 2 } } } },
      chart: "",
      lyrics: "",
    };
    const band = optionsOf(planSongMap(saved, full).values(["sections", "band"])).band as { sections: Record<string, unknown> };
    expect(Object.keys(band.sections)).toEqual(["map-1", "map-2"]);
    expect(band.sections["map-1"]).toMatchObject({ fills: 2, bassPart: "groove" });
  });

  it("writes the bass notes into the band and keeps the octave they give", () => {
    const band = optionsOf(planSongMap(blank, full).values(["bassNotes"])).band as { bassOverrides: unknown[] };
    expect(band.bassOverrides).toEqual([{ start: 2, end: 4, pc: 7, octave: -1 }]);
  });

  it("writes the chart with the empty suffix, and the notes into the options", () => {
    const values = planSongMap(blank, full).values(["chart", "notes"]);
    expect(values[""]).toBe("[Verse]\nG");
    expect(optionsOf(values).songMapNotes).toBe("Hold the second chorus.");
  });

  it("writes only the chosen parts", () => {
    const values = planSongMap(blank, full).values(["chart"] as SongMapPart[]);
    expect(Object.keys(values)).toEqual([""]);
  });

  it("offers nothing the second time the same map is applied", () => {
    const saved: SavedSong = { bpm: "120", options: { mixer: 2 }, chart: "", lyrics: "" };
    const choice: SongMapPart[] = ["tempo", "key", "sections", "band", "bassNotes", "chart", "notes"];
    const once = planSongMap(saved, full).values(choice);
    const after: SavedSong = { bpm: once[":bpm"], options: JSON.parse(once[":options"]), chart: once[""], lyrics: "" };
    const second = planSongMap(after, full);
    expect(second.parts).toEqual([]);
    expect(second.values(choice)).toEqual({});
  });
});

describe("planSongMap: keeping the song's sections", () => {
  const kept: SavedSong = {
    bpm: "",
    options: {
      sections: [
        { id: "x7f", name: "Verse 1", start: 0, end: 10, mode: "loop", color: "#ff0000" },
        { id: "q2", name: "Chorus", start: 10, end: 20, mode: "skip" },
      ],
    },
    chart: "",
    lyrics: "",
  };

  it("keeps a saved section's id, mode and colour, and takes the map's name and times", () => {
    const map = mapWith({
      sections: [
        { start: 0, end: 12, name: "Verse" },
        { start: 10, end: 20, name: "Chorus" },
      ],
    });
    const plan = planSongMap(kept, map);
    expect(plan.parts.find((part) => part.part === "sections")?.replaces).toBe("Replaces your 2 sections");
    expect(optionsOf(plan.values(["sections"])).sections).toEqual([
      { id: "x7f", name: "Verse", start: 0, end: 12, mode: "loop", color: "#ff0000" },
      { id: "q2", name: "Chorus", start: 10, end: 20, mode: "skip" },
    ]);
  });

  it("gives a new section an id that no kept section has", () => {
    const saved: SavedSong = { bpm: "", options: { sections: [{ id: "map-1", name: "Chorus", start: 20, end: 40, mode: "continue" }] }, chart: "", lyrics: "" };
    const map = mapWith({
      sections: [
        { start: 0, end: 20, name: "Intro" },
        { start: 20, end: 40, name: "Chorus" },
      ],
    });
    const sections = optionsOf(planSongMap(saved, map).values(["sections"])).sections as { id: string; name: string }[];
    expect(sections.map((section) => [section.name, section.id])).toEqual([
      ["Intro", "map-2"],
      ["Chorus", "map-1"],
    ]);
  });

  it("offers no sections part when the list is the same", () => {
    const saved: SavedSong = { bpm: "", options: { sections: [{ id: "a", name: "Verse", start: 0, end: 20, mode: "continue" }] }, chart: "", lyrics: "" };
    const plan = planSongMap(saved, mapWith({ sections: [{ start: 0, end: 20, name: "Verse" }] }));
    expect(plan.parts.map((part) => part.part)).not.toContain("sections");
  });

  it("keeps the band override of a kept section under its id", () => {
    const saved: SavedSong = {
      bpm: "",
      options: { sections: kept.options.sections, band: parseBandSettings({ sections: { x7f: { style: "funk" } } }) },
      chart: "",
      lyrics: "",
    };
    const map = mapWith({ sections: [{ start: 0, end: 10, name: "Verse 1", drums: false }] });
    const band = optionsOf(planSongMap(saved, map).values(["sections", "band"])).band as { sections: Record<string, { style?: string; play?: unknown }> };
    expect(band.sections.x7f).toMatchObject({ style: "funk", play: { drums: false, bass: true } });
    expect(Object.keys(band.sections)).toEqual(["x7f"]);
  });
});

describe("planSongMap: parts that would change nothing", () => {
  it("offers no tempo when the values match, and writes no source", () => {
    const saved: SavedSong = { bpm: "120", options: { firstBeat: 0.42, beats: 4, tempoSource: "detected" }, chart: "", lyrics: "" };
    const plan = planSongMap(saved, mapWith({ bpm: 120.04, firstBeat: 0.42, beatsPerBar: 4 }));
    expect(plan.parts.map((part) => part.part)).not.toContain("tempo");
    expect(plan.values(["tempo"])).toEqual({});
  });

  it("writes only the tempo value that differs, and only its source", () => {
    const saved: SavedSong = { bpm: "120", options: { firstBeat: 0.42, beats: 3, tempoSource: "detected", beatsSource: "detected" }, chart: "", lyrics: "" };
    const plan = planSongMap(saved, mapWith({ bpm: 120, firstBeat: 0.42, beatsPerBar: 4 }));
    expect(plan.parts[0]).toEqual({ part: "tempo", summary: "Tempo 4/4", replaces: "Replaces 3/4" });
    const values = plan.values(["tempo"]);
    expect(values[":bpm"]).toBeUndefined();
    expect(optionsOf(values)).toMatchObject({ beats: 4, beatsSource: "manual", tempoSource: "detected", firstBeat: 0.42 });
  });

  it("offers no chart that is only the song's lyrics", () => {
    const saved: SavedSong = { bpm: "", options: {}, chart: "", lyrics: "[Verse]\nG" };
    expect(planSongMap(saved, mapWith({ chart: "[Verse]\nG" })).parts).toEqual([]);
    expect(planSongMap(saved, mapWith({ chart: "[Verse]\nA" })).parts.map((part) => part.part)).toEqual(["chart"]);
  });

  it("offers no key, notes or bass notes that are already saved", () => {
    const saved: SavedSong = {
      bpm: "",
      options: {
        songKey: "F# minor",
        songMapNotes: "Hold the second chorus.",
        band: parseBandSettings({ bassOverrides: [{ start: 2, end: 4, pc: 7, octave: -1 }] }),
      },
      chart: "",
      lyrics: "",
    };
    const map = mapWith({
      key: { tonic: 6, mode: "minor", name: "F# minor" },
      notes: "Hold the second chorus.",
      bassNotes: [{ start: 2, end: 4, pc: 7, octave: -1 }],
    });
    expect(planSongMap(saved, map).parts).toEqual([]);
  });
});

describe("planSongMap: marks", () => {
  // 120 BPM in 4/4 from 0: a bar is 2 s. The chorus starts at 20 s, which is bar 11.
  const sections = [
    { start: 0, end: 20, name: "Verse" },
    { start: 20, end: 40, name: "Chorus 2" },
  ];
  const song: SavedSong = { bpm: "120", options: { firstBeat: 0, beats: 4 }, chart: "", lyrics: "" };

  it("turns a named bar into the time of that bar, and keeps a timed one", () => {
    const plan = planSongMap(song, mapWith({ sections, marks: [{ kind: "stop", beats: 2, bar: { section: "Chorus 2", number: 8 } }, { kind: "hit", time: 5 }] }));
    const marks = plan.parts.find((part) => part.part === "marks");
    expect(marks).toEqual({ part: "marks", summary: "2 marks", replaces: null });
    // Bar 8 of a chorus that starts on bar 11 is the song's bar 18, which starts at 34 s.
    expect(parseBandSettings(optionsOf(plan.values(["marks"])).band).marks).toEqual([
      { time: 5, kind: "hit" },
      { time: 34, kind: "stop", beats: 2 },
    ]);
  });

  it("counts a named bar on the song's own beat grid when it has one", () => {
    const grid = { beatsPerBar: 4, beats: Array.from({ length: 80 }, (_, i) => i * 0.5 + 0.1), downbeat: 0, bpm: 120, steady: null };
    const plan = planSongMap({ ...song, options: { beatGrid: grid } }, mapWith({ sections, marks: [{ kind: "fill", bar: { section: "Chorus 2", number: 2 } }] }));
    expect(parseBandSettings(optionsOf(plan.values(["marks"])).band).marks).toEqual([{ time: 22.1, kind: "fill" }]);
  });

  it("leaves out a mark whose bar is past the end of the song, or that has no tempo to count on", () => {
    const past = planSongMap(song, mapWith({ sections, marks: [{ kind: "stop", bar: { section: "Chorus 2", number: 99 } }] }));
    expect(past.parts.find((part) => part.part === "marks")).toBeUndefined();
    const noTempo = planSongMap(blank, mapWith({ sections, marks: [{ kind: "stop", bar: { section: "Chorus 2", number: 2 } }] }));
    expect(noTempo.parts.find((part) => part.part === "marks")).toBeUndefined();
  });

  it("says the marks it replaces, and offers nothing when the song has the same marks", () => {
    const saved = { ...song, options: { ...song.options, band: { marks: [{ time: 5, kind: "hit" }] } } };
    const plan = planSongMap(saved, mapWith({ marks: [{ kind: "crash", time: 8 }] }));
    expect(plan.parts.find((part) => part.part === "marks")?.replaces).toBe("Replaces your 1 mark");
    expect(planSongMap(saved, mapWith({ marks: [{ kind: "hit", time: 5 }] })).parts).toEqual([]);
  });

  it("writes only the marks, and keeps the rest of the band, when only they are chosen", () => {
    const saved = { ...song, options: { ...song.options, band: { style: "metal", seed: 9 } } };
    const plan = planSongMap(saved, mapWith({ marks: [{ kind: "crash", time: 8 }] }));
    const band = parseBandSettings(optionsOf(plan.values(["marks"])).band);
    expect(band).toMatchObject({ style: "metal", seed: 9, marks: [{ time: 8, kind: "crash" }] });
    expect(plan.values([])).toEqual({});
  });
});
