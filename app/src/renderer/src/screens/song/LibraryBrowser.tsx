import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { isRunning, useAnalysisJob } from "@/song/analysis/analysis-job";
import { NO_BROWSE, browseSongs, folderRows, type BrowseState } from "@/song/library-browse";
import { formatTime } from "@/song/stems/mix";
import { runningSeconds } from "@/song/performance/running-time";
import { SORT_KEYS, SORT_LABELS, type SmartRules, type SortKey } from "@shared/library-filter";
import { overridesFor } from "@shared/entry-overrides";
import type { LibraryFolder, LibrarySong } from "@shared/song-library";
import { FilterBuilder } from "./FilterBuilder";
import { SongDetails, parseKeywords } from "./SongDetails";
import { AnalyseSongsDialog } from "./AnalyseSongsDialog";
import type { BatchSong } from "@/song/analysis/batch";

const field = "rounded border border-seam bg-transparent p-2";
const EMPTY_FILTER: SmartRules = { match: "all", rules: [], sort: "title" };

/**
 * The saved songs: search, folders, a filter, a sort and an A to Z index for a long list. Each song can be loaded, queued next or added to
 * the queue. Songs can be selected for a batch edit: add to a playlist, set the colour, the keywords or the folder, or delete.
 */
export function LibraryBrowser() {
  const library = useSongLibrary();
  const [view, setView] = useState<BrowseState>(NO_BROWSE);
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState("");
  const [folderName, setFolderName] = useState("");
  const [batch, setBatch] = useState({ playlist: "", colour: "#3b82f6", keywords: "", folder: "" });
  const [message, setMessage] = useState("");
  // The name for a playlist made from the selected songs. Null while the name is not being asked for.
  const [newPlaylist, setNewPlaylist] = useState<string | null>(null);
  // Which songs the analysis dialog works on: the selection, or the whole library. Null while the dialog is closed.
  const [analysing, setAnalysing] = useState<"selected" | "all" | null>(null);
  // The status bar asks for the dialog on a running analysis. The dialog then shows that run, whichever songs it started on.
  const openRequested = useAnalysisJob((s) => s.openRequested);
  const analysisRunning = isRunning(useAnalysisJob((s) => s.phase));
  useEffect(() => {
    if (!openRequested) return;
    useAnalysisJob.getState().consumeOpenRequest();
    setAnalysing("all");
  }, [openRequested]);
  const songs = library.index.songs;
  const folders = library.index.folders;
  const result = useMemo(() => browseSongs(songs, folders, view), [songs, folders, view]);
  const tree = folderRows(folders);
  const chosen = view.folderId ? folders.find((f) => f.id === view.folderId) : undefined;
  const picked = [...selected].filter((id) => songs.some((s) => s.id === id));
  const single = picked.length === 1 ? songs.find((s) => s.id === picked[0]) : undefined;
  const playlists = library.index.playlists.filter((p) => !p.smart);
  const selectedSeconds = (id: string) => {
    const song = songs.find((s) => s.id === id);
    return song ? runningSeconds(song) : 0;
  };
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const jump = (index: number) => document.getElementById(`library-row-${index}`)?.scrollIntoView?.({ block: "start" });
  const addFolder = () => {
    const name = folderName.trim();
    if (!name) return;
    void library.saveFolders([...folders, { id: crypto.randomUUID(), name, ...(chosen ? { parentId: chosen.id } : {}) }]).then(() => setFolderName(""));
  };
  const deleteFolder = (folder: LibraryFolder) => {
    setMessage("");
    void library.saveFolders(folders.filter((f) => f.id !== folder.id));
    setView({ ...view, folderId: null });
  };
  const runBatch = async (change: () => Promise<void>) => {
    setMessage("");
    await change();
  };
  /** Makes a playlist of the selected songs. The Playlists panel opens it once it is saved. */
  const createFromSelected = async () => {
    const name = newPlaylist?.trim();
    if (!name) return;
    setMessage("");
    const saved = await library.addPlaylist({ id: crypto.randomUUID(), name, songs: picked, sets: [], overrides: picked.map(() => null) });
    if (saved) setNewPlaylist(null);
  };
  const deleteSelected = async () => {
    setConfirm("");
    for (const id of picked) await library.remove(id);
    setSelected(new Set());
  };
  return (
    <section aria-label="Saved songs" className="space-y-3">
      <h2 className="font-semibold">Songs · {songs.length}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Search saved songs"
          placeholder="Search title, artist, notes or keywords"
          className={field + " min-w-0 flex-1"}
          value={view.query}
          onChange={(e) => setView({ ...view, query: e.target.value })}
        />
        <select aria-label="Sort songs" className={field} value={view.sort} onChange={(e) => setView({ ...view, sort: e.target.value as SortKey })}>
          {SORT_KEYS.map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        <Button variant="outline" aria-pressed={view.reverse} onClick={() => setView({ ...view, reverse: !view.reverse })}>
          Reverse order
        </Button>
        <Button variant="outline" aria-pressed={filtering} onClick={() => setFiltering(!filtering)}>
          {filtering ? "Hide filter" : "Filter the list"}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Folders">
        <Button variant={view.folderId ? "outline" : "default"} onClick={() => setView({ ...view, folderId: null })}>
          All songs
        </Button>
        {tree.map(({ folder, depth }) => (
          <Button
            key={folder.id}
            variant={view.folderId === folder.id ? "default" : "outline"}
            style={{ marginLeft: depth * 12 }}
            onClick={() => setView({ ...view, folderId: folder.id })}
          >
            {folder.name}
          </Button>
        ))}
        <input
          aria-label="New folder name"
          placeholder={chosen ? `New folder in ${chosen.name}` : "New folder"}
          className={field}
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
        />
        <Button variant="outline" disabled={!folderName.trim() || library.busy} onClick={addFolder}>
          Add folder
        </Button>
        {chosen && (
          <Button variant="outline" disabled={library.busy} onClick={() => deleteFolder(chosen)}>
            Delete folder
          </Button>
        )}
      </div>
      {filtering && (
        <div className="rounded border border-seam p-3">
          <FilterBuilder value={view.filter ?? EMPTY_FILTER} folders={folders} showSort={false} onChange={(filter) => setView({ ...view, filter })} />
          <Button variant="outline" className="mt-2" onClick={() => setView({ ...view, filter: null })}>
            Clear filter
          </Button>
        </div>
      )}
      {result.problems.map((problem) => (
        <p key={problem} role="alert" className="text-sm text-red-400">
          {problem}
        </p>
      ))}
      <p className="text-sm text-silkscreen-3">
        {result.songs.length} shown{view.folderId ? ` in ${chosen?.name ?? "this folder"}` : ""}
      </p>
      <Button variant="outline" disabled={library.busy || !songs.length} onClick={() => setAnalysing("all")}>
        {analysisRunning ? "Analysis running…" : "Analyse all songs…"}
      </Button>
      {result.letters.length > 0 && (
        <nav aria-label="Jump to letter" className="flex flex-wrap gap-1 text-sm">
          {result.letters.map(({ letter, index }) => (
            <button key={letter} type="button" className="rounded px-1 hover:underline" onClick={() => jump(index)}>
              {letter}
            </button>
          ))}
        </nav>
      )}
      {!songs.length && <p>No saved songs. Open audio, prepare it, then save it.</p>}
      <ul className="max-h-[60vh] space-y-2 overflow-auto pr-1">
        {result.songs.map((song, index) => (
          <SongRow
            key={song.id}
            song={song}
            index={index}
            checked={selected.has(song.id)}
            onToggle={() => toggle(song.id)}
            disabled={library.busy}
            confirming={confirm === song.id}
            onConfirm={(on) => setConfirm(on ? song.id : "")}
            onDelete={() => {
              setConfirm("");
              void library.remove(song.id);
            }}
            onLoad={() => void library.load(song.id)}
            onNext={() => setMessage(library.playNextSong(song.id) ?? `${song.title} plays next.`)}
            onQueue={() => setMessage(library.addToQueue([song.id]) ?? `${song.title} added to the queue.`)}
          />
        ))}
      </ul>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {single && <SongDetails key={single.id} song={single} />}
      {picked.length > 0 && (
        <section aria-label="Batch edit" className="space-y-2 rounded border border-seam p-3">
          <p className="text-sm">
            {picked.length} selected · {formatTime(picked.reduce((sum, id) => sum + selectedSeconds(id), 0))}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Add selected to playlist"
              className={field}
              value={batch.playlist}
              onChange={(e) => setBatch({ ...batch, playlist: e.target.value })}
            >
              <option value="">Choose a playlist…</option>
              {playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!batch.playlist || library.busy}
              onClick={() =>
                void runBatch(async () => {
                  const target = playlists.find((p) => p.id === batch.playlist);
                  if (target) {
                    await library.updatePlaylist(target.id, {
                      songs: [...target.songs, ...picked],
                      overrides: [...overridesFor(target.songs.length, target.overrides), ...picked.map(() => null)],
                    });
                  }
                  setMessage(`Added ${picked.length} songs to ${target?.name ?? "the playlist"}.`);
                })
              }
            >
              Add to playlist
            </Button>
            {newPlaylist === null ? (
              <Button variant="outline" disabled={library.busy} onClick={() => setNewPlaylist("")}>
                New playlist from selected…
              </Button>
            ) : (
              <>
                <input
                  aria-label="Name for the new playlist"
                  placeholder="New playlist name"
                  className={field}
                  value={newPlaylist}
                  onChange={(e) => setNewPlaylist(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPlaylist.trim()) void createFromSelected();
                  }}
                />
                <Button disabled={!newPlaylist.trim() || library.busy} onClick={() => void createFromSelected()}>
                  Create playlist
                </Button>
                <Button variant="outline" onClick={() => setNewPlaylist(null)}>
                  Cancel
                </Button>
              </>
            )}
            <input aria-label="Colour for selected" type="color" value={batch.colour} onChange={(e) => setBatch({ ...batch, colour: e.target.value })} />
            <Button variant="outline" disabled={library.busy} onClick={() => void library.organiseSongs(picked, { color: batch.colour })}>
              Set colour
            </Button>
            <input
              aria-label="Keywords for selected"
              placeholder="Replace keywords, comma separated"
              className={field}
              value={batch.keywords}
              onChange={(e) => setBatch({ ...batch, keywords: e.target.value })}
            />
            <Button variant="outline" disabled={library.busy} onClick={() => void library.organiseSongs(picked, { keywords: parseKeywords(batch.keywords) })}>
              Set keywords
            </Button>
            <select
              aria-label="Move selected to folder"
              className={field}
              value={batch.folder}
              onChange={(e) => setBatch({ ...batch, folder: e.target.value })}
            >
              <option value="">Choose a folder…</option>
              <option value="none">Library root</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!batch.folder || library.busy}
              onClick={() => void library.organiseSongs(picked, { folderId: batch.folder === "none" ? null : batch.folder })}
            >
              Move to folder
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={library.busy} onClick={() => setAnalysing("selected")}>
              {analysisRunning ? "Analysis running…" : "Analyse selected…"}
            </Button>
            <Button variant="outline" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
            {confirm === "batch" ? (
              <>
                <span>Delete {picked.length} songs and remove them from all playlists?</span>
                <Button disabled={library.busy} onClick={() => void deleteSelected()}>
                  Confirm delete
                </Button>
                <Button variant="outline" onClick={() => setConfirm("")}>
                  Keep songs
                </Button>
              </>
            ) : (
              <Button variant="outline" disabled={library.busy} onClick={() => setConfirm("batch")}>
                Delete selected…
              </Button>
            )}
          </div>
        </section>
      )}
      <AnalyseSongsDialog
        open={analysing !== null}
        onOpenChange={(open) => !open && setAnalysing(null)}
        songs={batchSongs(analysing === "all" ? songs : songs.filter((song) => selected.has(song.id)))}
      />
    </section>
  );
}

