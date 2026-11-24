import { describe, expect, it } from "vitest";
import { parseChart } from "./chart";
import { computeChaseState } from "./midi-chase";
import { MidiSchedule, type SchedulerReply } from "./midi-scheduler";
import {
  automaticRhythmSettings,
  currentRhythmAutomation,
  currentRhythmChart,
  buildRhythmAutomation,
  replaceRhythmAutomation,
  suggestRhythmAutomation,
  type RhythmAutomationSong,
} from "./rhythm-automation";

const controls = { channel: 2, start: 80, division: 81, fill: 82, stop: 83 };
const sections = [
  ["intro", "Intro", 0, 2],
  ["v1", "Verse 1", 2, 10],
  ["c1", "Chorus 1", 10, 18],
  ["v2", "Verse 2", 18, 26],
  ["v3", "Verse 3", 26, 34],
  ["outro", "Outro", 34, 36],
].map(([id, name, start, end]) => ({ id, name, start, end, mode: "continue" }));
function song(patch: Record<string, unknown> = {}): RhythmAutomationSong {
  return {
    key: "vltn.song:one",
    title: "Song",
    duration: 36,
    settings: {
      "": "[00:03] [C] Keep these lyrics\n[00:05] {midi:pc 4 7}",
      ":bpm": "120",
      ":options": JSON.stringify({
        firstBeat: 0,
        beats: 4,
        sections,
        rhythmExport: { version: 1, bpm: 120, meter: "4/4", parts: { intro: { bars: 1 }, pattern2: { source: "c1" } } },
        ...patch,
      }),
    },
  };
}
const setup = (input = song(), memory = 1) => suggestRhythmAutomation(input, memory);
function automated(input = song()): RhythmAutomationSong {
  const draft = setup(input);
  const options = JSON.parse(input.settings[":options"]);
  return {
    ...input,
    settings: {
      ...input.settings,
      "": buildRhythmAutomation(input, draft, controls).chart,
      ":options": JSON.stringify({ ...options, rhythmAutomation: automaticRhythmSettings(input, draft, controls) }),
    },
  };
}

