import { readOptions, setSetting } from "./settings";

// The lead-in before a start: a count-in, a pre-roll and a start delay. Each has a global default, stored with the settings helpers. A
// song's own value overrides it, and an empty own value (""), like an unset metronome mode, means "use the default".

export type LeadInKey = "countInBars" | "preRollBeats" | "startDelay";

export interface LeadIn {
  countInBars: number;
  preRollBeats: number;
  startDelay: number;
}

/** A song's own values; "" means the song uses the global default. */
export type LeadInOwn = Record<LeadInKey, number | "">;

export const LEAD_IN_LIMITS: Record<LeadInKey, { min: number; max: number }> = {
  countInBars: { min: 0, max: 2 },
  preRollBeats: { min: 0, max: 16 },
  startDelay: { min: 0, max: 10 },
};

export const LEAD_IN_DEFAULTS: LeadIn = { countInBars: 0, preRollBeats: 0, startDelay: 0 };

const DEFAULTS_KEY = "vltn.performance.leadin.v1";

/** `value` kept within the key's range, or `fallback` when it is not a number. */
export function clampLeadIn(key: LeadInKey, value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const { min, max } = LEAD_IN_LIMITS[key];
  return Math.min(max, Math.max(min, value));
}

/** A song's saved value: "" unless it is a number, which is clamped. */
export function ownLeadIn(key: LeadInKey, value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? clampLeadIn(key, value, 0) : "";
}

/** The global defaults, or the built-in ones where nothing valid is stored. */
export function readLeadInDefaults(): LeadIn {
  const stored = readOptions<Partial<Record<LeadInKey, unknown>>>(DEFAULTS_KEY, {});
  return {
    countInBars: clampLeadIn("countInBars", stored.countInBars, LEAD_IN_DEFAULTS.countInBars),
    preRollBeats: clampLeadIn("preRollBeats", stored.preRollBeats, LEAD_IN_DEFAULTS.preRollBeats),
    startDelay: clampLeadIn("startDelay", stored.startDelay, LEAD_IN_DEFAULTS.startDelay),
  };
}

export function saveLeadInDefaults(defaults: LeadIn): void {
  setSetting(DEFAULTS_KEY, ":options", JSON.stringify(defaults));
}

/** The values a start uses: the song's own where it has one, the global default otherwise. */
export function resolveLeadIn(own: LeadInOwn, defaults: LeadIn): LeadIn {
  return {
    countInBars: own.countInBars === "" ? defaults.countInBars : own.countInBars,
    preRollBeats: own.preRollBeats === "" ? defaults.preRollBeats : own.preRollBeats,
    startDelay: own.startDelay === "" ? defaults.startDelay : own.startDelay,
  };
}

/** The tempo and count-in a song plays with, as its own settings set them. */
export interface SongCountIn {
  bpm: number;
  countInBars: number;
  beatsPerBar: number;
}

/**
 * The tempo and count-in a song plays with, read from its saved settings the way the performance panel reads them: its own BPM and
 * beats, and its own count-in where it has one, the global default otherwise. A playlist join uses these for the incoming song.
 */
export function songCountIn(settings: Record<string, string>, defaults: LeadIn = readLeadInDefaults()): SongCountIn {
  const bpm = Number(settings[":bpm"] || NaN);
  let options: Partial<Record<"beats" | "countInBars", unknown>> = {};
  try {
    options = JSON.parse(settings[":options"] || "{}") ?? {};
  } catch {
    options = {};
  }
  const own = ownLeadIn("countInBars", options.countInBars);
  return {
    bpm: Number.isFinite(bpm) && bpm >= 30 && bpm <= 300 ? bpm : 120,
    countInBars: own === "" ? defaults.countInBars : own,
    beatsPerBar: typeof options.beats === "number" && Number.isFinite(options.beats) && options.beats > 0 ? options.beats : 4,
  };
}
