import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { audioUnsaved, useSongLibrary } from "@/song/library";
import { mountLeaveGuard, useLeaveGuard } from "@/song/leave-guard";
import { useSong } from "@/song/store";

export type SaveIndicatorState =
  { kind: "saved" } | { kind: "saving"; step: string } | { kind: "unsaved"; inLibrary: boolean } | { kind: "failed"; message: string };

/** What the Song header shows about saving. A failure outranks everything, since the user has to do something about it. */
export function saveIndicator(input: {
  hasSong: boolean;
  inLibrary: boolean;
  audioUnsaved: boolean;
  saveStep: string;
  saveError: string;
}): SaveIndicatorState | null {
  if (!input.hasSong) return null;
  if (input.saveStep) return { kind: "saving", step: input.saveStep };
  if (input.saveError) return { kind: "failed", message: input.saveError };
  // A file that was opened and never saved is not in the library, so nothing of it is safe yet. A library song is unsaved only while its audio waits.
  if (!input.inLibrary || input.audioUnsaved) return { kind: "unsaved", inLibrary: input.inLibrary };
  return { kind: "saved" };
}

/** The title a song is saved under when it has none yet: its file name without the extension, as the Songs & playlists tab fills in. */
export const defaultTitle = (name: string): string => name.replace(/\.[^.]+$/, "");

/** The save state next to the song's name: Saved, Saving…, Not saved, or Couldn't save, with a button where there is something to do. */
export function SaveIndicator() {
  const source = useSong((s) => s.source);
  const stems = useSong((s) => s.stems);
  const saveStep = useSongLibrary((s) => s.saveStep);
  const saveError = useSongLibrary((s) => s.saveError);
  const saved = useSongLibrary((s) => s.index.songs.find((song) => song.id === source?.libraryId));
  const state = saveIndicator({
    hasSong: !!source,
    inLibrary: !!source?.libraryId,
    audioUnsaved: audioUnsaved(source, stems, saved),
    saveStep,
    saveError,
  });
  if (!state || !source) return null;
  const save = () => void useSongLibrary.getState().save(saved?.title ?? defaultTitle(source.name), saved?.artist ?? "");
  return (
    <span role="status" className="flex items-center gap-2 text-[12px]">
      {state.kind === "saved" && <span className="text-silkscreen-3">Saved</span>}
      {state.kind === "saving" && (
        <span className="flex items-center gap-1.5 text-silkscreen-3">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Saving… {state.step}
        </span>
      )}
      {state.kind === "unsaved" && (
        <>
          <span className="text-amber-400">Not saved</span>
          <Button size="sm" variant="outline" onClick={save}>
            {state.inLibrary ? "Save" : "Save to library"}
          </Button>
        </>
      )}
      {state.kind === "failed" && (
        <>
          <span className="text-red-400" title={state.message}>
            Couldn't save
          </span>
          <Button size="sm" variant="outline" title={state.message} onClick={save}>
            Try again
          </Button>
        </>
      )}
    </span>
  );
}

/** The question before the open song is replaced while its audio isn't saved. Also stops the window closing on it (the web build). */
export function SaveBeforeLeaving() {
  const asking = useLeaveGuard((s) => s.asking);
  useEffect(() => mountLeaveGuard(), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const { source, stems } = useSong.getState();
      const saved = useSongLibrary.getState().index.songs.find((song) => song.id === source?.libraryId);
      if (!audioUnsaved(source, stems, saved)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return (
    <Dialog open={!!asking} onOpenChange={(open) => !open && asking?.answer("cancel")}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asking?.title}</DialogTitle>
          <DialogDescription>{asking?.detail}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => asking?.answer("cancel")}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => asking?.answer("discard")}>
            Don't save
          </Button>
          <Button onClick={() => asking?.answer("save")}>Save and continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
