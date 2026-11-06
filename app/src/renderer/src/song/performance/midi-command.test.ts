import { describe, expect, it } from "vitest";
import { midiCommand, midiMessages } from "./midi-command";

describe("midi command grammar", () => {
  it("keeps the channel commands exactly as before", () => {
    expect(midiCommand("pc 1 5")).toEqual([192, 5]);
    expect(midiCommand("cc 2 80 127")).toEqual([177, 80, 127]);
    expect(midiCommand("note 16 60 100")).toEqual([159, 60, 100]);
    expect(midiCommand("sysex F0 7D 01 F7")).toEqual([240, 125, 1, 247]);
  });
  it("sends a bank select as CC0 and CC32 before the program change", () => {
    expect(midiMessages("pc 1 5 bank 0 2")).toEqual([
      [176, 0, 0],
      [176, 32, 2],
      [192, 5],
    ]);
    expect(midiMessages("pc 16 12 bank 1 127")).toEqual([
      [191, 0, 1],
      [191, 32, 127],
      [207, 12],
    ]);
  });
  it("sends song select and the real-time transport bytes", () => {
    expect(midiMessages("songselect 3")).toEqual([[243, 3]]);
    expect(midiMessages("start")).toEqual([[250]]);
    expect(midiMessages("continue")).toEqual([[251]]);
    expect(midiMessages("stop")).toEqual([[252]]);
    expect(midiMessages("  stop  ")).toEqual([[252]]);
  });
  it("rejects malformed bank, song select and transport forms", () => {
    for (const cmd of [
      "pc 1 5 bank 0",
      "pc 1 5 bank 0 128",
      "pc 0 5 bank 0 1",
      "pc 1 5 bank x 1",
      "songselect",
      "songselect 128",
      "songselect 1 2",
      "start 1",
      "stop now",
      "bogus 1 2",
    ])
      expect(() => midiMessages(cmd), cmd).toThrow();
  });
});
