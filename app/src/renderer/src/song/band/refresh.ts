import { create } from "zustand";

export const useBandRefreshStatus = create<{ key: string; message: string }>(() => ({ key: "", message: "" }));
/** The panel owns background updates and cancels them on song changes or playback. Play never waits for a render or save. */
const refreshers = new Map<string, () => Promise<void>>();
export function registerBandRefresh(key: string, refresh: () => Promise<void>): () => void {
  refreshers.set(key, refresh);
  return () => {
    if (refreshers.get(key) === refresh) refreshers.delete(key);
  };
}
export async function refreshBandBeforePlay(key: string): Promise<void> {
  await refreshers.get(key)?.();
}
