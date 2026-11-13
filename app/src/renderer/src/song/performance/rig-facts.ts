// Gathers what rigCheck needs from the device store and the app's own settings.
import { PEDAL_PROFILES } from "./pedal-profiles";
import { configuredPedals, usePedalLibrary } from "./pedal-library";
import { useMidiConfiguration } from "./midi-configuration";
import type { RigFacts } from "./rig-check";
import { useDevice } from "@/state/device";

type Library = Parameters<typeof configuredPedals>[0];

const GP_PROFILE_IDS = ["valeton-gp180", "valeton-gp150"];
const DEFAULT_GP_CHANNEL = 1;

/** The channel the app's GP-150 / GP-180 commands go out on: the pedal's own profile, as set in the MIDI pedals list. */
export function gpChannel(library: Pick<Library, "channels">, device: "gp150" | "gp180"): number {
  return library.channels[`valeton-${device}`] ?? DEFAULT_GP_CHANNEL;
}

/**
 * The channels of the pedals after the GP that the user has set up: an imported profile, or a built-in one whose channel was saved. A
 * built-in pedal nobody touched is not in the rig, so it does not count against the GP's settings.
 */
export function otherPedalChannels(library: Library): number[] {
  const imported = new Set(library.profiles.map((profile) => profile.id));
  const pedals = configuredPedals(library);
  return [...PEDAL_PROFILES, ...library.profiles].flatMap((profile, i) =>
    !GP_PROFILE_IDS.includes(profile.id) && (imported.has(profile.id) || profile.id in library.channels) ? [pedals[i].channel] : [],
  );
}

/** The facts for a connected GP-150 / GP-180, or null for any other device or no connection. */
export function rigFacts(
  pedal: { device: string | null; status: string; globals: RigFacts["globals"] | null },
  library: Library,
  config: { output: { transport: "system" | "bluetooth" } | null; tempoOnStart: boolean },
  clock: boolean,
): RigFacts | null {
  const { device, status, globals } = pedal;
  if ((device !== "gp150" && device !== "gp180") || status !== "connected") return null;
  const others = otherPedalChannels(library);
  return {
    device,
    globals: globals ?? {},
    transport: config.output?.transport ?? null,
    pedalChannel: gpChannel(library, device),
    otherChannels: others,
    appClock: clock,
    tempoOnStart: config.tempoOnStart,
    downstreamPedals: others.length > 0,
  };
}

/** The same from the stores' current state, for a check that is not tied to a rendered component. */
export function currentRigFacts(clock: boolean): RigFacts | null {
  return rigFacts(useDevice.getState(), usePedalLibrary.getState(), useMidiConfiguration.getState(), clock);
}
