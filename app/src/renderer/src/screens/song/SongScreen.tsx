import { useRef } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notifyError } from "@/app/notify";
import { useFileHandler, type OpenFile } from "@/state/ui";
import { usePedalNameOrBoth } from "@/state/device";
import { AUDIO_ACCEPT } from "@/song/decode";
import { useSongLibrary } from "@/song/library";
import { useNav } from "@/state/nav";
import { useSong } from "@/song/store";
import type { SongSource } from "@/song/types";
import type { LibrarySong } from "@shared/song-library";
import { StemsPanel } from "./stems/StemsPanel";
import { ToneMatchPanel } from "./tonematch/ToneMatchPanel";
import { SongLibraryPanel } from "./SongLibraryPanel";
import { PerformancePanel } from "./PerformancePanel";
import { useSongTab, type SongTab } from "./tab";

/** Decode `file`; the Stems tab then offers the model and quality choice before the split. */
export async function openSong(file: File): Promise<void> {
  if (useSongLibrary.getState().busy) return;
  useSongLibrary.getState().pausePlaylist();
  useNav.getState().go("song", "stems");
  await useSong.getState().load(file);
}

/** Audio files dropped on the window or opened while this screen is showing. */
function openSongFiles(files: OpenFile[]) {
  const f = files[0];
  if (!f) return;
  if (f.file) void openSong(f.file);
  else notifyError(`Couldn't open ${f.name}`, new Error("Drop the file onto the Song screen, or choose it with Open a song."));
}

/**
 * The line under the Song heading. A saved song shows its title, then its artist when it has one. An unsaved file shows its file name.
 * With no song open, `hint` says what the screen is for.
 */
export function songHeadline(source: SongSource | null, saved: Pick<LibrarySong, "title" | "artist"> | undefined, hint: string): string {
  if (!source) return hint;
  if (!source.libraryId || !saved) return source.name;
  return saved.artist.trim() ? `${saved.title} · ${saved.artist.trim()}` : saved.title;
}

/** Song (Stem Splitter + Tone Match): split a song into stems on this computer, then match its guitar tone. */
export function SongScreen() {
  const [tab, setTab] = useSongTab();
  const source = useSong((s) => s.source);
  const libraryId = source?.libraryId;
  const saved = useSongLibrary((s) => (libraryId ? s.index.songs.find((song) => song.id === libraryId) : undefined));
  const fileInput = useRef<HTMLInputElement>(null);
  // Before any pedal was connected the tone can be for any supported model.
  const pedal = usePedalNameOrBoth();
  useFileHandler("audio", openSongFiles);
  useFileHandler("wav", openSongFiles);
  const pick = () => fileInput.current?.click();

  return (
    <div className="flex h-full min-h-0 flex-col px-6 pb-4">
      <input
        ref={fileInput}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void openSong(file);
        }}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as SongTab)} className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 pt-5 pb-1">
          <h1 className="col-start-1 row-start-1 text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-balance">Song</h1>
          <p className="col-start-1 row-start-2 mt-1.5 truncate text-[12px] text-silkscreen-3">
            {songHeadline(source, saved, `Split a song into stems on this computer, then find a ${pedal} tone for its guitar.`)}
          </p>
          <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-3">
            <TabsList aria-label="Song">
              <TabsTrigger value="songs">Songs & playlists</TabsTrigger>
              <TabsTrigger value="stems">Stems</TabsTrigger>
              <TabsTrigger value="tone">Tone match</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>
            {source && (
              <Button variant="outline" onClick={pick}>
                <FileUp data-icon="inline-start" />
                Open another song…
              </Button>
            )}
          </div>
        </div>
        <TabsContent value="songs" className="flex min-h-0 flex-col"><SongLibraryPanel onPick={pick} /></TabsContent>
        <TabsContent value="stems" className="flex min-h-0 flex-col">
          <StemsPanel onPick={pick} />
        </TabsContent>
        <TabsContent value="tone" className="flex min-h-0 flex-col">
          <ToneMatchPanel />
        </TabsContent>
        {/* Kept mounted on the other tabs: a set or song playing on Performance keeps playing (and can be edited) while hidden. */}
        <TabsContent value="performance" forceMount hidden={tab !== "performance"} className="flex min-h-0 flex-col">
          <PerformancePanel shown={tab === "performance"} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
