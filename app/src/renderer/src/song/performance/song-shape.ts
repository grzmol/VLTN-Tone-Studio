import { clampCrossfade } from "./transition";

// A song's trim, fades and end behaviour (pure). They are stored in the song's `:options` JSON, next to its other performance
// options, so they travel with the song and its backups without a new settings key.

export const END_BEHAVIOURS = ["next", "stop", "loop"] as const;
/** What a song does at its end: play the next playlist song, stop the playlist there, or repeat the song from its trimmed start */
export type EndBehaviour = (typeof END_BEHAVIOURS)[number];

export const END_BEHAVIOUR_LABELS: Record<EndBehaviour, string> = {
  next: "Play the next song",
  stop: "Stop the playlist",
  loop: "Loop the song",
};

/** The song's playable range and fades, in song seconds. Undefined trims mean the file's own ends. */
export interface SongShape {
  trimStart?: number;
  trimEnd?: number;
  fadeIn?: number;
  fadeOut?: number;
  endBehaviour?: EndBehaviour;
}

/** The trim, fades and end behaviour as they are stored. Every field is set, so a song without a choice reads as the default. */
export interface StoredShape {
  trimStart: number | undefined;
  trimEnd: number | undefined;
  fadeIn: number;
  fadeOut: number;
  endBehaviour: EndBehaviour;
}

export const DEFAULT_SHAPE: StoredShape = { trimStart: undefined, trimEnd: undefined, fadeIn: 0, fadeOut: 0, endBehaviour: "next" };

/** A trim point in seconds, or undefined when it is not set to a finite, non-negative value */
const trimPoint = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);

/** A fade in seconds, kept between 0 and the crossfade limit so one setting covers both */
const fade = (value: unknown): number => (typeof value === "number" ? clampCrossfade(value) : 0);

export function isEndBehaviour(value: unknown): value is EndBehaviour {
  return (END_BEHAVIOURS as readonly unknown[]).includes(value);
}

/** Reads a song's stored shape from its options. Anything missing or invalid falls back to the default; it never throws. */
export function storedShape(raw: Record<string, unknown>): StoredShape {
  return {
    trimStart: trimPoint(raw.trimStart),
    trimEnd: trimPoint(raw.trimEnd),
    fadeIn: fade(raw.fadeIn),
    fadeOut: fade(raw.fadeOut),
    endBehaviour: isEndBehaviour(raw.endBehaviour) ? raw.endBehaviour : DEFAULT_SHAPE.endBehaviour,
  };
}

/** The shape as the player takes it. */
export function playerShape(shape: StoredShape): SongShape {
  return { trimStart: shape.trimStart, trimEnd: shape.trimEnd, fadeIn: shape.fadeIn, fadeOut: shape.fadeOut, endBehaviour: shape.endBehaviour };
}

/** Reads a song's shape from its stored `:options` JSON. A missing or broken JSON is the default shape. */
export function shapeFromOptions(json: string): StoredShape {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return storedShape(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {});
  } catch {
    return DEFAULT_SHAPE;
  }
}
