import { describe, expect, it } from "vitest";
import { parseChart } from "./chart";
import { midiPreflight } from "./midi-preflight";
const options = { duration: 10, clock: false, pedals: [], outputName: "Test MIDI" };
it("identifies past-end cues and missing note-offs, accepting velocity-zero note releases", () => {
  const report = midiPreflight(
    parseChart("[00:00] {midi:note 2 60 100}\n[00:01] {midi:note 2 60 0}\n[00:02] {midi:note 3 61 100}\n[00:11] {midi:off 3 61 0}"),
    options,
  );
  expect(report.issues.map((i) => i.code)).toEqual(["past-end", "note-off"]);
  expect(report.channels).toEqual([
    [2, 2],
    [3, 2],
  ]);
});
it("reports simultaneous conflicts/duplicates without rewriting intentional command order", () => {
  const cues = parseChart("[00:00] {midi:cc 1 0 0} {midi:pc 1 1} {midi:pc 1 2} {midi:cc 1 12 5} {midi:cc 1 12 5}");
  const before = JSON.stringify(cues),
    report = midiPreflight(cues, options);
  expect(report.issues.map((i) => i.code)).toEqual(["conflict", "duplicate"]);
  expect(JSON.stringify(cues)).toBe(before);
});
it("finds configured pedal-channel collisions, saved-channel mismatches and automatic tempo conflicts", () => {
  const cues = parseChart("[00:00] {label:Pedal A: recall} {midi:pc 1 1}\n[00:01] {label:Pedal B: recall} {midi:pc 2 1}\n[00:02] {midi:cc 1 74 90}");
  const report = midiPreflight(cues, {
    ...options,
    tempoChannel: 1,
    pedals: [
      { name: "Pedal A", channel: 1 },
      { name: "Pedal B", channel: 1 },
    ],
  });
  expect(report.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["channel-collision", "saved-channel", "tempo-channel", "tempo-conflict"]));
});
it("warns about dense wire traffic and known GP-180 continuous clock limitations", () => {
  const cues = parseChart("[00:00] " + Array.from({ length: 30 }, (_, i) => `{midi:cc 1 ${i} 127}`).join(" "));
  expect(midiPreflight(cues, { ...options, clock: true, outputName: "Bluetooth GP-180" }).issues.map((i) => i.code)).toEqual(
    expect.arrayContaining(["burst", "clock"]),
  );
});
it("does not invent warnings for a simple complete chart", () => {
  expect(midiPreflight(parseChart("[00:00] {midi:pc 1 1}\n[00:01] {midi:note 2 60 100}\n[00:02] {midi:off 2 60 0}"), options).issues).toEqual([]);
});

it.each(["GP-150", "GP-180"])("recognizes %s for shared tempo and clock advice", (model) => {
  const cues = parseChart(`[00:00] {label:Valeton ${model}: Recall memory 001} {midi:pc 16 0}`);
  const result = midiPreflight(cues, { ...options, tempoChannel: 16, clock: true, outputName: model, pedals: [{ name: `Valeton ${model}`, channel: 16 }] });
  expect(result.issues.some((i) => i.code === "tempo-channel")).toBe(false);
  expect(result.issues.some((i) => i.code === "clock")).toBe(true);
});
it("warns when a press and release CC would be replayed when starting mid-song, unless it is marked {nochase}", () => {
  const options = { duration: 100, clock: false, outputName: "Out", pedals: [] };
  const warned = (text: string) => midiPreflight(parseChart(text), options).issues.some((i) => i.code === "chase-momentary");
  expect(warned("[00:10] {midi:cc 1 20 127}\n[00:10.2] {midi:cc 1 20 0}")).toBe(true);
  expect(warned("[00:10] {nochase} {midi:cc 1 20 127}\n[00:10.2] {nochase} {midi:cc 1 20 0}")).toBe(false);
  expect(warned("[00:10] {midi:cc 1 20 127}\n[00:40] {midi:cc 1 20 0}")).toBe(false);
});

it("warns about sections that are not on a bar line, past the audio, or overlapping", () => {
  const sections = [
    { id: "a", name: "Intro", start: 0, end: 8.5, mode: "continue" as const },
    { id: "b", name: "Verse", start: 8, end: 40, mode: "loop" as const },
  ];
  const report = midiPreflight([], { duration: 30, clock: false, pedals: [], sections, bpm: 120, beats: 4, firstBeat: 0 });
  const codes = report.issues.map((i) => i.code);
  expect(codes).toEqual(expect.arrayContaining(["section-range", "section-overlap", "section-bar"]));
});

