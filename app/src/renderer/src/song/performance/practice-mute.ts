// Practice mute (spec 102): an instrument kind that is silent in every song. A performer who plays along with a playlist mutes the
// guitar once, and each song that loads comes up without it, with both hands free.
//
// The practice mute sits on top of a song's mix. A track's effective mute is its own mute or the practice mute, and the effective mix
// goes to the player only: it is never written back to the song's saved options, so turning the practice mute off brings back each
// song's own mix exactly. The pure functions below decide which tracks a kind covers; the store keeps the choice across launches.
import { create } from "zustand";
import { defaultStemMix, type Mix } from "../stems/mix";
import type { TrackInfo } from "../tracks";

export const PRACTICE_KINDS = ["guitar", "vocals", "bass", "drums", "piano", "other"] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

export const PRACTICE_LABEL: Record<PracticeKind, string> = {
  guitar: "Guitar",
  vocals: "Vocals",
  bass: "Bass",
  drums: "Drums",
  piano: "Piano",
  other: "Other",
};

export const isPracticeKind = (value: unknown): value is PracticeKind => PRACTICE_KINDS.includes(value as PracticeKind);

/** What a user track counts as: a kind, or `none` to opt out of the practice mute. A track without an entry goes by its name. */
export type CountsAs = PracticeKind | "none";

/** The name patterns of an imported track. Bass comes before guitar, so a "Bass guitar" track counts as bass. */
const NAME_KINDS: [RegExp, PracticeKind][] = [
  [/bass/i, "bass"],
  [/drum/i, "drums"],
  [/vocal|vox/i, "vocals"],
  [/piano|keys/i, "piano"],
  [/guitar|gtr/i, "guitar"],
];

/**
 * The kind a track counts as, or null when it counts as none. A split stem counts as its key. A generated or imported track counts by
 * its name ("Drums (generated)" is drums), unless the performer chose what it counts as. The source never counts, so a song with no split
 * is not muted as a whole. `info` is missing for a stem of an older split, which is still a stem.
 */
