import { useDevice } from "@/state/device";
import { loadCachedNames } from "@/state/device-storage";
import { usablePresetNames, type PresetModel, type PresetNames } from "@/song/performance/pedal-preset-names";

/** The names of `model`'s presets as of now: read from a connected pedal of that model, else cached from its last connection. */
export function currentPresetNames(model: PresetModel): PresetNames | null {
  const { device, status, names } = useDevice.getState();
  const live = status === "connected" && device === model ? { names: names.map((n) => n.name), source: "live" as const } : null;
  const cached: string[] = [];
  for (const n of loadCachedNames(model)) cached[n.slot] = n.name;
  return usablePresetNames(
    model,
    live,
    Array.from(cached, (n) => n ?? ""),
  );
}

/** `currentPresetNames` for a screen, refreshed when the pedal connects, disconnects or reads its names. */
export function usePresetNames(model: PresetModel | null): { presetNames: PresetNames | null; lastConnectedAt: number | null } {
  const lastConnectedAt = useDevice((s) => s.lastConnectedAt);
  // The selector subscribes to every change that can alter the result; the value itself is rebuilt from the store.
  useDevice((s) => s.names);
  useDevice((s) => s.status);
  useDevice((s) => s.device);
  return { presetNames: model ? currentPresetNames(model) : null, lastConnectedAt };
}
