import { trackKindOf, type LibraryAudio, type TrackKind } from "@shared/song-library";
import { STEM_NAMES } from "./types";
import { defaultStemMix, type Mix } from "./stems/mix";
import type { BusName } from "./audio/outputs";

// The per-track rules of a song, as pure functions: what order the tracks play in, which bus a click-like track goes to, how an
// imported file's name sets its settings, how far apart the lengths of imported tracks may be, when a click would be time-stretched,
// and which tracks silence each other in a mute group. The player and the import flow call these; nothing here touches WebAudio.

/** A track whose length is within this many seconds of the median is padded with silence without a word. */
export const LENGTH_TOLERANCE_S = 0.5;
/** A track further than this from the median is refused. Between the two it is padded and the user is told. */
export const LENGTH_REJECT_S = 5;

/**
 * What the mixer knows about a track besides its audio. A saved track carries these in its library entry; an imported track gets them
 * from its file name. A split's stem has none, and its name is its key.
 */
export interface TrackInfo {
  kind: TrackKind;
  /** The name shown in the mixer */
  name: string;
  color?: string;
  bus?: BusName;
  gain?: number;
  pan?: number;
  transpose?: boolean;
  muteGroups?: number[];
}

/** The settings a library entry keeps for a track, read back into a TrackInfo. Missing settings stay missing, so a default applies. */
export function trackInfoOf(track: LibraryAudio): TrackInfo {
  const info: TrackInfo = { kind: trackKindOf(track), name: track.name };
  if (track.color !== undefined) info.color = track.color;
  if (track.bus !== undefined) info.bus = track.bus;
  if (track.gain !== undefined) info.gain = track.gain;
  if (track.pan !== undefined) info.pan = track.pan;
  if (track.transpose !== undefined) info.transpose = track.transpose;
  if (track.muteGroups !== undefined) info.muteGroups = track.muteGroups;
  return info;
}

/** The settings a TrackInfo saves into its library entry. Only the ones that are set are written. */
export function savedSettingsOf(info: TrackInfo | undefined): Pick<LibraryAudio, "color" | "bus" | "gain" | "pan" | "transpose" | "muteGroups"> {
  if (!info) return {};
  const saved: Pick<LibraryAudio, "color" | "bus" | "gain" | "pan" | "transpose" | "muteGroups"> = {};
  if (info.color !== undefined) saved.color = info.color;
  if (info.bus !== undefined) saved.bus = info.bus;
  if (info.gain !== undefined) saved.gain = info.gain;
  if (info.pan !== undefined) saved.pan = info.pan;
  if (info.transpose !== undefined) saved.transpose = info.transpose;
  if (info.muteGroups !== undefined) saved.muteGroups = info.muteGroups;
  return saved;
}

/** The mix each track starts with: its saved volume and pan. Only tracks with one of those saved are listed. */
export function mixDefaults(tracks: Readonly<Record<string, TrackInfo>>): Mix {
  const mix: Mix = {};
  for (const [key, info] of Object.entries(tracks)) {
    if (info.gain === undefined && info.pan === undefined) continue;
    mix[key] = { ...defaultStemMix(), volume: info.gain ?? 1, pan: info.pan };
  }
  return mix;
}

/** The bus each track starts on, where the track saved one. */
export function busDefaults(tracks: Readonly<Record<string, TrackInfo>>): Partial<Record<string, BusName>> {
  return Object.fromEntries(
    Object.entries(tracks)
      .filter(([, info]) => info.bus !== undefined)
      .map(([key, info]) => [key, info.bus]),
  );
}

/** Whether each track follows the pitch shift, where the track saved a choice. */
export function pitchDefaults(tracks: Readonly<Record<string, TrackInfo>>): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(tracks)
      .filter(([, info]) => info.transpose !== undefined)
      .map(([key, info]) => [key, info.transpose!]),
  );
}

/**
 * The song's options JSON with each track's saved pitch choice added to its `followsPitch`. A choice the song already has wins, so a
 * change made in the mixer is kept. Returns the input unchanged when no track saved a choice.
 */
