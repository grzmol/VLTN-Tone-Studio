import { fadesOutCached } from "@/song/band/fade-check";
import type { PcmAudio } from "@/song/types";

/** Under a hard ending the original tracks are not changed, so a song that fades out keeps fading. Says so when that is the case. */
export function FadeNotice({ audio }: { audio: readonly PcmAudio[] }) {
  if (!fadesOutCached(audio)) return null;
  return (
    <p role="note" className="basis-full text-silkscreen-3">
      Original tracks still fade here. Set the song's Trim end before the fade for a clean stop.
    </p>
  );
}
