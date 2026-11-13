import { useEffect } from "react";
import { startResumeOffer } from "@/song/performance/resume-offer";
import { notifyError } from "./notify";

/** On start, offers to resume the set from where the music stopped (spec 120). `?recovered=1` means the window was reloaded after a crash. */
export function useResumeAfterCrash(): void {
  useEffect(() => {
    const recovered = new URLSearchParams(location.search).get("recovered") === "1";
    void startResumeOffer(recovered).catch((e) => notifyError("Couldn't reload the set", e));
  }, []);
}
