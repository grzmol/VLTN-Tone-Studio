import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useSongLibrary } from "@/song/library";
import { patchCues, patchPedal, patchText } from "@/song/performance/position";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { tempo } from "./format";

/**
 * What the chart area shows between songs of a set: the song that plays next, its key and tempo, the first pedal preset, whether the
 * pedals are ready and a big Play button.
 */
export function StageSetCard({
  session,
  title,
  artist,
  songKey,
  bpm,
}: {
  session: PerformanceSession;
  title: string;
  artist: string;
  songKey?: string;
  bpm?: number;
}) {
  const library = useSongLibrary();
  const player = useSession(session, (s) => s.player);
  const starting = useSession(session, (s) => s.starting);
  const parseError = useSession(session, (s) => s.parseError);
  const cues = useSession(session, (s) => s.cues);
  const ready = useSession(session, (s) => s.pedalsReady);
  const settings = useSession(session, (s) => s.preparationSettings);
  const first = useMemo(() => patchCues(cues)[0], [cues]);
  const pedals = ready ? "Ready" : settings?.enabled ? "Not prepared yet: press Prepare pedals" : "No setup commands";
  return (
    <div aria-label="Next song" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
      <div>
        <p className="text-lg text-silkscreen-3">Next song</p>
        <h3 className="text-5xl font-bold">{title}</h3>
        {artist && <p className="mt-1 text-2xl text-silkscreen-3">{artist}</p>}
      </div>
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-2 text-left text-2xl">
        {songKey && (
          <>
            <dt className="text-silkscreen-3">Key</dt>
            <dd className="font-semibold">{songKey}</dd>
          </>
        )}
        {bpm ? (
          <>
            <dt className="text-silkscreen-3">Tempo</dt>
            <dd className="font-semibold">{tempo(bpm)}</dd>
          </>
        ) : null}
        {first && (
          <>
            <dt className="text-silkscreen-3">First preset</dt>
            <dd className="font-semibold">
              {patchPedal(first)}: {patchText(first)}
            </dd>
          </>
        )}
        <dt className="text-silkscreen-3">Pedals</dt>
        <dd className="font-semibold">{pedals}</dd>
      </dl>
      <Button
        className="min-h-20 min-w-64 text-3xl"
        disabled={!starting && (!player || !!parseError || library.busy)}
        onClick={() => (starting ? session.cancelStart() : session.startPlayback())}
      >
        {starting ? "Cancel start" : "Play"}
      </Button>
    </div>
  );
}
