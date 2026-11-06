import { useEffect, useState } from "react";
import { FolderArchive, FolderOpen, Save, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useSongLibrary } from "@/song/library";
import { formatTime } from "@/song/stems/mix";
import { useSong } from "@/song/store";
import type { LibrarySong } from "@shared/song-library";

const PANEL = "glass rounded-xl min-w-0 px-5 py-4";
const BUSY_KINDS = ["splitting", "model", "decoding"];

/** The Songs tab: save the open song with its stems, open or delete a saved one, and back the whole library up or restore it. */
export function SongLibraryPanel({ onPick }: { onPick: () => void }) {
  const library = useSongLibrary();
  const source = useSong((s) => s.source);
  const status = useSong((s) => s.status);
  const saved = library.index.songs.find((s) => s.id === source?.libraryId);
  const [title, setTitle] = useState(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
  const [artist, setArtist] = useState(saved?.artist ?? "");
  const [deleting, setDeleting] = useState<LibrarySong | null>(null);
  const working = library.busy || BUSY_KINDS.includes(status.kind);

  useEffect(() => {
    if (host.song.library) void library.refresh();
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    setTitle(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
    setArtist(saved?.artist ?? "");
  }, [source, saved?.title, saved?.artist]);

  if (!host.song.library) {
    return <p className="p-6 text-silkscreen-3">Saving songs needs the desktop app. The browser version can split a song, but it can't keep it.</p>;
  }

  return (
    <section aria-label="Saved songs" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
      <div className={PANEL}>
        <h2 className="font-semibold">Save the open song</h2>
        <p className="mt-1 text-sm text-pretty text-silkscreen-3">
          Keeps a copy of the song and its stems on this computer, so you can open it later without splitting it again. Save again after a new
          split to replace the stems.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Input aria-label="Song title" placeholder="Song title" className="w-64" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input aria-label="Song artist" placeholder="Artist" className="w-64" value={artist} onChange={(e) => setArtist(e.target.value)} />
          <Button disabled={!source || !title.trim() || working} onClick={() => void library.save(title, artist)}>
            <Save data-icon="inline-start" />
            {saved ? "Save changes" : "Save to library"}
          </Button>
          <Button variant="outline" disabled={library.busy} onClick={onPick}>
            Open a song…
          </Button>
        </div>
      </div>

      <div className={cn(PANEL, "flex flex-col gap-2")}>
        <h2 className="font-semibold">Saved songs ({library.index.songs.length})</h2>
        {library.index.songs.length === 0 && <p className="text-sm text-silkscreen-3">Nothing saved yet.</p>}
        <ul className="flex flex-col divide-y divide-seam">
          {library.index.songs.map((song) => (
            <li key={song.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <b className="block truncate font-semibold">{song.title}</b>
                <span className="block truncate text-xs text-silkscreen-3">
                  {[song.artist, formatTime(song.duration), `${song.audio.length - 1} stems`].filter(Boolean).join(" · ")}
                </span>
              </div>
              <Button size="sm" variant="outline" disabled={working} onClick={() => void library.load(song.id)}>
                <FolderOpen data-icon="inline-start" />
                Open
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Delete ${song.title}`} disabled={library.busy} onClick={() => setDeleting(song)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <section aria-label="Portable library backup" className={cn(PANEL, "flex flex-col gap-3")}>
        <h2 className="font-semibold">Portable library backup</h2>
        <p className="text-sm text-pretty text-silkscreen-3">
          Puts every saved song, with its source and stems, into one compressed file you can keep or move to another computer. Save the open song
          first to include it.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={working || !library.index.songs.length} onClick={() => void library.exportBackup()}>
            <FolderArchive data-icon="inline-start" />
            Export library backup…
          </Button>
          <Button variant="outline" disabled={working} onClick={() => void library.restoreBackup()}>
            Restore backup…
          </Button>
        </div>
        <p className="text-xs text-pretty text-silkscreen-3">
          Restoring adds the backup's songs and keeps your existing library. If some of them are already saved, you can skip them or import copies.
        </p>
      </section>

      {library.busy && <p role="status">{library.transfer || "Working with saved songs…"}</p>}
      {library.notice && <p role="status">{library.notice}</p>}
      {library.error && (
        <p role="alert" className="text-led-fault">
          {library.error}
        </p>
      )}

      <Dialog open={!!library.backupPreview} onOpenChange={(open) => !open && void library.finishRestore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Some songs are already in your library</DialogTitle>
            <DialogDescription>
              {library.backupPreview?.fileName} holds {library.backupPreview?.songs} songs. {library.backupPreview?.duplicates} of them match audio
              you have already saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => void library.finishRestore("copy")}>
              Import as copies
            </Button>
            <Button onClick={() => void library.finishRestore("skip")}>Skip songs already in the library ({library.backupPreview?.duplicates})</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>Its audio is moved to the Trash. The song stays open if you are working on it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                const id = deleting?.id;
                setDeleting(null);
                if (id) void library.remove(id);
              }}
            >
              Move to the Trash
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
