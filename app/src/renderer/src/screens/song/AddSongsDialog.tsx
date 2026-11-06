import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { runningSeconds } from "@/song/performance/running-time";
import { formatTime } from "@/song/stems/mix";
import type { LibrarySong } from "@shared/song-library";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * Picks songs from the library to add to a playlist. A song already in the playlist is marked, but can still be picked, since a
 * repeat in a set list is legitimate. The songs are added in library order, not in the order they were ticked.
 */
export function AddSongsDialog({
  open,
  songs,
  inPlaylist,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  songs: LibrarySong[];
  /** The ids already in the playlist, so the dialog can mark them. */
  inPlaylist: ReadonlySet<string>;
  onOpenChange: (open: boolean) => void;
  onAdd: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const shown = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return songs.filter((song) => {
      const text = `${song.title} ${song.artist}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [songs, search]);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  const add = () => {
    onAdd(songs.filter((song) => picked.has(song.id)).map((song) => song.id));
    setPicked(new Set());
    setSearch("");
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setPicked(new Set());
          setSearch("");
        }
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add songs</DialogTitle>
          <DialogDescription>Tick the songs to add. They go where you chose in the playlist.</DialogDescription>
        </DialogHeader>
        <input aria-label="Search songs" placeholder="Search by title or artist" className={field} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="max-h-96 space-y-1 overflow-auto">
          {shown.map((song) => (
            <li key={song.id} className="flex items-center gap-2">
              <Checkbox aria-label={`Add ${song.title}`} checked={picked.has(song.id)} onCheckedChange={(on) => toggle(song.id, on === true)} />
              <span className="flex-1 truncate">
                {song.title} <span className="text-silkscreen-3">{song.artist}</span>
              </span>
              {inPlaylist.has(song.id) && <span className="text-xs text-silkscreen-3">in playlist</span>}
              <span className="text-sm text-silkscreen-3">{formatTime(runningSeconds(song))}</span>
            </li>
          ))}
          {!shown.length && <li className="text-sm text-silkscreen-3">No songs match.</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!picked.size} onClick={add}>
            Add {picked.size || ""} song{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