export function mergeTrackDefaults(optionsJson: string, tracks: Readonly<Record<string, TrackInfo>>): string {
  const defaults = pitchDefaults(tracks);
  if (!Object.keys(defaults).length) return optionsJson;
  let options: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(optionsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) options = parsed as Record<string, unknown>;
  } catch {
    // A damaged options entry starts again from the track defaults.
  }
  const chosen = options.followsPitch && typeof options.followsPitch === "object" ? (options.followsPitch as Record<string, boolean>) : {};
  return JSON.stringify({ ...options, followsPitch: { ...defaults, ...chosen } });
}

/** Named colours for a file name such as `Bass (color=blue).wav`, as hex so they can be saved */
export const NAMED_COLOURS: Record<string, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  grey: "#94a3b8",
};

/**
 * The order tracks are kept in: the source first, then the stems in the order the splitter names them, then any other track in the order
 * it was given. Keeps the mixer and the players of a split song exactly as they were before imported tracks existed.
 */
export function orderedKeys(keys: readonly string[]): string[] {
  // The song itself leads, then the stems, then imported tracks.
  const rank = (key: string) => {
    if (key === "source") return -1;
    const at = (STEM_NAMES as readonly string[]).indexOf(key);
    return at === -1 ? STEM_NAMES.length : at;
  };
  return keys
    .map((key, index) => ({ key, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index)
    .map(({ key }) => key);
}

/** Whether a track is a click or a guide by its name. Those go to the click bus by default. */
export function isClickLike(name: string): boolean {
  return /click|metronome|guide/i.test(name);
}

/** The bus a track starts on: the click bus for a click-like track, else Main. */
export function defaultBus(name: string): "click" | "main" {
  return isClickLike(name) ? "click" : "main";
}

/** The file name without its folder or extension, and without a leading track number such as `01 `. */
export function trackBaseName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/^\d{1,3}[\s._-]+(?=\S)/, "");
}

/** The settings a file name can carry. Each is optional: a file name that carries none imports with the defaults. */
export interface TrackNameOptions {
  name: string;
  bus?: "main" | "click" | "aux1" | "aux2";
  color?: string;
  gain?: number;
  pan?: number;
  transpose?: boolean;
  muteGroups?: number[];
}

const OPTION = /\[([a-z]+)=([^\]]*)\]|\(([a-z]+)=([^)]*)\)/gi;
const BUSES = ["main", "click", "aux1", "aux2"] as const;

/**
 * Reads a file name such as `Keys L [bus=Aux1] (color=blue) (group=1,2).wav`. Options are written in brackets or parentheses; an unknown
 * or bad option is ignored, so the file still imports and only that setting is left at its default.
 */
export function parseTrackName(fileName: string): TrackNameOptions {
  const base = trackBaseName(fileName);
  const options: TrackNameOptions = { name: "" };
  let name = base;
  for (const match of base.matchAll(OPTION)) {
    const key = (match[1] ?? match[3]).toLowerCase();
    const value = (match[2] ?? match[4]).trim();
    name = name.replace(match[0], " ");
    applyOption(options, key, value);
  }
  options.name = name.replace(/\s+/g, " ").trim().slice(0, 60) || "Track";
  return options;
}

function applyOption(options: TrackNameOptions, key: string, value: string): void {
  if (key === "bus") {
    const bus = BUSES.find((b) => b.toLowerCase() === value.toLowerCase());
    if (bus) options.bus = bus;
  } else if (key === "color") {
    const colour = NAMED_COLOURS[value.toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(value) ? value : undefined);
    if (colour) options.color = colour;
  } else if (key === "gain") {
    const gain = Number(value);
    if (Number.isFinite(gain) && gain >= 0 && gain <= 2) options.gain = gain;
  } else if (key === "pan") {
    const pan = Number(value);
    if (Number.isFinite(pan) && pan >= -1 && pan <= 1) options.pan = pan;
  } else if (key === "pitch") {
    if (/^(yes|no|true|false)$/i.test(value)) options.transpose = /^(yes|true)$/i.test(value);
  } else if (key === "group") {
    const groups = [...new Set(value.split(",").map((g) => Number(g.trim())))].filter((g) => Number.isInteger(g) && g >= 1 && g <= 6);
    if (groups.length) options.muteGroups = groups;
  }
}

