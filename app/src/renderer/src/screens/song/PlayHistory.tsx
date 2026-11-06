import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";

const field = "rounded border border-seam bg-transparent p-2";
const RECENT = 12;

/** The latest plays, the history clearing, and a playlist made from the plays since a date. */
export function PlayHistory() {
  const library = useSongLibrary();
  const [since, setSince] = useState(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const titles = new Map(library.index.songs.map((song) => [song.id, song.title]));
  const setNames = new Map(library.index.playlists.flatMap((playlist) => (playlist.sets ?? []).map((set) => [set.id, `${playlist.name} › ${set.name}`])));
  const plays = library.index.history;
  const recent = plays.slice(-RECENT).reverse();
  return (
    <section aria-label="Play history" className="space-y-3 rounded border border-seam p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">History</h2>
        <p className="text-sm text-silkscreen-3">{plays.length} plays kept</p>
      </div>
      {!recent.length && <p className="text-sm">Songs are added here once they have played to their halfway point.</p>}
      <ol className="space-y-1 text-sm">
        {recent.map((entry, i) => {
          const setName = entry.setId ? setNames.get(entry.setId) : undefined;
          return (
            <li key={`${entry.at}-${i}`}>
              {titles.get(entry.songId) ?? "Removed song"}{" "}
              <span className="text-silkscreen-3">
                · {setName && `${setName} · `}
                {new Date(entry.at).toLocaleString()}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" aria-label="History since" className={field} value={since} onChange={(e) => setSince(e.target.value)} />
        <input aria-label="History playlist name" placeholder="Playlist name" className={field} value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          variant="outline"
          disabled={!name.trim() || !since || !plays.length || library.busy}
          onClick={() => void library.playlistFromHistory(name, new Date(`${since}T00:00:00`).toISOString()).then(() => setName(""))}
        >
          Create playlist from history
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span>Clear all {plays.length} plays?</span>
            <Button
              disabled={library.busy}
              onClick={() => {
                setConfirm(false);
                void library.clearHistory();
              }}
            >
              Confirm clear
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep history
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={!plays.length || library.busy} onClick={() => setConfirm(true)}>
            Clear history…
          </Button>
        )}
      </div>
    </section>
  );
}
