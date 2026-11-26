import { useEffect } from "react";
import { host } from "@/host";
import { useStageActivity } from "@/state/stage-activity";

/** Tells the main process whether a show is running, so quitting or restarting for an update asks first (spec 119). */
export function useShowGuard(): void {
  useEffect(() => {
    const report = (running: boolean) => void host.app.setShowRunning(running).catch(() => {});
    // Always report on mount: after a page reload main may still hold "running" from before, and it must hear that nothing plays.
    report(useStageActivity.getState().busy);
    const unsubscribe = useStageActivity.subscribe((s, prev) => {
      if (s.busy !== prev.busy) report(s.busy);
    });
    return () => {
      unsubscribe();
      report(false);
    };
  }, []);
}
