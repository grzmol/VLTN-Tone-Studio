// The audience window's only bridge (spec 43). It is sandboxed: it reads the state the main process forwards, and sends nothing back.
// The latest state is kept here, so a page that subscribes after the update arrived still gets it.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { mergeAudienceState, type AudienceState, type AudienceUpdate } from "@shared/audience";

let state: AudienceState = { model: null, clock: null };
const listeners = new Set<(state: AudienceState) => void>();

ipcRenderer.on("audience:update", (_e: IpcRendererEvent, update: AudienceUpdate) => {
  state = mergeAudienceState(state, update);
  for (const listener of listeners) listener(state);
});

contextBridge.exposeInMainWorld("audienceFeed", {
  subscribe(callback: (state: AudienceState) => void): () => void {
    listeners.add(callback);
    if (state.model || state.clock) callback(state);
    return () => {
      listeners.delete(callback);
    };
  },
});
