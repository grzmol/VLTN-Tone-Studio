// Notes as the generators produce them: song time, not bar and step, so a part follows the beat grid wherever the beats fall.

export interface NoteEvent {
  /** Song time in seconds. */
  time: number;
  /** MIDI note number. Drum notes use the General MIDI drum map. */
  pitch: number;
  /** 1 to 127. */
  velocity: number;
  /** Seconds. */
  duration: number;
  /** A slide: the note starts this many semitones below its pitch and rises to it over about 40 ms (bass only). */
  slideFrom?: number;
  /** A dead note: a muted, short note between two notes (bass only). Plays soft and dark. */
  dead?: true;
}

// General MIDI drum map. These are the voices the style patterns use, so any GM kit plays them.
export const KICK = 36;
export const SNARE = 38;
export const SIDE_STICK = 37;
export const CLOSED_HAT = 42;
export const PEDAL_HAT = 44;
export const OPEN_HAT = 46;
export const RIDE = 51;
export const CRASH = 49;
/**
 * Three toms, the GM low, low-mid and high toms. The two floor toms (41 and 43) are left out on purpose: fills are written
 * for the toms a standard kit has above the snare, and a floor tom sits too low for most fills.
 */
export const LOW_TOM = 45;
export const MID_TOM = 47;
export const HIGH_TOM = 50;

/** Every drum pitch the style patterns may use. */
export const DRUM_PITCHES: readonly number[] = [KICK, SNARE, SIDE_STICK, CLOSED_HAT, PEDAL_HAT, OPEN_HAT, RIDE, CRASH, LOW_TOM, MID_TOM, HIGH_TOM];

/** How long a drum hit lasts, in seconds. */
export const DRUM_DURATION = 0.1;
