import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { QUEUE_MAX, isEditable, upcoming } from "@/song/queue";
import { formatTime } from "@/song/stems/mix";
import { EntryOverrideControls } from "./EntryOverrideControls";
import { runningSeconds } from "@/song/performance/running-time";

const row = "flex flex-wrap items-center gap-2 rounded border border-seam p-2";

/** The number of songs in the queue. The limit is named only when the queue is full, since it is not a position. */
export function queueCount(songs: number): string {
  if (songs >= QUEUE_MAX) return `Queue full (${QUEUE_MAX} songs)`;
  return `${songs} ${songs === 1 ? "song" : "songs"}`;
}

/**
 * The queue: the song playing, then the songs still to come. The playing song and the songs before it are locked. Upcoming songs can be
 * dragged or moved, sent to the top or bottom, or removed. Each edit changes only the queue; playback carries on, and the next song is
 * prepared again when the edit changes it.
 */
export function QueuePanel() {
  const library = useSongLibrary();
  const [hint, setHint] = useState("");
  const dragging = useRef<number | null>(null);
  const state = { queue: library.queue, position: library.position };
  const title = (id: string) => library.index.songs.find((s) => s.id === id)?.title ?? "Missing song";
  const duration = (id: string) => {
    const song = library.index.songs.find((s) => s.id === id);
    return song ? runningSeconds(song) : 0;
  };
  const playing = library.position >= 0 ? library.queue[library.position] : undefined;
  const rest = upcoming(state);
  const busy = library.busy;
  const edit = (reason: string | null) => setHint(reason ?? "");
  const remaining = rest.reduce((sum, id) => sum + duration(id), 0);
  return (
    <section aria-label="Queue" className="space-y-3 rounded border border-seam p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Queue</h2>
        <p className="text-sm text-silkscreen-3">
          {queueCount(library.queue.length)} · {rest.length} to come · {formatTime(remaining)}
        </p>
      </div>
      {playing === undefined ? (
        <p className="text-sm">Load a song to start the queue. Songs you add then play after it.</p>
      ) : (
        <p className={row} aria-label="Playing now">
          <strong className="flex-1">Playing: {title(playing)}</strong>
          <span className="text-xs text-silkscreen-3">locked</span>
        </p>
      )}
      <ol className="space-y-2">
        {rest.map((id, i) => {
          const index = library.position + 1 + i;
          return (
            <li
              key={`${index}-${id}`}
              className={row}
              draggable={!busy}
              onDragStart={() => (dragging.current = index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragging.current;
                dragging.current = null;
                if (from !== null) edit(library.moveInQueue(from, index));
              }}
            >
              <span className="flex-1">
                {i + 1}. {title(id)}
              </span>
              <EntryOverrideControls
                label={`Queue entry ${i + 1}`}
                value={library.queueOverrides[index] ?? null}
                disabled={busy}
                onChange={(next) => edit(library.setQueueOverride(index, next))}
              />
              <Button
                variant="outline"
                aria-label={`Move queue entry ${i + 1} up`}
                disabled={busy || !isEditable(state, index - 1)}
                onClick={() => edit(library.moveInQueue(index, index - 1))}
              >
                ↑
              </Button>
              <Button
                variant="outline"
                aria-label={`Move queue entry ${i + 1} down`}
                disabled={busy || index + 1 >= library.queue.length}
                onClick={() => edit(library.moveInQueue(index, index + 1))}
              >
                ↓
              </Button>
              <Button
                variant="outline"
                aria-label={`Move queue entry ${i + 1} to top`}
                disabled={busy || i === 0}
                onClick={() => edit(library.moveInQueue(index, library.position + 1))}
              >
                To top
              </Button>
              <Button
                variant="outline"
                aria-label={`Move queue entry ${i + 1} to bottom`}
                disabled={busy || index === library.queue.length - 1}
                onClick={() => edit(library.moveInQueue(index, library.queue.length - 1))}
              >
                To bottom
              </Button>
              <Button variant="outline" aria-label={`Remove queue entry ${i + 1}`} disabled={busy} onClick={() => edit(library.removeFromQueue(index))}>
                Remove
              </Button>
            </li>
          );
        })}
      </ol>
      {!rest.length && playing !== undefined && <p className="text-sm text-silkscreen-3">Nothing is queued after this song.</p>}
      {hint && (
        <p role="status" className="text-sm">
          {hint}
        </p>
      )}
    </section>
  );
}
