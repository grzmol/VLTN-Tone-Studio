import { readOptions, setSetting } from "./settings";

// What the metronome sounds like. "click" is the synthesised blip; the others play one of the band's drum samples (see
// song/band/samples.ts), so a count-in can sound like a drummer counting the band in. The count-in has its own choice, which
// follows the metronome by default. Each has a global default and an optional value of the song's own, like the lead-in values.

export type ClickSound = "click" | "sticks" | "hihat" | "kick-hat" | "ride";

/** The count-in's sound: one of the sounds, or "same", which follows the metronome. */
export type CountInSound = ClickSound | "same";

export const CLICK_SOUNDS: readonly { id: ClickSound; label: string }[] = [
  { id: "click", label: "Click" },
  { id: "sticks", label: "Sticks" },
  { id: "hihat", label: "Hi-hat" },
  { id: "kick-hat", label: "Kick and hat" },
  { id: "ride", label: "Ride" },
];

export function isClickSound(value: unknown): value is ClickSound {
  return CLICK_SOUNDS.some((sound) => sound.id === value);
}

export function isCountInSound(value: unknown): value is CountInSound {
  return value === "same" || isClickSound(value);
}

/** A saved sound: unknown or missing values read as the plain click. */
export function parseClickSound(value: unknown): ClickSound {
  return isClickSound(value) ? value : "click";
}

/** A saved count-in sound: unknown or missing values follow the metronome. */
export function parseCountInSound(value: unknown): CountInSound {
  return isCountInSound(value) ? value : "same";
}

/** The sound the count-in plays, given the metronome's. */
export function resolveCountInSound(countIn: CountInSound, metronome: ClickSound): ClickSound {
  return countIn === "same" ? metronome : countIn;
}

/** The drum note (GM pitch) a click plays, or null for the synthesised blip. */
export function clickNote(sound: ClickSound, downbeat: boolean): number | null {
  switch (sound) {
    case "sticks":
      return 37;
    case "hihat":
      return 42;
    case "kick-hat":
      return downbeat ? 36 : 42;
    case "ride":
      return 51;
    default:
      return null;
  }
}

/** Every drum note a sound can play, so they can be decoded before Play. */
export function clickNotes(sound: ClickSound): number[] {
  return [...new Set([clickNote(sound, true), clickNote(sound, false)].filter((note): note is number => note !== null))];
}

/**
 * The gain of a click: full on the downbeat and 0.65 on the other beats, as the blip has it. Kick and hat accent by changing sample, so
 * both play at full volume.
 */
export function clickAccent(sound: ClickSound, downbeat: boolean): number {
  return sound === "kick-hat" || downbeat ? 1 : 0.65;
}

export interface ClickSounds {
  sound: ClickSound;
  countInSound: CountInSound;
}

/** A song's own values; "" means the song uses the global default. */
export interface ClickSoundsOwn {
  sound: ClickSound | "";
  countInSound: CountInSound | "";
}

export const CLICK_SOUND_DEFAULTS: ClickSounds = { sound: "click", countInSound: "same" };

const DEFAULTS_KEY = "vltn.performance.clicksound.v1";

/** A song's saved values: "" unless the value is a known sound. */
export function ownClickSounds(options: { metronomeSound?: unknown; countInSound?: unknown }): ClickSoundsOwn {
  return {
    sound: isClickSound(options.metronomeSound) ? options.metronomeSound : "",
    countInSound: isCountInSound(options.countInSound) ? options.countInSound : "",
  };
}

/** The global defaults, or the built-in ones where nothing valid is stored. */
export function readClickSoundDefaults(): ClickSounds {
  const stored = readOptions<Partial<Record<keyof ClickSounds, unknown>>>(DEFAULTS_KEY, {});
  return { sound: parseClickSound(stored.sound), countInSound: parseCountInSound(stored.countInSound) };
}

export function saveClickSoundDefaults(defaults: ClickSounds): void {
  setSetting(DEFAULTS_KEY, ":options", JSON.stringify(defaults));
}

/** The values a start uses: the song's own where it has one, the global default otherwise. */
export function resolveClickSounds(own: ClickSoundsOwn, defaults: ClickSounds): ClickSounds {
  return { sound: own.sound === "" ? defaults.sound : own.sound, countInSound: own.countInSound === "" ? defaults.countInSound : own.countInSound };
}
