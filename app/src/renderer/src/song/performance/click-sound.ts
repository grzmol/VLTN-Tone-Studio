import { readOptions, setSetting } from "./settings";

// What the metronome sounds like. "click" is the synthesised blip; the others play one of the band's drum samples (see
// song/band/samples.ts), so a count-in can sound like a drummer counting the band in. The count-in has its own choice, which
// follows the metronome by default. Each has a global default and an optional value of the song's own, like the lead-in values.

export type ClickSound =
  | "click"
  | "cowbell"
  | "woodblock"
  | "sticks"
  | "pedal-hat"
  | "hihat"
  | "open-hat"
  | "ride"
  | "snare"
  | "kick-hat"
  | "rock"
  | "toms"
  | "crash-one"
  | "custom";

/** The count-in's sound: one of the sounds, or "same", which follows the metronome. */
export type CountInSound = ClickSound | "same";

export interface ClickSoundGroup {
  label: string;
  sounds: readonly { id: ClickSound; label: string }[];
}

/** The sounds as the menus group them: synthesised clicks, single drum hits, and patterns that change the drum on the beat. */
export const CLICK_SOUND_GROUPS: readonly ClickSoundGroup[] = [
  {
    label: "Click",
    sounds: [
      { id: "click", label: "Click" },
      { id: "cowbell", label: "Cowbell" },
      { id: "woodblock", label: "Woodblock" },
    ],
  },
  {
    label: "Drummer",
    sounds: [
      { id: "sticks", label: "Sticks" },
      { id: "pedal-hat", label: "Pedal hat" },
      { id: "hihat", label: "Hi-hat" },
      { id: "open-hat", label: "Open hat" },
      { id: "ride", label: "Ride" },
      { id: "snare", label: "Snare" },
    ],
  },
  {
    label: "Patterns",
    sounds: [
      { id: "kick-hat", label: "Kick and hat" },
      { id: "rock", label: "Rock" },
      { id: "toms", label: "Toms" },
      { id: "crash-one", label: "Crash on one" },
    ],
  },
  { label: "Your own", sounds: [{ id: "custom", label: "My samples" }] },
];

export const CLICK_SOUNDS: readonly { id: ClickSound; label: string }[] = CLICK_SOUND_GROUPS.flatMap((group) => group.sounds);

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

const TOM_NOTES = [50, 47, 45];

/**
 * The drum note (GM pitch) a click plays on beat `beat` (0 is the downbeat) of a bar of `beats` beats, or null where the sound is not a
 * band sample: the synthesised sounds and your own samples.
 */
export function clickNote(sound: ClickSound, beat: number, beats = 4): number | null {
  const down = beat === 0;
  switch (sound) {
    case "sticks":
      return 37;
    case "snare":
      return 38;
    case "pedal-hat":
      return 44;
    case "hihat":
      return 42;
    case "open-hat":
      return 46;
    case "ride":
      return 51;
    case "kick-hat":
      return down ? 36 : 42;
    case "rock":
      // Kick on 1 and 3, snare on 2 and 4. Other meters have no such backbeat, so the kick marks the bar and the snare the rest.
      return beats === 4 ? (beat % 2 === 0 ? 36 : 38) : down ? 36 : 38;
    case "toms":
      // High to low across the bar; a bar longer than the kit's three toms stays on the lowest.
      return TOM_NOTES[Math.min(beat, TOM_NOTES.length - 1)];
    case "crash-one":
      return down ? 49 : 42;
    default:
      return null;
  }
}

/** Every drum note a sound can play in a bar of `beats` beats, so they can be decoded before Play. */
export function clickNotes(sound: ClickSound, beats = 4): number[] {
  const notes = new Set<number>();
  for (let beat = 0; beat < Math.max(1, beats); beat++) {
    const note = clickNote(sound, beat, beats);
    if (note !== null) notes.add(note);
  }
  return [...notes];
}

/**
 * The General MIDI drum note the MIDI click sends for a beat. The sounds that are not band samples send a note of their own kind: the
 * cowbell and woodblock their GM instruments, and the click and your own samples the side stick.
 */
export function midiClickNote(sound: ClickSound, beat: number, beats = 4): number {
  if (sound === "cowbell") return 56;
  if (sound === "woodblock") return 76;
  return clickNote(sound, beat, beats) ?? 37;
}

/** The sounds whose accent is the change of drum itself, so every beat plays at full volume. */
const PATTERNS: readonly ClickSound[] = ["kick-hat", "rock", "toms", "crash-one"];

/**
 * The gain of a click: full on the downbeat and 0.65 on the other beats, as the blip has it. The patterns accent by changing drum, so
 * all their beats play at full volume.
 */
export function clickAccent(sound: ClickSound, beat: number): number {
  return PATTERNS.includes(sound) || beat === 0 ? 1 : 0.65;
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
