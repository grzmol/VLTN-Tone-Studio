import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { selectWholeSongStems, useSong } from "@/song/store";
import { audioUnsaved } from "@/song/library";
import { saveIndicator } from "./SaveIndicator";
import { useSongLibrary } from "@/song/library";
import { isRunning, jobLine, useAnalysisJob, useJobClock } from "@/song/analysis/analysis-job";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import { LibraryBrowser } from "./LibraryBrowser";
import { QueuePanel } from "./QueuePanel";
import { PlayHistory } from "./PlayHistory";
import { PlaylistsPanel } from "./PlaylistsPanel";

const field = "rounded border border-seam bg-transparent p-2";
export function SongLibraryPanel({ onPick }: { onPick(): void }) {
  const library = useSongLibrary(),
    source = useSong((s) => s.source),
    status = useSong((s) => s.status);
  const saved = library.index.songs.find((s) => s.id === source?.libraryId);
  const stems = useSong(selectWholeSongStems);
  // The save bar is for a song that is open and not safe yet; the header shows the save state, and Save there does the same.
  const state = saveIndicator({
    hasSong: !!source,
    inLibrary: !!source?.libraryId,
    audioUnsaved: audioUnsaved(source, stems, saved),
    saveStep: library.saveStep,
    saveError: library.saveError,
  });
  const unsaved = state?.kind === "unsaved" || state?.kind === "failed";
  const [title, setTitle] = useState(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
  const [artist, setArtist] = useState(saved?.artist ?? "");
  // A batch analysis (spec 77) keeps going on any screen; this line shows it here too, with a way back to its dialog.
  const job = useAnalysisJob();
  const jobNow = useJobClock(isRunning(job.phase));
  useEffect(() => {
    if (host.song.library) void library.refresh();
  }, []);
  useEffect(() => {
    setTitle(saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "");
    setArtist(saved?.artist ?? "");
  }, [source, saved?.title, saved?.artist]);
  if (!host.song.library) return <p>Use the desktop app to save songs and audio for offline performances.</p>;
  return (
    <section aria-label="Saved songs and playlists" className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-2">
      {unsaved && (
        <div aria-label="Save the current song" className="flex flex-wrap items-center gap-3 rounded border border-seam px-3 py-2">
          <input aria-label="Song title" placeholder="Song title" className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
          <input aria-label="Song artist" placeholder="Artist" className={field} value={artist} onChange={(e) => setArtist(e.target.value)} />
          <Button
            disabled={!source || !title.trim() || library.busy || ["splitting", "model", "decoding"].includes(status.kind)}
            title="Stores a local copy of the audio and stems, lyrics, chord chart, MIDI cues and performance settings. Save again after making changes."
            onClick={() => void library.save(title, artist)}
          >
            {saved ? "Save song changes" : "Save song to library"}
          </Button>
        </div>
      )}
      <Dialog open={!!library.backupPreview} onOpenChange={(open) => !open && void library.finishRestore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Some songs are already in your library</DialogTitle>
            <DialogDescription>
              {library.backupPreview?.fileName} holds {library.backupPreview?.songs} songs and {library.backupPreview?.playlists} playlists.{" "}
              {library.backupPreview?.duplicates} of the songs match audio you have already saved. Restore adds songs and playlists and keeps your existing
              library. If some songs are already saved, you can skip them or import copies. MIDI ports, cue arming and account settings are not included.
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
      {library.busy && <p role="status">{library.saveStep ? `Saving… ${library.saveStep}` : library.transfer || "Working with saved songs…"}</p>}
      {isRunning(job.phase) && (
        <div className="flex flex-wrap items-center gap-3">
          <p role="status">{jobLine(job, jobNow)}</p>
          <Button variant="outline" size="sm" onClick={() => job.requestOpen()}>
            Show
          </Button>
        </div>
      )}
      {library.busy && library.playlistPlaying && library.queue.length > 1 && (
        <Button variant="outline" onClick={() => library.pausePlaylist()}>
          Stop playlist
        </Button>
      )}
      {library.notice && <p role="status">{library.notice}</p>}
      {library.error && (
        <p role="alert" className="text-red-400">
          {library.error}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <LibraryBrowser onImport={onPick} />
        <div className="space-y-5">
          <QueuePanel />
          <PlaylistsPanel />
          <PlayHistory />
        </div>
      </div>
    </section>
  );
}