export function kindOfTrack(key: string, info?: TrackInfo, countsAs?: CountsAs): PracticeKind | null {
  if (info?.kind === "source") return null;
  if (info === undefined || info.kind === "stem") return isPracticeKind(key) ? key : null;
  if (countsAs !== undefined) return countsAs === "none" ? null : countsAs;
  const name = info.name;
  return NAME_KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** The tracks of one song that the practice mute looks at. */
export interface PracticeTracks {
  /** The keys the player plays */
  keys: readonly string[];
  /** Each track's name and kind, by key. A stem of a split may be missing. */
  info: Readonly<Record<string, TrackInfo>>;
  /** Whether the song has a split. A song with none plays its source as one track that no kind covers. */
  split: boolean;
  /** What the performer chose for a user track, by key (saved in the song's options) */
  countsAs?: Readonly<Record<string, CountsAs>>;
}

/** The tracks of a song that the practice mute silences. */
export function practiceMutedKeys(practice: ReadonlySet<PracticeKind>, tracks: PracticeTracks): Set<string> {
  const muted = new Set<string>();
  if (!practice.size) return muted;
  for (const key of tracks.keys) {
    const info = tracks.info[key];
    // Without a split the one track is the whole song, whatever key it has.
    if (!tracks.split && info === undefined) continue;
    const kind = kindOfTrack(key, info, tracks.countsAs?.[key]);
    if (kind !== null && practice.has(kind)) muted.add(key);
  }
  return muted;
}

/** The kinds in the practice mute that the song has no track for, in the order of PRACTICE_KINDS. */
export function uncoveredKinds(practice: ReadonlySet<PracticeKind>, tracks: PracticeTracks): PracticeKind[] {
  const covered = new Set<PracticeKind>();
  for (const key of tracks.keys) {
    const info = tracks.info[key];
    if (!tracks.split && info === undefined) continue;
    const kind = kindOfTrack(key, info, tracks.countsAs?.[key]);
    if (kind !== null) covered.add(kind);
  }
  return PRACTICE_KINDS.filter((kind) => practice.has(kind) && !covered.has(kind));
}

/**
 * The mix the player plays: the song's mix with the practice-muted tracks muted. The song's mix is not changed. A muted track also
 * leaves any solo, or soloing it would silence the rest of the song.
 */
export function effectiveMute(songMix: Mix, practice: ReadonlySet<PracticeKind>, tracks: PracticeTracks): Mix {
  const muted = practiceMutedKeys(practice, tracks);
  if (!muted.size) return songMix;
  const mix: Mix = { ...songMix };
  for (const key of muted) mix[key] = { ...(songMix[key] ?? defaultStemMix()), mute: true, solo: false };
  return mix;
}

/** What each user track counts as, read from a song's saved options. Anything unreadable is left out. */
export function readCountsAs(options: unknown): Record<string, CountsAs> {
  const saved = options && typeof options === "object" ? (options as { practiceKinds?: unknown }).practiceKinds : undefined;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
  const result: Record<string, CountsAs> = {};
  for (const [key, value] of Object.entries(saved)) if (value === "none" || isPracticeKind(value)) result[key] = value;
  return result;
}

/** "Guitar muted in every song", or "Guitar and vocals muted in every song". Null when nothing is muted. */
export function practiceSummary(practice: ReadonlySet<PracticeKind>): string | null {
  const names = PRACTICE_KINDS.filter((kind) => practice.has(kind)).map((kind, i) => (i === 0 ? PRACTICE_LABEL[kind] : PRACTICE_LABEL[kind].toLowerCase()));
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} muted in every song`;
}

/** The notice that follows a toggle: "Guitar muted in every song" or "Guitar back on". */
export function toggleNotice(kind: PracticeKind, on: boolean, practice: ReadonlySet<PracticeKind>): string {
  return on ? (practiceSummary(practice) ?? `${PRACTICE_LABEL[kind]} muted in every song`) : `${PRACTICE_LABEL[kind]} back on`;
}

/** The line the banner shows when the song has no track for a muted kind, or null. */
export function noTrackNote(practice: ReadonlySet<PracticeKind>, tracks: PracticeTracks): string | null {
  const missing = uncoveredKinds(practice, tracks);
  return missing.length ? `This song has no ${missing.join(" or ")} track to mute` : null;
}

export const PRACTICE_MUTE_KEY = "vltn.performance.practice-mute.v1";

/** The stored kinds, with anything unreadable left out. */
export function parsePracticeMute(raw: string | null): PracticeKind[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? PRACTICE_KINDS.filter((kind) => value.includes(kind)) : [];
  } catch {
    return [];
  }
}

function readStored(): PracticeKind[] {
  try {
    return parsePracticeMute(localStorage.getItem(PRACTICE_MUTE_KEY));
  } catch {
    return [];
  }
}

function persist(kinds: PracticeKind[]): void {
  try {
    localStorage.setItem(PRACTICE_MUTE_KEY, JSON.stringify(kinds));
  } catch {
    // Storage can be full or blocked; the choice still holds for this session.
  }
}

interface PracticeMuteState {
  /** The muted kinds, in the order of PRACTICE_KINDS */
  kinds: PracticeKind[];
  set(kind: PracticeKind, on: boolean): void;
  /** Flips a kind and returns whether it is now muted. */
  toggle(kind: PracticeKind): boolean;
  clear(): void;
}

export const usePracticeMute = create<PracticeMuteState>()((set, get) => {
  const apply = (kinds: PracticeKind[]) => {
    persist(kinds);
    set({ kinds });
  };
  return {
    kinds: readStored(),
    set: (kind, on) => apply(PRACTICE_KINDS.filter((k) => (k === kind ? on : get().kinds.includes(k)))),
    toggle: (kind) => {
      const on = !get().kinds.includes(kind);
      get().set(kind, on);
      return on;
    },
    clear: () => apply([]),
  };
});

/** The muted kinds as a set, for the functions above. */
export const practiceSet = (kinds: readonly PracticeKind[]): ReadonlySet<PracticeKind> => new Set(kinds);
