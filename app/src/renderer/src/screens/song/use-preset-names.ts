import { useDevice } from "@/state/device";
import { loadCachedNames, loadDevice } from "@/state/device-storage";
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

/** The model of the pedal whose names are known: the connected one, else the last one connected. */
function presetModelInUse(): PresetModel | null {
  const { device, status } = useDevice.getState();
  const model = status === "connected" && device ? device : loadDevice();
  return model === "gp150" || model === "gp180" ? model : null;
}

/** The names a preflight can check cues against, or undefined while no GP-150 / GP-180 has been read. */
export function knownPresetNames(): PresetNames | undefined {
  const model = presetModelInUse();
  return (model && currentPresetNames(model)) || undefined;
}

/** `knownPresetNames` for a screen, refreshed with the pedal's connection and names. */
export function useKnownPresetNames(): PresetNames | undefined {
  useDevice((s) => s.names);
  useDevice((s) => s.status);
  useDevice((s) => s.device);
  return knownPresetNames();
}
