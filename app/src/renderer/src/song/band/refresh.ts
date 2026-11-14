import { create } from "zustand";

export const useBandRefreshStatus = create<{ key: string; message: string }>(() => ({ key: "", message: "" }));
/** A song's generated parts finish updating before its transport starts. The panel owns the worker and cancels it on song changes. */
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
