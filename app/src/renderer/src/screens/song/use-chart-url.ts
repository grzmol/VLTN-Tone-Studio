import { useEffect, useState } from "react";
import { host } from "@/host";

/**
 * The library address of a saved song's PDF, for the audience display. It is read again when the PDF changes (its revision). Null
 * until it is known, and always null in the browser build, which has no song library.
 */
export function useChartUrl(songId: string | undefined, revision: string): string | null {
  const [found, setFound] = useState<{ revision: string; url: string } | null>(null);
  useEffect(() => {
    if (!songId || !revision) return;
    let live = true;
    void host.song.library
      ?.chartUrls(songId)
      .then((urls) => {
        if (live && urls) setFound({ revision, url: urls.pdf });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [songId, revision]);
  return found?.revision === revision ? found.url : null;
}