it("warns about cues outside a trimmed range, which never fire", () => {
  const cues = parseChart("[00:01] {midi:pc 2 1}\n[00:05] {midi:pc 2 2}\n[00:09] {midi:pc 2 3}");
  const report = midiPreflight(cues, { ...options, range: { start: 2, end: 6 } });
  expect(report.issues.map((i) => i.code)).toEqual(["cue-trim"]);
  expect(report.issues[0].text).toContain("2 cues outside the trimmed range");
  expect(report.issues[0].text).toContain("starting at 1.00 s");
});

it("warns about a section that is cut by the trimmed range", () => {
  const report = midiPreflight([], {
    ...options,
    range: { start: 2, end: 6 },
    sections: [{ id: "a", name: "Verse", start: 1, end: 4, mode: "continue" }],
  });
  expect(report.issues.map((i) => i.code)).toEqual(["section-trim"]);
});

it("flags Start, Continue and Stop cues when app clock is on, and checks triggers without a time", () => {
  const cues = parseChart("[00:00] {midi:stop}\n{midi@load: start}\n[00:01] {midi:pc 1 1}");
  expect(midiPreflight(cues, { ...options, clock: true }).issues.map((i) => i.code)).toEqual(["transport-conflict"]);
  expect(midiPreflight(cues, options).issues.map((i) => i.code)).toEqual([]);
});
it("keeps triggers off the timeline, so a trigger at the start is not counted as a cue", () => {
  const report = midiPreflight(parseChart("{midi@end: pc 1 9}\n[00:11] {midi:pc 1 1}"), options);
  expect(report.issues.map((i) => i.code)).toEqual(["past-end"]);
  expect(report.commands).toBe(1);
});

describe("MIDI timecode preflight", () => {
  const cues = parseChart("[00:00] {midi:pc 1 1}");
  const base = { duration: 10, clock: false, pedals: [] };

  it("is silent while timecode is off", () => {
    expect(midiPreflight(cues, base).issues.filter((i) => i.code.startsWith("timecode"))).toEqual([]);
  });

  it("warns over Bluetooth, and not over USB", () => {
    const ble = midiPreflight(cues, { ...base, timecode: { fps: 25, offset: "", bluetooth: true } });
    expect(ble.issues.map((i) => i.code)).toContain("timecode-bluetooth");
    const usb = midiPreflight(cues, { ...base, timecode: { fps: 25, offset: "", bluetooth: false } });
    expect(usb.issues.map((i) => i.code)).not.toContain("timecode-bluetooth");
  });

  it("refuses an offset whose frame field is not below the rate", () => {
    const report = midiPreflight(cues, { ...base, timecode: { fps: 24, offset: "00:00:00:24", bluetooth: false } });
    expect(report.issues).toContainEqual({ code: "timecode-offset", text: "Timecode offset: Frames must be 0 to 23 at 24 fps." });
  });

  it("flags app clock sent alongside timecode", () => {
    const report = midiPreflight(cues, { ...base, clock: true, timecode: { fps: 25, offset: "", bluetooth: false } });
    expect(report.issues.map((i) => i.code)).toContain("timecode-clock");
  });
});
it("warns about a raw CC that would be chased while a pedal on its channel has unassigned trigger commands", () => {
  const pedals = [{ name: "BOSS RC-10R", channel: 2, unassigned: 15, triggers: [] }];
  const codes = (text: string) => midiPreflight(parseChart(text), { ...options, pedals }).issues.map((i) => i.code);
  expect(codes("[00:10] {midi:cc 2 11 90}")).toEqual(["chase-unassigned-trigger"]);
  expect(codes("[00:10] {nochase} {midi:cc 2 11 90}")).toEqual([]);
  expect(codes("[00:10] {midi:cc 3 11 90}")).toEqual([]);
});
it("says a raw CC matching an assigned trigger is skipped by the chase unless its cue says {chase}", () => {
  const pedals = [{ name: "BOSS RC-10R", channel: 2, unassigned: 0, triggers: [[2, 70] as [number, number]] }];
  const report = (text: string) => midiPreflight(parseChart(text), { ...options, pedals });
  expect(report("[00:03] {midi:cc 2 70 127}").issues.map((i) => i.code)).toEqual(["chase-assigned-trigger"]);
  expect(report("[00:03] {chase} {midi:cc 2 70 127}").issues).toEqual([]);
});