/** How an imported track's length compares with the median length of the set. */
export type LengthVerdict = "ok" | "pad" | "reject";

/** Whether a track of `seconds` may join a set whose median length is `median`. Only the size of the difference matters. */
export function lengthVerdict(seconds: number, median: number): LengthVerdict {
  const difference = Math.abs(seconds - median);
  if (difference <= LENGTH_TOLERANCE_S) return "ok";
  return difference <= LENGTH_REJECT_S ? "pad" : "reject";
}

/** The median of the lengths, which every track is compared with. Empty input has no median. */
export function medianSeconds(lengths: readonly number[]): number {
  if (!lengths.length) return 0;
  const sorted = [...lengths].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The notice shown when a click-like track would be time-stretched. A stretch can smear the transients a click depends on, so the song
 * says so rather than playing a stretched click without a word. Null when nothing would be stretched.
 */
export function clickStretchWarning(rate: number, tracks: readonly { key: string; name: string; bus?: string }[]): string | null {
  if (rate === 1) return null;
  const clicks = tracks.filter((track) => track.bus === "click" || isClickLike(track.name));
  if (!clicks.length) return null;
  const names = clicks.map((track) => track.name).join(", ");
  return `${names} is stretched to ${Math.round(rate * 100)}%. Stretching can blur clicks, so use the built-in metronome instead.`;
}

/**
 * Mutes the tracks that share a mute group with `key`, when `key` has just been unmuted or soloed. Only the mute flags of the others
 * change, so the caller's gain ramp is what the listener hears: no click. Returns the mix unchanged when `key` is muted or in no group.
 */
export function silenceGroupmates(mix: Mix, groups: Readonly<Record<string, readonly number[]>>, key: string): Mix {
  const mine = groups[key] ?? [];
  if (!mine.length || mix[key]?.mute) return mix;
  const next: Mix = { ...mix };
  for (const other of Object.keys(groups)) {
    if (other === key || !groups[other].some((group) => mine.includes(group))) continue;
    next[other] = { ...defaultStemMix(), ...mix[other], mute: true };
  }
  return next;
}

/**
 * Sets or clears the solo of `key`. Soloing a muted track in a mute group also unmutes it, so it plays alone, the same as an unmute
 * does, and its group-mates are muted. A muted track in no group keeps its mute, so its solo stays silent.
 */
export function setSolo(mix: Mix, groups: Readonly<Record<string, readonly number[]>>, key: string, solo: boolean): Mix {
  const current = mix[key] ?? defaultStemMix();
  if (!solo) return { ...mix, [key]: { ...current, solo: false } };
  const grouped = (groups[key] ?? []).length > 0;
  const soloed = { ...mix, [key]: { ...current, solo: true, mute: grouped ? false : current.mute } };
  return silenceGroupmates(soloed, groups, key);
}

/**
 * Mutes the tracks of mute group `group`, or unmutes them when every one is muted already. For the remote actions: a pedal toggles a
 * group without the mixer. Returns a hint, and no mix, when no track is in the group.
 */
export function toggleMuteGroup(mix: Mix, tracks: Readonly<Record<string, TrackInfo>>, group: number): { mix: Mix } | { hint: string } {
  const members = Object.keys(tracks).filter((key) => tracks[key].muteGroups?.includes(group));
  if (!members.length) return { hint: `No track is in mute group ${group}.` };
  const muted = !members.every((key) => mix[key]?.mute);
  const next: Mix = { ...mix };
  for (const key of members) next[key] = { ...defaultStemMix(), ...mix[key], mute: muted };
  return { mix: next };
}
