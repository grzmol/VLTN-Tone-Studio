import { describe, expect, it } from "vitest";
import { BankTracker, defaultBindings, parseMidi, type Binding, type MidiEvent } from "./bindings";
import {
  armAsNext,
  bindingClaiming,
  describeTrigger,
  sanitizeTrigger,
  sanitizeTriggerSettings,
  songEntries,
  songForEvent,
  songLearnStep,
  songsInScope,
  triggerClashes,
  triggerFromOptions,
  triggerMatches,
  triggersOverlap,
  type SongEntry,
  type SongTrigger,
} from "./song-triggers";

const event = (bytes: number[]): MidiEvent => {
  const parsed = parseMidi(bytes);
  if (!parsed) throw new Error(`not a message: ${bytes}`);
  return parsed;
};
/** A bank tracker that has seen the bank select bytes given, in order. */
function bankOf(...selects: [controller: number, value: number, channel: number][]): BankTracker {
  const bank = new BankTracker();
  for (const [controller, value, channel] of selects) bank.observe(event([0xb0 | channel, controller, value]));
  return bank;
}
const pc = (channel: number, program: number, bank?: [number, number]): SongTrigger =>
  bank ? { type: "pc", channel, program, bankMsb: bank[0], bankLsb: bank[1] } : { type: "pc", channel, program };
const entry = (id: string, trigger: SongTrigger | null): SongEntry => ({ id, title: `Song ${id}`, trigger });

describe("sanitizeTrigger", () => {
  it("keeps a program change with or without its bank, and a Song Select", () => {
    expect(sanitizeTrigger({ type: "pc", channel: 3, program: 9 })).toEqual({ type: "pc", channel: 3, program: 9 });
    expect(sanitizeTrigger({ type: "pc", channel: 16, program: 0, bankMsb: 1, bankLsb: 2 })).toEqual({ type: "pc", channel: 16, program: 0, bankMsb: 1, bankLsb: 2 });
    expect(sanitizeTrigger({ type: "songselect", number: 127 })).toEqual({ type: "songselect", number: 127 });
  });

  it("drops what is malformed and any field it does not know", () => {
    expect(sanitizeTrigger({ type: "pc", channel: 0, program: 9 })).toBeNull();
    expect(sanitizeTrigger({ type: "pc", channel: 17, program: 9 })).toBeNull();
    expect(sanitizeTrigger({ type: "pc", channel: 1, program: 128 })).toBeNull();
    expect(sanitizeTrigger({ type: "pc", channel: 1, program: 9, bankMsb: 128 })).toBeNull();
    expect(sanitizeTrigger({ type: "songselect", number: -1 })).toBeNull();
    expect(sanitizeTrigger({ type: "cc", channel: 1, program: 9 })).toBeNull();
    expect(sanitizeTrigger("pc")).toBeNull();
    expect(sanitizeTrigger({ type: "pc", channel: 2, program: 4, extra: true })).toEqual({ type: "pc", channel: 2, program: 4 });
  });

  it("reads a trigger from a song's stored options, and nothing from options that are broken", () => {
    expect(triggerFromOptions(JSON.stringify({ sections: [], midiTrigger: { type: "songselect", number: 4 } }))).toEqual({ type: "songselect", number: 4 });
    expect(triggerFromOptions(JSON.stringify({ sections: [] }))).toBeNull();
    expect(triggerFromOptions("{not json")).toBeNull();
    expect(triggerFromOptions(undefined)).toBeNull();
  });
});

