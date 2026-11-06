import { afterEach, expect, it } from "vitest";
import { MIDI_CONFIG_KEY, readMidiConfiguration, removeMacro, rememberedPort, saveMacro, useMidiConfiguration } from "./midi-configuration";
afterEach(() => {
  localStorage.clear();
  useMidiConfiguration.setState(readMidiConfiguration());
});
it("persists configuration without restoring session arming or accepting invalid channels", () => {
  useMidiConfiguration
    .getState()
    .update({ preset: "gp180-usb", tempoOnStart: true, tempoChannel: 16, showCommands: false, output: { id: "a", name: "GP-180", transport: "system" } });
  expect(readMidiConfiguration()).toMatchObject({ preset: "gp180-usb", tempoOnStart: true, tempoChannel: 16, showCommands: false, output: { id: "a" } });
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ tempoChannel: 19, armed: true, output: { id: 2 } }));
  expect(readMidiConfiguration()).toMatchObject({ tempoChannel: 16, output: null });
  expect(readMidiConfiguration()).not.toHaveProperty("armed");
});
it("restores exact IDs or unique matching names, never an ambiguous replacement", () => {
  const saved = { id: "old", name: "GP-180", transport: "system" as const };
  const port = { id: "new", name: "GP-180", state: "connected" };
  expect(rememberedPort([port], saved)).toBe(port);
  expect(rememberedPort([port, { ...port, id: "other" }], saved)).toBeUndefined();
  expect(rememberedPort([{ ...port, state: "disconnected" }], saved)).toBeUndefined();
});

it("keeps macros with the configuration, and drops entries that are not macros", () => {
  saveMacro({ code: "GP_LEAD", label: "Lead patch", commands: ["pc 16 12", "cc 1 102 127"] });
  expect(readMidiConfiguration().macros).toEqual([{ code: "GP_LEAD", label: "Lead patch", commands: ["pc 16 12", "cc 1 102 127"] }]);
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ macros: [{ code: "X", label: "x", commands: [1] }, { code: "OK", label: "ok", commands: ["start"] }] }));
  expect(readMidiConfiguration().macros.map((m) => m.code)).toEqual(["OK"]);
});
it("replaces a macro with the same code and refuses a table with a problem, changing nothing", () => {
  saveMacro({ code: "LEAD", label: "First", commands: ["pc 1 1"] });
  saveMacro({ code: "LEAD", label: "Second", commands: ["pc 1 2"] });
  expect(useMidiConfiguration.getState().macros).toEqual([{ code: "LEAD", label: "Second", commands: ["pc 1 2"] }]);
  expect(() => saveMacro({ code: "LOOP", label: "Loop", commands: ["$LOOP"] })).toThrow(/refers to itself/);
  expect(() => saveMacro({ code: "BAD", label: "Bad", commands: ["pc 1 500"] })).toThrow(/Invalid MIDI command/);
  expect(useMidiConfiguration.getState().macros.map((m) => m.code)).toEqual(["LEAD"]);
  removeMacro("LEAD");
  expect(useMidiConfiguration.getState().macros).toEqual([]);
});

it("keeps song triggers off until they are switched on, and reads a bad value as off", () => {
  expect(readMidiConfiguration().songTriggers).toEqual({ listen: false, scope: "library", autoplay: false, whilePlaying: "ignore" });
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ songTriggers: { listen: true, scope: "playlist", whilePlaying: "now" } }));
  expect(readMidiConfiguration().songTriggers).toEqual({ listen: true, scope: "playlist", autoplay: false, whilePlaying: "now" });
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ songTriggers: { listen: "yes", whilePlaying: "load" } }));
  expect(readMidiConfiguration().songTriggers).toEqual({ listen: false, scope: "library", autoplay: false, whilePlaying: "ignore" });
});

it("keeps timecode off by default, and falls back to 25 fps for a rate that is not offered", () => {
  expect(readMidiConfiguration().timecode).toEqual({ enabled: false, fps: 25 });
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ timecode: { enabled: true, fps: 29.97 } }));
  expect(readMidiConfiguration().timecode).toEqual({ enabled: true, fps: 25 });
  localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify({ timecode: { enabled: "yes", fps: 30 } }));
  expect(readMidiConfiguration().timecode).toEqual({ enabled: false, fps: 30 });
});