describe("automatic pedal rhythm cues", () => {
  it("selects a memory, starts, changes with fills, fills on a repeated pattern, and stops with an ending", () => {
    const input = song();
    const plan = buildRhythmAutomation(input, setup(input, 3), controls);
    expect(plan.events).toEqual([
      { time: "load", label: "RC-10R: Recall memory 3", commands: ["pc 2 2"] },
      { time: 0, label: "RC-10R: Start rhythm", commands: ["cc 2 80 127", "cc 2 80 0"] },
      { time: 8, label: "RC-10R: Change to Pattern 2 for Chorus 1", commands: ["cc 2 81 127", "cc 2 81 0"] },
      { time: 16, label: "RC-10R: Change to Pattern 1 for Verse 2", commands: ["cc 2 81 127", "cc 2 81 0"] },
      { time: 24, label: "RC-10R: Fill for Verse 3", commands: ["cc 2 82 127", "cc 2 82 0"] },
      { time: 33.9, label: "RC-10R: Play ending and stop", commands: ["cc 2 83 127", "cc 2 83 0"] },
      { time: "stop", label: "RC-10R: Stop when playback stops", commands: ["cc 2 83 127", "cc 2 83 0"] },
    ]);
    expect(plan.firstPattern).toBe(1);
    const parsed = parseChart(plan.chart);
    expect(parsed.filter((cue) => cue.trigger === "load")[0].messages).toEqual([[0xc1, 2]]);
    expect(parsed.filter((cue) => cue.trigger === "stop").flatMap((cue) => cue.messages)).toEqual([
      [0xb1, 83, 127],
      [0xb1, 83, 0],
    ]);
    // Only the performer's unrelated PC is chased, never generated start/fill/division/stop controls.
    expect(computeChaseState(parsed, 35).map((message) => message.bytes)).toEqual([[0xc3, 7]]);
    expect(plan.chart.startsWith(input.settings[""])).toBe(true);
  });
  it.each([1, 2, 3, 4, 5, 6, 99])("maps phrase memory %s to a zero-based PC without bank select", (memory) => {
    const input = song();
    expect(buildRhythmAutomation(input, setup(input, memory), controls).events[0].commands).toEqual([`pc 2 ${memory - 1}`]);
  });
  it("delivers start, both pattern changes, fill and ending once in order through the performance scheduler", () => {
    const input = song();
    const plan = buildRhythmAutomation(input, setup(input), controls);
    const replies: SchedulerReply[] = [];
    const schedule = new MidiSchedule(
      { cues: parseChart(plan.chart), position: 0, duration: input.duration, origin: 1000, bpm: 120, clock: false, tempo: null },
      1000,
      (reply) => replies.push(reply),
    );
    for (let now = 1000; now <= 37000; now += 20) {
      schedule.sync((now - 1000) / 1000, now, now);
      schedule.tick(now);
    }
    const sent = replies.flatMap((reply) => (reply.type === "batch" ? reply.messages : []));
    expect(sent.filter((message) => message.bytes[0] === 0xb1).map((message) => [message.bytes[1], message.bytes[2], message.time])).toEqual([
      [80, 127, 0],
      [80, 0, 0],
      [81, 127, 8],
      [81, 0, 8],
      [81, 127, 16],
      [81, 0, 16],
      [82, 127, 24],
      [82, 0, 24],
      [83, 127, 33.9],
      [83, 0, 33.9],
    ]);
    expect(replies.some((reply) => reply.type === "fault")).toBe(false);
  });
  it("keeps other chart text, replaces its own block once, supports CRLF and removes it", () => {
    const input = song();
    input.settings[""] += "\n";
    const plan = buildRhythmAutomation(input, setup(input), controls);
    const rebuilt = buildRhythmAutomation({ ...input, settings: { ...input.settings, "": plan.chart } }, setup(input), controls);
    expect(rebuilt.chart).toBe(plan.chart);
    expect(replaceRhythmAutomation(plan.chart, "")).toBe(input.settings[""]);
    const crlf = plan.chart.replace(/\n/g, "\r\n");
    expect(replaceRhythmAutomation(crlf, "")).toBe(input.settings[""].replace(/\n/g, "\r\n"));
    expect(() => replaceRhythmAutomation(plan.chart.replace("// RC-10R automatic rhythm: end", "// edited"), "")).toThrow("markers were edited");
    expect(() => replaceRhythmAutomation(plan.chart + "\n// RC-10R automatic rhythm: begin", "")).toThrow("markers were edited");
  });
  it("allows a different MIDI channel, adjusted lead, optional fills and a Pattern 2 start", () => {
    const input = song();
    const draft = setup(input);
    draft.patterns.v1 = 2;
    draft.changeLeadBars = 0.5;
    draft.fills = false;
    const plan = buildRhythmAutomation(input, draft, { ...controls, channel: 9, division: 20 });
    expect(plan.firstPattern).toBe(2);
    expect(plan.events.find((event) => event.label.includes("Change to Pattern 1"))).toMatchObject({ time: 17, commands: ["cc 9 20 127", "cc 9 20 0"] });
    expect(plan.events.some((event) => event.label.includes("Fill for"))).toBe(false);
    expect(plan.events.some((event) => event.label.includes("Change to Pattern 2"))).toBe(false);
  });
  it("uses the native bank's rounded quarter-note tempo, including explicit 6/8", () => {
    const input = song({ rhythmExport: { version: 1, bpm: 90.1, meter: "6/8" } });
    expect(buildRhythmAutomation(input, setup(input), controls).barSeconds).toBeCloseTo(180 / 135);
    const straight = song({ rhythmExport: { version: 1, bpm: 120.4, meter: "4/4" } });
    expect(buildRhythmAutomation(straight, setup(straight), controls).barSeconds).toBe(2);
  });
  it("keeps a corrected pedal BPM independently of a measured source tempo", () => {
    const input = song({ rhythmExport: { version: 1, bpm: 141, meter: "4/4" }, rhythmAutomation: { bpm: 140 } });
    expect(setup(input).bpm).toBe(140);
    expect(buildRhythmAutomation(input, setup(input), controls).barSeconds).toBeCloseTo(240 / 140);
    expect(input.settings[":bpm"]).toBe("120");
  });
  it("automatically recalculates rhythm cues after tempo, trim, sections and export choices change", () => {
    const input = automated();
    const original = input.settings[""];
    input.settings[":bpm"] = "100";
    const options = JSON.parse(input.settings[":options"]);
    options.trimStart = 2;
    options.trimEnd = 30;
    options.sections[2].start = 12;
    options.sections[1].end = 12;
    options.rhythmExport.parts.intro.bars = 2;
    input.settings[":options"] = JSON.stringify(options);
    const current = currentRhythmAutomation(input)!;
    expect(current.draft).toMatchObject({ bpm: 100, start: 2, endingAt: 27.6, introBars: 2 });
    const cues = parseChart(currentRhythmChart(input));
    expect(cues.find((cue) => cue.label?.includes("Change to Pattern 2"))?.time).toBe(9.6);
    expect(cues.find((cue) => cue.label === "RC-10R: Start rhythm")?.time).toBe(2);
    expect(cues.find((cue) => cue.label === "RC-10R: Play ending and stop")?.time).toBe(27.5);
    expect(input.settings[""]).toBe(original);
    expect(cues.filter((cue) => cue.trigger === "load")[0].messages).toEqual([[0xc1, 0]]);
  });
  it("follows a revised export tempo and meter without requiring a new cue setup", () => {
    const input = automated();
    const options = JSON.parse(input.settings[":options"]);
    options.rhythmExport.bpm = 90;
    options.rhythmExport.meter = "6/8";
    input.settings[":options"] = JSON.stringify(options);
    expect(currentRhythmAutomation(input)!.draft.bpm).toBe(135);
    expect(parseChart(currentRhythmChart(input)).find((cue) => cue.label?.includes("Change to Pattern 2"))?.time).toBe(8.67);
  });
  it("respects trim and silence starts, defaults the ending, and restores per-song choices", () => {
    const input = song({
      trimStart: 2,
      trimEnd: 30,
      sections: sections.slice(1, -1),
      rhythmAutomation: { start: 2, endingAt: 28, introBars: 0, changeLeadBars: 0, fills: false, patterns: { c1: 1 } },
    });
    const draft = setup(input, 6);
    expect(draft).toMatchObject({ memory: 6, start: 2, endingAt: 28, introBars: 0, changeLeadBars: 0, fills: false, patterns: { c1: 1 } });
    expect(buildRhythmAutomation(input, draft, controls).events[1].time).toBe(2);
    expect(setup(song({ analysis: { silence: { start: 1 } } })).start).toBe(1);
    expect(setup(song({ sections: sections.slice(0, -1) })).endingAt).toBe(34);
  });
  it("warns when export choices are missing, sections need a third pattern or the song drifts from the pedal bar grid", () => {
    const input = song({ rhythmExport: undefined, sections: [...sections.slice(0, 2), { ...sections[2], name: "Solo", start: 10.3 }, ...sections.slice(3)] });
    const plan = buildRhythmAutomation(input, setup(input), controls);
    expect(plan.warnings.join(" ")).toContain("No export choices");
    expect(plan.warnings.join(" ")).toContain("two repeating patterns");
    expect(plan.warnings.join(" ")).toContain("steady bar grid");
  });
  it.each([
    [{ ...controls, channel: 0 }, "channel"],
    [{ ...controls, start: 32 }, "Control numbers"],
    [{ ...controls, stop: 128 }, "Control numbers"],
    [{ ...controls, fill: 81 }, "different control numbers"],
  ])("rejects invalid controls before producing cues", (config, message) => {
    const input = song();
    expect(() => buildRhythmAutomation(input, setup(input), config)).toThrow(message);
  });
  it("refuses invalid memories, overlapping or looping sections, missing tempo and impossible intro/ending ranges", () => {
    const input = song();
    for (const memory of [0, 100, NaN]) expect(() => buildRhythmAutomation(input, setup(input, memory), controls)).toThrow("memory");
    for (const mode of ["loop", "repeat-once", "skip", "pause"]) {
      const loop = song({ sections: [{ ...sections[0], mode }, ...sections.slice(1)] });
      expect(() => buildRhythmAutomation(loop, setup(loop), controls)).toThrow("Continue");
    }
    const wholeLoop = song({ endBehaviour: "loop" });
    expect(() => buildRhythmAutomation(wholeLoop, setup(wholeLoop), controls)).toThrow("whole-song looping");
    const overlap = song({ sections: [{ ...sections[0], end: 3 }, ...sections.slice(1)] });
    expect(() => buildRhythmAutomation(overlap, setup(overlap), controls)).toThrow("overlapping");
    const missing = song({ rhythmExport: undefined });
    missing.settings[":bpm"] = "";
    expect(() => buildRhythmAutomation(missing, setup(missing), controls)).toThrow("tempo");
    expect(() => buildRhythmAutomation(input, { ...setup(input), start: -1 }, controls)).toThrow("played range");
    expect(() => buildRhythmAutomation(input, { ...setup(input), introBars: 32 }, controls)).toThrow("intro leaves no room");
    expect(() => buildRhythmAutomation(input, { ...setup(input), endingAt: 2.05 }, controls)).toThrow("overlaps the ending");
  });
});
