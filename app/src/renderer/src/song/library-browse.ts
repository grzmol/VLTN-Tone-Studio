import { evaluateSmart, folderScope, letterIndex, searchSongs, sortSongs, type SmartRules, type SortKey } from "@shared/library-filter";
import type { LibraryFolder, LibrarySong } from "@shared/song-library";

/*
 * What the library list shows (pure): a text search, a folder, an optional filter, and a sort. The list is worked out from the saved songs
 * each time it is needed, so it always matches the library. A filter that cannot run shows no songs and names the problem.
 */

export interface BrowseState {
  query: string;
  /** Show only this folder and the folders inside it. Null shows every folder. */
  folderId: string | null;
  /** The filter rules to apply. The match mode, rules and sort come from the filter; its limit is not used by the list. */
  filter: SmartRules | null;
  sort: SortKey;
  reverse: boolean;
}

export interface BrowseResult {
  songs: LibrarySong[];
  /** Why the filter could not run, one line per rule. Empty when it ran, or when there is no filter. */
  problems: string[];
  /** Where each letter starts, when the list is long enough for an A to Z index. */
  letters: { letter: string; index: number }[];
}

export const NO_BROWSE: BrowseState = { query: "", folderId: null, filter: null, sort: "title", reverse: false };

export function browseSongs(songs: readonly LibrarySong[], folders: readonly LibraryFolder[], state: BrowseState): BrowseResult {
  let list = searchSongs(songs, state.query);
  if (state.folderId) {
    const scope = folderScope(folders, [state.folderId]);
    list = list.filter((song) => song.folderId !== undefined && scope.has(song.folderId));
  }
  let problems: string[] = [];
  if (state.filter) {
    const filtered = evaluateSmart(list, folders, { ...state.filter, limit: undefined, sort: state.sort });
    problems = filtered.problems;
    list = filtered.songs;
  } else {
    list = sortSongs(list, state.sort, state.reverse);
  }
  if (state.filter && state.reverse) list = [...list].reverse();
  const byArtist = state.sort === "artist";
  return { songs: list, problems, letters: letterIndex(list, 21, byArtist ? (song) => song.artist : (song) => song.title) };
}

/** The folders in tree order, each with its depth, children sorted by name under their parent. A folder whose parent is missing shows at the top. */
export function folderRows(folders: readonly LibraryFolder[]): { folder: LibraryFolder; depth: number }[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const byParent = new Map<string | undefined, LibraryFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : undefined;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  const rows: { folder: LibraryFolder; depth: number }[] = [];
  const visit = (parent: string | undefined, depth: number, seen: Set<string>) => {
    const children = [...(byParent.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const folder of children) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      rows.push({ folder, depth });
      visit(folder.id, depth + 1, seen);
    }
  };
  visit(undefined, 0, new Set());
  return rows;
}
