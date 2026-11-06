import { useEffect, useState } from "react";
import { usePlaybackClock, useCountInBeats } from "@/song/performance/playback-clock";

/** Index of the song beat that is sounding, or -1 while stopped or before the first beat. Only a change of beat re-renders. */
function useBeatIndex(bpm: number, firstBeat: number): number {
  return usePlaybackClock((s) => (s.playing && bpm > 0 ? Math.max(-1, Math.floor(((s.position - firstBeat) * bpm) / 60 + 1e-6)) : -1));
}

/** The beat grid the indicators follow. */
export interface BeatGrid {
  bpm: number;
  beats: number;
  firstBeat: number;
}

/**
 * A dot that flashes on each song beat, in the accent colour on the downbeat. It is remounted on every beat, so the flash plays again each
 * time. During a count-in it counts the clicks down to the audio instead.
 */
export function BeatIndicator({ bpm, beats, firstBeat, large = false }: BeatGrid & { large?: boolean }) {
  const beat = useBeatIndex(bpm, firstBeat);
  const countIn = useCountInBeats(bpm);
  const downbeat = beat >= 0 && beat % beats === 0;
  if (countIn > 0) {
    return (
      <span role="status" aria-label={`Count-in ${countIn}`} className={`font-bold text-amber-400 ${large ? "text-5xl" : "text-base"}`}>
        {countIn}
      </span>
    );
  }
  const box = large ? "size-14" : "size-4";
  return (
    <span role="img" aria-label={downbeat ? "Downbeat" : "Beat"} className={`relative inline-flex items-center justify-center ${box}`}>
      <span className="absolute inline-flex size-full rounded-full border border-seam" />
      {beat >= 0 && (
        <span key={beat} className={`absolute inline-flex size-full animate-ping rounded-full ${downbeat ? "bg-amber-400" : "bg-sky-400"} opacity-75`} />
      )}
    </span>
  );
}

/**
 * A frame around the whole stage view that flashes on each song beat, for performers who cannot look at the dot. Off unless the stage view
 * turns it on. It does not show during a count-in.
 */
export function EdgeFlash({ bpm, beats, firstBeat }: BeatGrid) {
  const beat = useBeatIndex(bpm, firstBeat);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (beat < 0) return;
    setLit(true);
    const timer = setTimeout(() => setLit(false), 150);
    return () => clearTimeout(timer);
  }, [beat]);
  const downbeat = beat >= 0 && beat % beats === 0;
  const colour = downbeat ? "border-amber-400" : "border-sky-400";
  const visibility = lit ? "opacity-100" : "opacity-0";
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed inset-0 z-40 border-[12px] transition-opacity duration-150 ${colour} ${visibility}`}
    />
  );
}
