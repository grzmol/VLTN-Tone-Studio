import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { insertSongs, type PlaylistDraft } from "@/song/playlist-draft";
import { runningSeconds } from "@/song/performance/running-time";
import { formatTime } from "@/song/stems/mix";
import { addSet, blockSummaries, deleteSet, moveEntry, removeEntry, renameSet } from "@shared/playlist-sets";
import type { LibrarySong, Playlist } from "@shared/song-library";
import { AddSongsDialog } from "./AddSongsDialog";
import { PlaylistPreflight } from "./PlaylistPreflight";
import { EntryOverrideControls } from "./EntryOverrideControls";
import { overridesFor, withOverride, type EntryOverride } from "@shared/entry-overrides";

const field = "rounded border border-seam bg-transparent p-2";
const row = "flex flex-wrap items-center gap-2 rounded border border-seam p-2";

/**
 * A static playlist as headed sets. A set heading is a block of entries with its own count and running time; "Play set" stops at the end
 * of the block. Entries can be moved, removed, queued from here or started as a new set. Edits go to the draft, which the playlist panel
 * saves; playing and queueing use the saved playlist, so editing never changes the song that is playing.
 */
export function SetEditor({
  playlist,
  songs,
  draft,
  dirty,
  onChange,
}: {
  /** The saved playlist. Play, Load and Queue use it. */
  playlist: Playlist;
  songs: LibrarySong[];
  draft: PlaylistDraft;
  /** Whether the draft has unsaved edits. Play, Load and Queue wait until it is saved. */
  dirty: boolean;
  onChange: (next: PlaylistDraft) => void;
}) {
  const library = useSongLibrary();
  const [hint, setHint] = useState("");
  // Where the songs picked in the Add songs dialog go: before the entry at this index. Null while the dialog is closed.
  const [addAt, setAddAt] = useState<number | null>(null);
  const byId = new Map(songs.map((song) => [song.id, song]));
  // The draft's lists, shaped as a playlist, so the blocks and entry edits read the same as for a saved one.
  const view: Playlist = { ...playlist, songs: draft.songs, sets: draft.sets, overrides: draft.overrides };
  const blocks = blockSummaries(view, songs, runningSeconds);
  const duration = blocks.reduce((sum, block) => sum + block.seconds, 0);
  const busy = library.busy;
  const overrides = overridesFor(playlist.songs.length, playlist.overrides);
  const edit = (change: Partial<PlaylistDraft>) => {
    setHint("");
    onChange({ ...draft, ...change });
  };
  const title = (id: string) => byId.get(id)?.title ?? "Missing song";
  const queueIds = (ids: string[], entryOverrides: (EntryOverride | null)[]) => {
    const reason = library.addToQueue(ids, entryOverrides);
    setHint(reason ?? (ids.length ? `Queued ${ids.length} song${ids.length === 1 ? "" : "s"}.` : ""));
  };
  const entries = (start: number, end: number) => draft.songs.slice(start, end);
  const startSet = (at: number) => {
    const name = `Set ${draft.sets.length + 1}`;
    const result = addSet(view, name, at, crypto.randomUUID());
    if (!result.ok) return setHint(result.reason);
    edit({ sets: result.sets });
  };
  const removeAt = (i: number) => edit(removeEntry(view, i));
  const addSongs = (ids: string[]) => {
    if (addAt === null || !ids.length) return;
    onChange(insertSongs(draft, addAt, ids));
    setHint(`Added ${ids.length} song${ids.length === 1 ? "" : "s"}. Save the playlist to keep them.`);
  };
  const moveTo = (from: number, to: number) => edit(moveEntry(view, from, to));
  const off = busy || dirty;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!playlist.songs.length || off} onClick={() => void library.playPlaylist([...playlist.songs], 0, undefined, overrides)}>
          Play playlist
        </Button>
        <Button
          variant="outline"
          disabled={!playlist.songs.length || off}
          onClick={() => void library.load(playlist.songs[0], [...playlist.songs], 0, overrides)}
        >
          Load set paused
        </Button>
        <Button variant="outline" disabled={!playlist.songs.length || off} onClick={() => queueIds(playlist.songs, overrides)}>
          Queue all
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setAddAt(draft.songs.length)}>
          Add songs…
        </Button>
      </div>
      {!draft.songs.length && <p className="text-sm">No songs yet. Add songs to fill the playlist.</p>}
      {dirty && <p className="text-sm text-silkscreen-3">Save the playlist first to play it.</p>}
      <p className="text-sm">
        {draft.songs.length} entries · {formatTime(duration)} · Automatically advances during playback
      </p>
      <PlaylistPreflight key={playlist.id} ids={playlist.songs} disabled={busy} revision={library.index} songs={songs} />
      <ol className="space-y-2">
        {blocks.map((block, b) => (
          <li key={`${block.start}-${block.set?.id ?? "lead"}`} className="space-y-2">
            {block.set ? (
              <div className={row} aria-label={`Set ${block.name}`}>
                <input
                  aria-label="Set name"
                  value={block.set.name}
                  className={field}
                  disabled={busy}
                  onChange={(e) => edit({ sets: renameSet(draft.sets, block.set!.id, e.target.value) })}
                />
                <span className="flex-1 text-sm text-silkscreen-3">
                  {block.count} songs · {formatTime(block.seconds)}
                </span>
                <Button
                  variant="outline"
                  disabled={!block.count || off}
                  onClick={() => void library.playPlaylist(entries(block.start, block.end), 0, block.set!.id, overrides.slice(block.start, block.end))}
                >
                  Play set
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setAddAt(block.end)}>
                  Add songs to this set…
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => edit({ sets: deleteSet(draft.sets, block.set!.id) })}>
                  Remove set heading
                </Button>
              </div>
            ) : (
              b === 0 && blocks.length > 1 && <p className="text-sm text-silkscreen-3">Before the first set</p>
            )}
            {entries(block.start, block.end).map((id, offset) => {
              const i = block.start + offset;
              return (
                <div key={i} className={row}>
                  <span className="flex-1">
                    {i + 1}. {title(id)}
                  </span>
                  <Button variant="outline" disabled={off} onClick={() => void library.playPlaylist([...playlist.songs], i, undefined, overrides)}>
                    Play from here
                  </Button>
                  <Button variant="outline" disabled={off} onClick={() => void library.load(id, [...playlist.songs], i, overrides)}>
                    Load paused
                  </Button>
                  <Button variant="outline" disabled={off} onClick={() => queueIds(playlist.songs.slice(i), overrides.slice(i))}>
                    Queue from here
                  </Button>
                  {!draft.sets.some((set) => set.start === i) && i > 0 && (
                    <Button variant="outline" aria-label={`Start a set at entry ${i + 1}`} disabled={busy} onClick={() => startSet(i)}>
                      Start a set here
                    </Button>
                  )}
                  <EntryOverrideControls
                    label={`Entry ${i + 1}`}
                    value={draft.overrides[i]}
                    disabled={busy}
                    onChange={(next) => edit({ overrides: withOverride(draft.overrides, i, next) })}
                  />
                  <Button aria-label={`Move entry ${i + 1} up`} variant="outline" disabled={i === 0 || busy} onClick={() => moveTo(i, i - 1)}>
                    ↑
                  </Button>
                  <Button
                    aria-label={`Move entry ${i + 1} down`}
                    variant="outline"
                    disabled={i === draft.songs.length - 1 || busy}
                    onClick={() => moveTo(i, i + 1)}
                  >
                    ↓
                  </Button>
                  <Button aria-label={`Remove entry ${i + 1}`} variant="outline" disabled={busy} onClick={() => removeAt(i)}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </li>
        ))}
      </ol>
      <AddSongsDialog open={addAt !== null} songs={songs} inPlaylist={new Set(draft.songs)} onOpenChange={(open) => !open && setAddAt(null)} onAdd={addSongs} />
      {hint && (
        <p role="status" className="text-sm">
          {hint}
        </p>
      )}
    </div>
  );
}
