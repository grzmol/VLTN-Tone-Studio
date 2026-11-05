import type { LibraryFolder, LibrarySong } from "./song-library";

/*
 * Filters, sorting and search over saved songs (pure). A smart playlist is a set of rules, a match mode ("all" or "any"), a sort key and an
 * optional limit. Every rule is checked before it runs: a malformed rule matches nothing and is reported, so a bad filter never throws in
 * the UI and never quietly widens a live set. The same rules are checked when they are saved (see `validateFilterRule`).
 */

/** Sort keys the library view and smart playlists share. */
export const SORT_KEYS = ["title", "artist", "added", "lastPlayed", "playCount", "bpm", "year", "key"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  artist: "Artist",
  added: "Date added",
  lastPlayed: "Last played",
  playCount: "Play count",
  bpm: "BPM",
  year: "Year",
  key: "Key",
};

/** The fields a rule can test, with the operators each one accepts. Dates are ISO strings, so they compare as text. */
export const FILTER_FIELDS = {
  title: ["contains", "is"],
  artist: ["contains", "is"],
  notes: ["contains"],
  key: ["is"],
  keyword: ["has"],
  colour: ["is"],
  folder: ["in"],
  bpm: ["is", "lt", "gt", "between"],
  year: ["is", "lt", "gt", "between"],
  playCount: ["is", "lt", "gt", "between"],
  duration: ["lt", "gt", "between"],
  added: ["before", "after"],
  lastPlayed: ["before", "after", "never"],
} as const;
export type FilterField = keyof typeof FILTER_FIELDS;
export type FilterOp = (typeof FILTER_FIELDS)[FilterField][number];
export type FilterValue = string | number | [number, number] | string[] | null;
export interface FilterRule {
  field: FilterField;
  op: FilterOp;
  value?: FilterValue;
}
export interface SmartRules {
  match: "all" | "any";
  rules: FilterRule[];
  sort: SortKey;
  /** The most songs the playlist holds, after sorting. Missing means no limit. */
  limit?: number;
}

export const SMART_RULES_MAX = 20;
export const SMART_LIMIT_MAX = 10000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const MAX_TEXT = 200;

/** Why a rule cannot run, or null when it can. The message is for the person editing the playlist. */
export function ruleProblem(rule: FilterRule): string | null {
  if (!rule || typeof rule !== "object") return "This rule is not a filter.";
  if (!Object.prototype.hasOwnProperty.call(FILTER_FIELDS, rule.field)) return `Unknown field "${String(rule.field)}".`;
  const ops = FILTER_FIELDS[rule.field] as readonly string[];
  if (!ops.includes(rule.op)) return `${rule.field} cannot use "${String(rule.op)}".`;
  const value = rule.value;
  switch (rule.op) {
    case "never":
      return null;
    case "contains":
    case "is":
      if (rule.field === "colour") return COLOUR.test(String(value)) ? null : "Choose a colour.";
      if (rule.field === "bpm" || rule.field === "year" || rule.field === "playCount" || rule.field === "duration") return numberProblem(rule.op, value);
      return typeof value === "string" && value.trim() && value.length <= MAX_TEXT ? null : "Enter some text to match.";
    case "has":
      return typeof value === "string" && value.trim() && value.length <= MAX_TEXT ? null : "Enter a keyword to match.";
    case "in":
      if (!Array.isArray(value) || !value.length || value.length > 50 || value.some((id) => typeof id !== "string")) return "Choose at least one folder.";
      return null;
    case "lt":
    case "gt":
      return numberProblem(rule.op, value);
    case "between":
      return numberProblem(rule.op, value);
    case "before":
    case "after":
      return typeof value === "string" && DATE.test(value) ? null : "Choose a date.";
  }
  return "This rule cannot run.";
}

function numberProblem(op: FilterOp, value: FilterValue | undefined): string | null {
  if (op === "between") {
    const ok = Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number" && Number.isFinite(n));
    return ok && (value as [number, number])[0] <= (value as [number, number])[1] ? null : "Enter a range from the smaller to the larger number.";
  }
  return typeof value === "number" && Number.isFinite(value) ? null : "Enter a number.";
}

