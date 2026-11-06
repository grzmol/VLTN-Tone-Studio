import { expect, it } from "vitest";
import { CLICK_SOUND_GROUPS, CLICK_SOUNDS, clickAccent, clickNote, clickNotes, midiClickNote, ownClickSounds, parseClickSound, parseCountInSound, resolveClickSounds, resolveCountInSound } from "./click-sound";

it("reads unknown or missing sounds as the click, and a missing count-in sound as the metronome's", () => {
  expect(parseClickSound(undefined)).toBe("click");
  expect(parseClickSound("gong")).toBe("click");
  expect(parseClickSound("cowbell")).toBe("cowbell");
  expect(parseClickSound("sticks")).toBe("sticks");
  expect(parseCountInSound(7)).toBe("same");
  expect(parseCountInSound("ride")).toBe("ride");
});

it("makes the count-in follow the metronome's sound when it is 'same'", () => {
  expect(resolveCountInSound("same", "hihat")).toBe("hihat");
  expect(resolveCountInSound("sticks", "hihat")).toBe("sticks");
});

const notes = (sound: Parameters<typeof clickNote>[0], beats: number) => Array.from({ length: beats }, (_, beat) => clickNote(sound, beat, beats));

it("picks drum notes: kick on the downbeat and hat elsewhere for kick-hat, none for the synthesised sounds", () => {
  expect(clickNote("click", 0)).toBeNull();
  expect(clickNote("cowbell", 0)).toBeNull();
  expect(clickNote("woodblock", 2)).toBeNull();
  expect(clickNote("custom", 0)).toBeNull();
  expect(clickNote("sticks", 3)).toBe(37);
  expect(clickNote("hihat", 0)).toBe(42);
  expect(clickNote("ride", 0)).toBe(51);
  expect(clickNote("snare", 1)).toBe(38);
  expect(clickNote("pedal-hat", 1)).toBe(44);
  expect(clickNote("open-hat", 0)).toBe(46);
  expect(notes("kick-hat", 4)).toEqual([36, 42, 42, 42]);
  expect(clickNotes("kick-hat")).toEqual([36, 42]);
  expect(clickNotes("click")).toEqual([]);
});

it("plays rock as kick, snare, kick, snare in four beats, and kick then snares in other meters", () => {
  expect(notes("rock", 4)).toEqual([36, 38, 36, 38]);
  expect(notes("rock", 3)).toEqual([36, 38, 38]);
  expect(notes("rock", 6)).toEqual([36, 38, 38, 38, 38, 38]);
});

it("runs the toms high to low and stays on the low tom in a longer bar", () => {
  expect(notes("toms", 4)).toEqual([50, 47, 45, 45]);
  expect(notes("toms", 3)).toEqual([50, 47, 45]);
  expect(notes("toms", 6)).toEqual([50, 47, 45, 45, 45, 45]);
});

it("crashes on one and closes the hat on the other beats in 4/4, 3/4 and 6/8", () => {
  expect(notes("crash-one", 4)).toEqual([49, 42, 42, 42]);
  expect(notes("crash-one", 3)).toEqual([49, 42, 42]);
  expect(notes("crash-one", 6)).toEqual([49, 42, 42, 42, 42, 42]);
  expect(clickNotes("crash-one", 6)).toEqual([49, 42]);
});

it("accents the downbeat fully and the other beats at 0.65, except the patterns which change drum", () => {
  expect(clickAccent("sticks", 0)).toBe(1);
  expect(clickAccent("sticks", 2)).toBe(0.65);
  expect(clickAccent("kick-hat", 1)).toBe(1);
  expect(clickAccent("rock", 1)).toBe(1);
  expect(clickAccent("toms", 3)).toBe(1);
  expect(clickAccent("cowbell", 1)).toBe(0.65);
});

it("groups the menu as Click, Drummer, Patterns and your own, and lists every sound once", () => {
  expect(CLICK_SOUND_GROUPS.map((group) => group.label)).toEqual(["Click", "Drummer", "Patterns", "Your own"]);
  expect(CLICK_SOUND_GROUPS[0].sounds.map((s) => s.label)).toEqual(["Click", "Cowbell", "Woodblock"]);
  expect(CLICK_SOUND_GROUPS[1].sounds.map((s) => s.label)).toEqual(["Sticks", "Pedal hat", "Hi-hat", "Open hat", "Ride", "Snare"]);
  expect(CLICK_SOUND_GROUPS[2].sounds.map((s) => s.label)).toEqual(["Kick and hat", "Rock", "Toms", "Crash on one"]);
  expect(new Set(CLICK_SOUNDS.map((s) => s.id)).size).toBe(CLICK_SOUNDS.length);
});

it("sends General MIDI notes for the MIDI click, the side stick for sounds with no drum of their own", () => {
  expect(midiClickNote("pedal-hat", 0)).toBe(44);
  expect(midiClickNote("rock", 2, 4)).toBe(36);
  expect(midiClickNote("click", 0)).toBe(37);
  expect(midiClickNote("custom", 1)).toBe(37);
  expect(midiClickNote("cowbell", 0)).toBe(56);
  expect(midiClickNote("woodblock", 0)).toBe(76);
});

it("uses a song's own sounds over the defaults, and ignores bad saved values", () => {
  const defaults = { sound: "hihat", countInSound: "same" } as const;
  expect(resolveClickSounds(ownClickSounds({}), defaults)).toEqual(defaults);
  expect(resolveClickSounds(ownClickSounds({ metronomeSound: "ride", countInSound: "sticks" }), defaults)).toEqual({ sound: "ride", countInSound: "sticks" });
  expect(ownClickSounds({ metronomeSound: "nope", countInSound: 3 })).toEqual({ sound: "", countInSound: "" });
});
