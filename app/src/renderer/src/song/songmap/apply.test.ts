import { describe, expect, it } from "vitest";
import { planSongMap, type SavedSong, type SongMapPart } from "./apply";
import type { SongMap } from "./songmap";

const blank: SavedSong = { bpm: "", options: {}, chart: "" };

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
    const saved: SavedSong = { bpm: "120", options: { firstBeat: 0.1, beats: 3 }, chart: "" };
    const plan = planSongMap(saved, mapWith({ bpm: 128.5, beatsPerBar: 4, firstBeat: 0.42 }));
    expect(plan.parts[0].replaces).toBe("Replaces 120 BPM, first beat 0:00.10, 3/4");
  });

  it("gives the key's name as the Performance screen saves it", () => {
    const plan = planSongMap(blank, mapWith({ key: { tonic: 6, mode: "minor", name: "Gb minor" } }));
    expect(plan.parts[0]).toEqual({ part: "key", summary: "Key F# minor", replaces: null });
  });

  it("says a saved key is replaced", () => {
    const plan = planSongMap({ bpm: "", options: { songKey: "A major" }, chart: "" }, mapWith({ key: { tonic: 9, mode: "minor", name: "A minor" } }));
    expect(plan.parts[0].replaces).toBe("Replaces A major");
  });

  it("says how many sections the song has now", () => {
    const saved: SavedSong = { bpm: "", options: { sections: [{ id: "a", name: "Intro", start: 0, end: 5, mode: "continue" }] }, chart: "" };
    const plan = planSongMap(saved, mapWith({ sections: [verse, chorus] }));
    expect(plan.parts.find((part) => part.part === "sections")).toEqual({ part: "sections", summary: "2 sections", replaces: "Replaces your 1 section" });
    expect(plan.parts.find((part) => part.part === "band")?.summary).toBe("Drums and bass for 2 sections");
  });

  it("counts the bass notes and says what they replace", () => {
    const saved: SavedSong = { bpm: "", options: { band: { bassOverrides: [{ start: 0, end: 1, pc: 0 }] } }, chart: "" };
    const plan = planSongMap(saved, mapWith({ bassNotes: [{ start: 0, end: 4, pc: 9 }, { start: 4, end: 8, pc: 2 }] }));
    expect(plan.parts[0]).toEqual({ part: "bassNotes", summary: "2 bass notes", replaces: "Replaces your 1 bass note" });
  });

  it("says the chart replaces a chart the song has, and not one it lacks", () => {
    const withChart = planSongMap({ bpm: "", options: {}, chart: "[Verse]\nA" }, mapWith({ chart: "[Verse]\nG" }));
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
    const saved: SavedSong = { bpm: "", options: { mixer: 2, tempoSource: "detected" }, chart: "" };
    const values = planSongMap(saved, full).values(["tempo"]);
    expect(values[":bpm"]).toBe("128.6");
    const options = optionsOf(values);
    expect(options).toMatchObject({ mixer: 2, tempoSource: "manual", firstBeat: 0.42, beats: 6, beatsSource: "manual" });
    expect(values[""]).toBeUndefined();
  });

  it("writes the key as the override name, and keeps the rest", () => {
    const values = planSongMap({ bpm: "", options: { tempoSource: "detected" }, chart: "" }, full).values(["key"]);
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

  it("writes nothing for the band without the sections", () => {
    expect(planSongMap(blank, full).values(["band"])).toEqual({});
  });

  it("drops band overrides for sections the map does not have", () => {
    const saved: SavedSong = {
      bpm: "",
      options: { band: { sections: { "old-1": { energy: 2 }, "map-1": { fills: 2 } } } },
      chart: "",
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

  it("gives the same values when the same map is applied twice", () => {
    const saved: SavedSong = { bpm: "120", options: { mixer: 2 }, chart: "" };
    const choice: SongMapPart[] = ["tempo", "key", "sections", "band", "bassNotes", "chart", "notes"];
    const once = planSongMap(saved, full).values(choice);
    const after: SavedSong = { bpm: once[":bpm"], options: JSON.parse(once[":options"]), chart: once[""] };
    const again = planSongMap(after, full).values(choice);
    // The options compare as parsed: the key order of an override can differ, the values cannot.
    expect({ ...again, ":options": undefined }).toEqual({ ...once, ":options": undefined });
    expect(optionsOf(again)).toEqual(optionsOf(once));
  });
});
