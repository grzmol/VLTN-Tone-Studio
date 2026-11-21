// Scenes of the active preset on a pedal running the GrooveGurus mod (feature "modScenes"): read them, play one on the
// pedal to edit it on the Rig, and write it back. The device store owns the connection; this store asks its driver.
import { create } from "zustand";
import { NOTIFY, type Scene } from "@/gp200/lib/mod-service.mjs";
import { playPreset } from "@/screens/rig/edits";
import { useHistory } from "@/screens/rig/history";
import { DeviceError, getDriver, onSceneEvent, useDevice } from "./device";
import type { SceneList, SlotScenes } from "./driver/types";
import { applyScene, captureScene, sceneName, scenesOf, withScene, type CapturedScene } from "./scenes-model";

export interface ScenesState {
  /** The record of the active slot as last read; null before the first read or without the feature */
  current: SlotScenes | null;
  loading: boolean;
  /** Why the last read failed */
  error: string | null;
  /** Scene records on the pedal (used per slot, free) */
  list: SceneList | null;
  /** What the pedal reports (NOTIFY): scene mode and the scene it plays (null = the base) */
  pedal: { sceneMode: boolean; activeScene: number | null } | null;
  /** The scene the Rig plays and edits (0-3), or null: edits then go to the base preset as usual */
  editing: number | null;
  /** A scene write is on its way */
  writing: boolean;

  /** Read the active slot's scenes and the record list again. */
  refresh(): Promise<void>;
  /** Play scene `k` on the pedal (the base when it isn't saved yet); Rig edits then build that scene. */
  edit(k: number): Promise<void>;
  /** Play the base again and stop editing the scene. */
  leave(): Promise<void>;
  /** Save what the Rig plays now as scene `k` (its differences from the saved preset). */
  save(k: number): Promise<CapturedScene>;
  rename(k: number, name: string): Promise<void>;
  remove(k: number): Promise<void>;
}

const dev = () => useDevice.getState();

function driverFor(write: boolean) {
  const d = dev();
  const driver = getDriver();
  if (!driver || d.status !== "connected") throw new DeviceError("not-connected", "The pedal is not connected");
  if (!d.can(write ? "modScenesWrite" : "modScenes") || !driver.readScenes) throw new DeviceError("unsafe", write ? "The pedal's mod can't write scenes" : "The pedal doesn't run the GrooveGurus mod");
  if (d.busy) throw new DeviceError("busy", `Wait until the ${d.busy.kind} finishes`);
  return driver;
}

export const useScenes = create<ScenesState>((set, get) => {
  /** Reads of an older slot that finish late are dropped. */
  let readSeq = 0;

  const writable = () => {
    const { current } = get();
    const slot = dev().slot;
    if (slot === null || !current || current.slot !== slot) throw new DeviceError("busy", "The scenes of this preset are still being read");
    if (current.bytes && !current.record) throw new DeviceError("unsafe", `These scenes were saved by a newer mod (${current.error ?? "unknown format"}); Tone Studio can only show that they exist`);
    return { slot, current };
  };

  const write = async (slot: number, scenes: (Scene | null)[]) => {
    const driver = driverFor(true);
    set({ writing: true });
    try {
      const pre2 = get().current?.record?.pre2 ?? null;
      const stored = await driver.writeScenes!(slot, scenes, pre2);
      // The pedal went back to the base (it reloads the active preset after a write): stop editing.
      set({ current: stored, editing: null, error: null });
      await readList();
      return stored;
    } finally {
      set({ writing: false });
    }
  };

  const readList = async () => {
    const driver = getDriver();
    if (!driver?.readSceneList || !dev().can("modScenes")) return;
    try {
      set({ list: await driver.readSceneList() });
    } catch {
      // the list is a convenience (marks, free count); the next event reads it again
    }
  };

  return {
    current: null,
    loading: false,
    error: null,
    list: null,
    pedal: null,
    editing: null,
    writing: false,

    async refresh() {
      const slot = dev().slot;
      const driver = getDriver();
      if (slot === null || !driver?.readScenes || !dev().can("modScenes") || dev().status !== "connected") return;
      const seq = ++readSeq;
      set({ loading: true });
      try {
        const current = await driver.readScenes(slot);
        if (seq === readSeq) set({ current, error: null });
      } catch (e) {
        if (seq === readSeq) set({ error: (e as Error)?.message ?? String(e) });
      } finally {
        if (seq === readSeq) set({ loading: false });
      }
      await readList();
    },

    async edit(k) {
      driverFor(false);
      const { current } = writable();
      const base = dev().saved;
      if (!base) throw new DeviceError("busy", "The preset is still being read");
      const scene = scenesOf(current.record)[k];
      set({ editing: k });
      try {
        await playPreset(scene ? applyScene(base, scene) : base);
      } catch (e) {
        set({ editing: null });
        throw e;
      }
      useHistory.getState().clear();
    },

    async leave() {
      const base = dev().saved;
      set({ editing: null });
      useHistory.getState().clear();
      if (base && dev().status === "connected") await playPreset(base);
    },

    async save(k) {
      const { slot, current } = writable();
      const { saved, preset } = dev();
      if (!saved || !preset) throw new DeviceError("busy", "The preset is still being read");
      const captured = captureScene(saved, preset, k, scenesOf(current.record)[k]);
      await write(slot, withScene(current.record, k, captured.scene));
      return captured;
    },

    async rename(k, name) {
      const { slot, current } = writable();
      const scene = scenesOf(current.record)[k];
      if (!scene) throw new DeviceError("unsafe", "Save the scene before naming it");
      const next = sceneName(name, k);
      if (next === scene.name) return;
      await write(slot, withScene(current.record, k, { ...scene, name: next }));
    },

    async remove(k) {
      const { slot, current } = writable();
      if (!scenesOf(current.record)[k]) return;
      await write(slot, withScene(current.record, k, null));
    },
  };
});

// Follow the connection: read the scenes of each preset that becomes active; forget them when the pedal goes away.
useDevice.subscribe((s, p) => {
  const usable = s.status === "connected" && s.features.includes("modScenes");
  const wasUsable = p.status === "connected" && p.features.includes("modScenes");
  if (!usable) {
    if (wasUsable || useScenes.getState().current) useScenes.setState({ current: null, list: null, pedal: null, editing: null, error: null, loading: false });
    return;
  }
  if (!wasUsable || s.slot !== p.slot) {
    useScenes.setState({ editing: null, ...(s.slot !== useScenes.getState().current?.slot ? { current: null } : {}) });
    void useScenes.getState().refresh();
  }
});

let recordTimer: ReturnType<typeof setTimeout> | undefined;
onSceneEvent((e) => {
  const prev = useScenes.getState().pedal;
  const pedal = { sceneMode: e.sceneMode, activeScene: e.activeScene };
  const changed = !prev || prev.sceneMode !== pedal.sceneMode || prev.activeScene !== pedal.activeScene;
  // The pedal took over the sound (another scene, scene mode, its base): the Rig follows it and stops editing.
  useScenes.setState({ pedal, ...(e.events & NOTIFY.SCENE && changed ? { editing: null } : {}) });
  if (e.events & NOTIFY.RECORD && !useScenes.getState().writing) {
    clearTimeout(recordTimer);
    recordTimer = setTimeout(() => void useScenes.getState().refresh(), 200);
  }
});
