import { useEffect } from "react";
import { startResumeOffer } from "@/song/performance/resume-offer";
import { notifyError } from "./notify";

/** On start, offers to resume the set from where the music stopped (spec 120). `?recovered=1` means the window was reloaded after a crash. */
export function useResumeAfterCrash(): void {
  useEffect(() => {
    const recovered = new URLSearchParams(location.search).get("recovered") === "1";
    // Drop the flag so a later manual reload is not taken for a crash.
    if (recovered) history.replaceState(null, "", location.pathname + location.search.replace(/[?&]recovered=1/, "").replace(/^&/, "?") + location.hash);
    void startResumeOffer(recovered).catch((e) => notifyError("Couldn't reload the set", e));
  }, []);
}