describe("triggerMatches", () => {
  it("matches a program change on its channel and program only", () => {
    const trigger = pc(3, 9);
    expect(triggerMatches(trigger, event([0xc2, 9]), new BankTracker())).toBe(true);
    expect(triggerMatches(trigger, event([0xc0, 9]), new BankTracker())).toBe(false);
    expect(triggerMatches(trigger, event([0xc2, 10]), new BankTracker())).toBe(false);
  });

  it("matches a bank only when the input selected it on that channel", () => {
    const trigger = pc(1, 5, [1, 3]);
    expect(triggerMatches(trigger, event([0xc0, 5]), bankOf([0, 1, 0], [32, 3, 0]))).toBe(true);
    expect(triggerMatches(trigger, event([0xc0, 5]), bankOf([0, 2, 0], [32, 3, 0]))).toBe(false);
    expect(triggerMatches(trigger, event([0xc0, 5]), new BankTracker())).toBe(false);
  });

  it("matches Song Select by number, and no program change", () => {
    const trigger: SongTrigger = { type: "songselect", number: 12 };
    expect(triggerMatches(trigger, event([0xf3, 12]), new BankTracker())).toBe(true);
    expect(triggerMatches(trigger, event([0xf3, 13]), new BankTracker())).toBe(false);
    expect(triggerMatches(trigger, event([0xc0, 12]), new BankTracker())).toBe(false);
  });
});

describe("songForEvent", () => {
  it("picks the first song in library order when two songs share a trigger, every time", () => {
    const songs = [entry("a", pc(1, 4)), entry("b", pc(1, 4)), entry("c", null)];
    for (let i = 0; i < 3; i++) expect(songForEvent(songs, event([0xc0, 4]), new BankTracker())?.id).toBe("a");
  });

  it("returns nothing for a message that is not a program change or Song Select, and for an unknown program", () => {
    const songs = [entry("a", pc(1, 4))];
    expect(songForEvent(songs, event([0xb0, 80, 127]), new BankTracker())).toBeNull();
    expect(songForEvent(songs, event([0xc0, 5]), new BankTracker())).toBeNull();
    expect(songForEvent([], event([0xc0, 4]), new BankTracker())).toBeNull();
  });
});

