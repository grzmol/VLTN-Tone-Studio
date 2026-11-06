import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { formatTime } from "@/song/stems/mix";
import { runningSeconds } from "@/song/performance/running-time";
import { evaluateSmart, validateSmartRules, type SmartRules } from "@shared/library-filter";
import type { Playlist } from "@shared/song-library";
import { FilterBuilder } from "./FilterBuilder";

/**
 * A smart playlist: its rules, and the songs they pick now. Saving the rules changes what the playlist would pick next time. Playing it
 * takes a snapshot of the songs picked at that moment, so a change to the library never reorders the set that is playing.
 */
export function SmartPlaylistEditor({ playlist }: { playlist: Playlist }) {
  const library = useSongLibrary();
  const saved = playlist.smart!;
  const [draft, setDraft] = useState<SmartRules>(saved);
  const [problem, setProblem] = useState("");
  const preview = useMemo(() => evaluateSmart(library.index.songs, library.index.folders, draft), [library.index.songs, library.index.folders, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const ids = preview.songs.map((song) => song.id);
  const save = () => {
    try {
      validateSmartRules(draft);
    } catch (e) {
      return setProblem(e instanceof Error ? e.message : "These rules cannot be saved.");
    }
    setProblem("");
    void library.updatePlaylist(playlist.id, { smart: draft });
  };
  const failed = preview.problems.length > 0;
  return (
    <div className="space-y-3">
      <FilterBuilder value={draft} folders={library.index.folders} onChange={setDraft} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || library.busy} onClick={save}>
          Save rules
        </Button>
        <Button variant="outline" disabled={!dirty} onClick={() => setDraft(saved)}>
          Discard changes
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-400">
          {problem}
        </p>
      )}
      <p className="text-sm">
        {failed
          ? "No songs, until the rules are fixed."
          : `${ids.length} song${ids.length === 1 ? "" : "s"} · ${formatTime(preview.songs.reduce((sum, s) => sum + runningSeconds(s), 0))}`}
        {!dirty && " · saved"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ids.length || failed || library.busy || dirty} onClick={() => void library.playPlaylist(ids)}>
          Play playlist
        </Button>
        <Button variant="outline" disabled={!ids.length || failed || library.busy || dirty} onClick={() => void library.load(ids[0], ids, 0)}>
          Load set paused
        </Button>
        <Button variant="outline" disabled={!ids.length || failed || library.busy} onClick={() => library.addToQueue(ids)}>
          Queue all
        </Button>
      </div>
      <ol className="max-h-64 space-y-1 overflow-auto text-sm">
        {preview.songs.slice(0, 200).map((song, i) => (
          <li key={song.id}>
            {i + 1}. {song.title} <span className="text-silkscreen-3">{song.artist}</span>
          </li>
        ))}
      </ol>
      {preview.songs.length > 200 && <p className="text-sm text-silkscreen-3">Showing the first 200 of {preview.songs.length}.</p>}
    </div>
  );
}