function batchSongs(list: readonly LibrarySong[]): BatchSong[] {
  return list.map((song) => ({ id: song.id, title: song.title, settings: song.settings }));
}

function SongRow(props: {
  song: LibrarySong;
  index: number;
  checked: boolean;
  onToggle(): void;
  disabled: boolean;
  confirming: boolean;
  onConfirm(on: boolean): void;
  onDelete(): void;
  onLoad(): void;
  onNext(): void;
  onQueue(): void;
}) {
  const { song, index, checked, disabled, confirming } = props;
  return (
    <li id={`library-row-${index}`} className="rounded border border-seam p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="checkbox" aria-label={`Select ${song.title}`} checked={checked} onChange={props.onToggle} />
        {song.color && <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: song.color }} />}
        <strong className="flex-1">{song.title}</strong>
        <span className="text-sm text-silkscreen-3">
          {[song.artist, song.key, song.bpm ? `${Math.round(song.bpm)} BPM` : "", song.year ? String(song.year) : ""].filter(Boolean).join(" · ")}
        </span>
      </div>
      <p className="text-sm">
        {formatTime(song.duration)} · {song.playCount ?? 0} plays{song.keywords?.length ? ` · ${song.keywords.join(", ")}` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={props.onLoad}>
          Load song
        </Button>
        <Button variant="outline" disabled={disabled} onClick={props.onNext}>
          Play next
        </Button>
        <Button variant="outline" disabled={disabled} onClick={props.onQueue}>
          Add to queue
        </Button>
        <Button variant="outline" disabled={disabled} onClick={() => props.onConfirm(true)}>
          Delete song…
        </Button>
        {confirming && (
          <>
            <span>Delete saved audio and remove from all playlists?</span>
            <Button disabled={disabled} onClick={props.onDelete}>
              Confirm delete
            </Button>
            <Button variant="outline" onClick={() => props.onConfirm(false)}>
              Keep song
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