describe("songsInScope", () => {
  const songs = [entry("a", pc(1, 1)), entry("b", pc(1, 2)), entry("c", pc(1, 3))];
  it("is the whole library for the library scope", () => {
    expect(songsInScope(songs, ["c"], "library").map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
  it("is only the songs of the playlist for the playlist scope, in library order", () => {
    expect(songsInScope(songs, ["c", "a"], "playlist").map((s) => s.id)).toEqual(["a", "c"]);
    expect(songsInScope(songs, [], "playlist")).toEqual([]);
  });
  it("keeps a playlist song out of scope when its trigger is only in the library", () => {
    const scoped = songForEvent(songsInScope(songs, ["c"], "playlist"), event([0xc0, 1]), new BankTracker());
    expect(scoped).toBeNull();
  });
});

describe("triggerClashes", () => {
  it("names the other songs whose trigger overlaps, and nothing for a different bank", () => {
    const songs = [entry("a", pc(1, 4)), entry("b", pc(1, 4)), entry("c", pc(1, 4, [0, 1])), entry("d", pc(1, 4, [2, 0]))];
    // "a" and "b" name no bank, so they answer every bank: they clash with all three others.
    expect(triggerClashes(songs, "a").map((s) => s.id)).toEqual(["b", "c", "d"]);
    // "d" (bank 2/0) does not clash with "c" (bank 0/1), since no one bank selects both.
    expect(triggerClashes(songs, "d").map((s) => s.id)).toEqual(["a", "b"]);
    expect(triggerClashes(songs, "missing")).toEqual([]);
  });

  it("finds no clash between different program changes or Song Select numbers", () => {
    expect(triggersOverlap(pc(1, 4), pc(1, 5))).toBe(false);
    expect(triggersOverlap(pc(1, 4), pc(2, 4))).toBe(false);
    expect(triggersOverlap({ type: "songselect", number: 3 }, { type: "songselect", number: 3 })).toBe(true);
    expect(triggersOverlap({ type: "songselect", number: 3 }, pc(1, 3))).toBe(false);
  });
});

describe("bindingClaiming", () => {
  const learnedProgram: Binding = { action: "section.next", source: "midi", match: { status: 0xc0, channel: 2, data1: 7 } };

  it("finds the binding that already answers a program change, so the song is the one that does not load", () => {
    expect(bindingClaiming(pc(2, 7), [...defaultBindings(), learnedProgram])).toBe(learnedProgram);
    expect(bindingClaiming(pc(2, 8), [learnedProgram])).toBeUndefined();
    expect(bindingClaiming({ type: "songselect", number: 7 }, [learnedProgram])).toBeUndefined();
  });
});

describe("describeTrigger", () => {
  it("names a trigger in words", () => {
    expect(describeTrigger(pc(3, 9))).toBe("Ch 3 · Program 9");
    expect(describeTrigger(pc(3, 9, [2, 3]))).toBe("Ch 3 · Program 9 · bank 2/3");
    expect(describeTrigger({ type: "songselect", number: 12 })).toBe("Song Select 12");
  });
});

describe("songLearnStep", () => {
  it("learns Song Select as its number", () => {
    const step = songLearnStep(event([0xf3, 42]), new BankTracker());
    expect(step).toEqual({ kind: "match", trigger: { type: "songselect", number: 42 }, seen: "Song Select 42" });
  });

  it("waits on a bank select, then learns the program change with that bank", () => {
    const bank = new BankTracker();
    const first = event([0xb0, 0, 1]);
    expect(songLearnStep(first, bank).kind).toBe("wait");
    bank.observe(first);
    bank.observe(event([0xb0, 32, 3]));
    const step = songLearnStep(event([0xc0, 9]), bank);
    expect(step.kind).toBe("match");
    expect(step.kind === "match" && step.trigger).toEqual({ type: "pc", channel: 1, program: 9, bankMsb: 1, bankLsb: 3 });
  });

  it("learns a program change without a bank when none was selected", () => {
    const step = songLearnStep(event([0xc4, 20]), new BankTracker());
    expect(step.kind === "match" && step.trigger).toEqual({ type: "pc", channel: 5, program: 20 });
  });

  it("says why a controller cannot select a song", () => {
    const step = songLearnStep(event([0xb0, 80, 127]), new BankTracker());
    expect(step.kind).toBe("ignore");
    expect(step.seen).toContain("Only a program change or Song Select selects a song.");
  });
});

describe("armAsNext", () => {
  it("moves a song that is later in the playlist up to play next, and keeps the rest in order", () => {
    expect(armAsNext(["a", "b", "c", "d"], 1, "d")).toEqual({ ok: true, queue: ["a", "b", "d", "c"] });
    expect(armAsNext(["a", "b", "c", "d"], 0, "c")).toEqual({ ok: true, queue: ["a", "c", "b", "d"] });
  });

  it("adds a song from outside the playlist after the current one", () => {
    expect(armAsNext(["a", "b", "c"], 0, "x")).toEqual({ ok: true, queue: ["a", "x", "b", "c"] });
  });

  it("does not move a song that is playing, already next, or already played", () => {
    expect(armAsNext(["a", "b", "c"], 1, "b")).toEqual({ ok: false, reason: "current" });
    expect(armAsNext(["a", "b", "c"], 1, "c")).toEqual({ ok: false, reason: "next" });
    expect(armAsNext(["a", "b", "c"], 1, "a")).toEqual({ ok: false, reason: "played" });
  });
});

describe("sanitizeTriggerSettings", () => {
  it("reads the defaults for missing or unknown values", () => {
    expect(sanitizeTriggerSettings(undefined)).toEqual({ listen: false, scope: "library", autoplay: false, whilePlaying: "ignore" });
    expect(sanitizeTriggerSettings({ listen: "yes", scope: "everywhere", autoplay: 1, whilePlaying: "load" })).toEqual({
      listen: false,
      scope: "library",
      autoplay: false,
      whilePlaying: "ignore",
    });
  });

  it("keeps the values that are set", () => {
    expect(sanitizeTriggerSettings({ listen: true, scope: "playlist", autoplay: true, whilePlaying: "now" })).toEqual({
      listen: true,
      scope: "playlist",
      autoplay: true,
      whilePlaying: "now",
    });
  });
});

describe("songEntries", () => {
  it("reads each library song's trigger from its options, in library order", () => {
    const songs = [
      { id: "a", title: "A", settings: { ":options": JSON.stringify({ midiTrigger: { type: "songselect", number: 2 } }) } },
      { id: "b", title: "B", settings: {} },
    ];
    expect(songEntries(songs as never)).toEqual([
      { id: "a", title: "A", trigger: { type: "songselect", number: 2 } },
      { id: "b", title: "B", trigger: null },
    ]);
  });
});