/** Validates a rule for saving. Throws with the same message `ruleProblem` gives. */
export function validateFilterRule(rule: FilterRule): void {
  const problem = ruleProblem(rule);
  if (problem) throw new Error(problem);
}

/** Validates a smart playlist's rules, sort and limit for saving. */
export function validateSmartRules(smart: SmartRules): void {
  if (!smart || typeof smart !== "object" || (smart.match !== "all" && smart.match !== "any")) throw new Error("Invalid smart playlist.");
  if (!Array.isArray(smart.rules) || smart.rules.length > SMART_RULES_MAX) throw new Error("A smart playlist holds up to 20 rules.");
  if (!(SORT_KEYS as readonly string[]).includes(smart.sort)) throw new Error("Invalid sort order.");
  if (smart.limit !== undefined && (!Number.isInteger(smart.limit) || smart.limit < 1 || smart.limit > SMART_LIMIT_MAX)) throw new Error("Invalid song limit.");
  smart.rules.forEach(validateFilterRule);
}

/** The folder ids in `selected` and everything below them. Unlimited depth; a folder that refers to itself is cut off, never followed forever. */
export function folderScope(folders: readonly LibraryFolder[], selected: readonly string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder.id);
    children.set(folder.parentId, list);
  }
  const scope = new Set<string>();
  const stack = [...selected];
  while (stack.length) {
    const id = stack.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return scope;
}

type Predicate = (song: LibrarySong) => boolean;

/** Compiles a rule into a predicate, doing the set-up work (such as a folder scope) once. Null when the rule cannot run. */
export function compileRule(rule: FilterRule, folders: readonly LibraryFolder[]): Predicate | null {
  if (ruleProblem(rule)) return null;
  const value = rule.value;
  switch (rule.field) {
    case "title":
    case "artist":
    case "notes":
    case "key": {
      const field = rule.field;
      const get = (song: LibrarySong): string => (field === "key" ? (song.key ?? "") : (song[field] ?? "")) as string;
      const needle = String(value).trim().toLocaleLowerCase();
      if (rule.op === "is") return (song) => get(song).trim().toLocaleLowerCase() === needle;
      return (song) => get(song).toLocaleLowerCase().includes(needle);
    }
    case "keyword": {
      const needle = String(value).trim().toLocaleLowerCase();
      return (song) => (song.keywords ?? []).some((keyword) => keyword.toLocaleLowerCase() === needle);
    }
    case "colour": {
      const needle = String(value).toLocaleLowerCase();
      return (song) => (song.color ?? "").toLocaleLowerCase() === needle;
    }
    case "folder": {
      const scope = folderScope(folders, value as string[]);
      return (song) => song.folderId !== undefined && scope.has(song.folderId);
    }
    case "added":
    case "lastPlayed": {
      const get = (song: LibrarySong): string | undefined => (rule.field === "added" ? song.created : song.lastPlayed);
      if (rule.op === "never") return (song) => !get(song);
      const date = value as string;
      if (rule.op === "before") return (song) => !!get(song) && (get(song) as string) < date;
      return (song) => !!get(song) && (get(song) as string) > date;
    }
    default: {
      const get = numberOf(rule.field);
      if (rule.op === "between") {
        const [low, high] = value as [number, number];
        return (song) => {
          const n = get(song);
          return n !== undefined && n >= low && n <= high;
        };
      }
      const n = value as number;
      // A song with no value for the field (no BPM, no year) matches no number rule, not even "less than".
      if (rule.op === "is") return (song) => get(song) === n;
      if (rule.op === "lt") return (song) => get(song) !== undefined && get(song)! < n;
      return (song) => get(song) !== undefined && get(song)! > n;
    }
  }
}

function numberOf(field: FilterField): (song: LibrarySong) => number | undefined {
  switch (field) {
    case "bpm":
      return (song) => song.bpm;
    case "year":
      return (song) => song.year;
    case "playCount":
      return (song) => song.playCount ?? 0;
    case "duration":
      return (song) => song.duration;
    default:
      return () => undefined;
  }
}

/** Whether a rule's value is a list of ids (the folders of a `folder in` rule). */
export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The result of running smart rules: the songs in order, and a problem for each rule that cannot run (which then matches nothing). */
export interface SmartResult {
  songs: LibrarySong[];
  problems: string[];
}

