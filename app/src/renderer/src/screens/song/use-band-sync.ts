import { useEffect } from "react";
import { host } from "@/host";
import type { PerformanceSession } from "@/song/performance/session";

/** Runs the transport actions that band followers ask for, on the performance screen (spec 44). Nothing runs while band sync is off. */
export function useBandSyncControl(session: PerformanceSession): void {
  useEffect(() => host.bandSync?.onControl((action) => session.runFollowerAction(action)), [session]);
}