/**
 * Runs a smart playlist over the songs. A rule that cannot run makes the whole playlist empty, with the problem named, so a bad filter is
 * never mistaken for a short one. Pure: the same songs and rules always give the same list.
 */
export function evaluateSmart(songs: readonly LibrarySong[], folders: readonly LibraryFolder[], smart: SmartRules): SmartResult {
  const problems: string[] = [];
  const predicates: Predicate[] = [];
  for (const rule of smart.rules) {
    const problem = ruleProblem(rule);
    if (problem) {
      problems.push(problem);
      continue;
    }
    predicates.push(compileRule(rule, folders)!);
  }
  if (problems.length) return { songs: [], problems };
  const matches = (song: LibrarySong) => (smart.match === "any" ? predicates.some((p) => p(song)) : predicates.every((p) => p(song)));
  const found = sortSongs(
    songs.filter((song) => (predicates.length ? matches(song) : true)),
    smart.sort,
  );
  return { songs: smart.limit ? found.slice(0, smart.limit) : found, problems };
}

/**
 * Sorts songs by one key, without changing the input. Text is A to Z; dates and play counts put the most recent or most played first;
 * an empty number sorts last. Ties go by title, so the order is the same every time.
 */
export function sortSongs(songs: readonly LibrarySong[], key: SortKey, reverse = false): LibrarySong[] {
  const byTitle = (a: LibrarySong, b: LibrarySong) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const text = (get: (song: LibrarySong) => string, a: LibrarySong, b: LibrarySong) =>
    get(a).localeCompare(get(b), undefined, { sensitivity: "base" }) || byTitle(a, b);
  const numberAsc = (get: (song: LibrarySong) => number | undefined, a: LibrarySong, b: LibrarySong) => {
    const x = get(a),
      y = get(b);
    if (x === undefined || y === undefined) return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) || byTitle(a, b);
    return x - y || byTitle(a, b);
  };
  const dateDesc = (get: (song: LibrarySong) => string | undefined, a: LibrarySong, b: LibrarySong) => {
    const x = get(a),
      y = get(b);
    if (!x || !y) return (!x ? 1 : 0) - (!y ? 1 : 0) || byTitle(a, b);
    return x < y ? 1 : x > y ? -1 : byTitle(a, b);
  };
  const compare: Record<SortKey, (a: LibrarySong, b: LibrarySong) => number> = {
    title: byTitle,
    artist: (a, b) => text((song) => song.artist, a, b),
    key: (a, b) => text((song) => song.key ?? "", a, b),
    added: (a, b) => dateDesc((song) => song.created, a, b),
    lastPlayed: (a, b) => dateDesc((song) => song.lastPlayed, a, b),
    playCount: (a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || byTitle(a, b),
    bpm: (a, b) => numberAsc((song) => song.bpm, a, b),
    year: (a, b) => numberAsc((song) => song.year, a, b),
  };
  const sorted = [...songs].sort(compare[key]);
  return reverse ? sorted.reverse() : sorted;
}

/**
 * Songs whose title, artist, notes or keywords contain every word of `query`, ignoring case. An empty query keeps everything.
 */
export function searchSongs(songs: readonly LibrarySong[], query: string): LibrarySong[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...songs];
  return songs.filter((song) => {
    const haystack = [song.title, song.artist, song.notes ?? "", ...(song.keywords ?? [])].join("\n").toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * Where each first letter starts in a list sorted by title: the A to Z index. Only worth showing for a long list, so it is empty below
 * `minimum` songs. Non-letters are grouped under "#".
 */
export function letterIndex(
  songs: readonly LibrarySong[],
  minimum = 21,
  label: (song: LibrarySong) => string = (song) => song.title,
): { letter: string; index: number }[] {
  if (songs.length < minimum) return [];
  const seen = new Set<string>();
  const result: { letter: string; index: number }[] = [];
  songs.forEach((song, index) => {
    const first = label(song).trim().charAt(0).toLocaleUpperCase();
    const letter = /^[A-Z]$/.test(first) ? first : "#";
    if (seen.has(letter)) return;
    seen.add(letter);
    result.push({ letter, index });
  });
  return result;
}
