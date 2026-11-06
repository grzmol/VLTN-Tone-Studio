import { create } from "zustand";
import type { TriggerCc } from "./midi-chase";
import { PEDAL_PROFILES, parsePedalProfile, type PedalProfile } from "./pedal-profiles";
const key = "vltn.midi-pedals.v1";
export const DEFAULT_PEDAL_CHANNELS: Record<string, number> = {
  "strymon-timeline": 1,
  "boss-rc10r": 2,
  "boss-ir200": 3,
  "boss-sy200": 4,
};
/** A pedal as Performance sees it: the channel it is set to, and the trigger controllers its commands use. */
export interface ConfiguredPedal {
  name: string;
  channel: number;
  /** Trigger commands whose CC is not assigned yet, so the app cannot tell which controller they use. */
  unassigned: number;
  /** Trigger controllers that are assigned, on this pedal's channel. Chases never replay them (see midi-chase.ts). */
  triggers: TriggerCc[];
}

/** `cc $channel <number or $cc> …`, the form every profile uses for a controller. */
const CC_COMMAND = /^cc \$channel (\$cc|\d+) /;

/**
 * Every built-in and imported pedal with its channel and trigger controllers. A trigger command that names `$cc` uses the CC the user
 * assigned in the command builder; one without an assignment counts as unassigned. Fixed CC numbers are used as they are.
 */
export function configuredPedals(library: Pick<LibraryData, "profiles" | "channels" | "assignments">): ConfiguredPedal[] {
  return [...PEDAL_PROFILES, ...library.profiles].map((profile) => {
    const channel = library.channels[profile.id] ?? DEFAULT_PEDAL_CHANNELS[profile.id] ?? 1;
    const triggers: TriggerCc[] = [];
    let unassigned = 0;
    for (const action of profile.actions) {
      if (!action.momentary) continue;
      const matches = action.commands.map((command) => CC_COMMAND.exec(command)?.[1]).filter((cc): cc is string => cc !== undefined);
      const assigned = library.assignments[profile.id + ":" + action.id];
      const usesAssignment = matches.includes("$cc");
      if (usesAssignment && assigned === undefined) unassigned++;
      const ccs = new Set([...matches.filter((cc) => cc !== "$cc").map(Number), ...(usesAssignment && assigned !== undefined ? [assigned] : [])]);
      for (const cc of ccs) triggers.push([channel, cc]);
    }
    return { name: profile.name, channel, unassigned, triggers };
  });
}

interface LibraryData {
  profiles: PedalProfile[];
  channels: Record<string, number>;
  assignments: Record<string, number>;
}
function read(): LibraryData {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      profiles: (Array.isArray(data.profiles) ? data.profiles : [])
        .map((p: unknown) => parsePedalProfile(JSON.stringify(p)))
        .filter((p: PedalProfile) => !PEDAL_PROFILES.some((b) => b.id === p.id)),
      channels: data.channels || {},
      assignments: data.assignments || {},
    };
  } catch {
    return { profiles: [], channels: {}, assignments: {} };
  }
}
export const usePedalLibrary = create<
  LibraryData & {
    importProfile: (text: string) => PedalProfile;
    setChannel: (id: string, channel: number) => void;
    setAssignment: (id: string, action: string, cc: number) => void;
  }
>((set, get) => {
  const save = (patch: Partial<LibraryData>) => {
    const current = get();
    const data = { profiles: current.profiles, channels: current.channels, assignments: current.assignments, ...patch };
    localStorage.setItem(key, JSON.stringify(data));
    set(patch);
  };
  return {
    ...read(),
    importProfile(text) {
      const profile = parsePedalProfile(text);
      if (PEDAL_PROFILES.some((p) => p.id === profile.id)) throw new Error("Built-in profiles cannot be overwritten. Give the custom profile a different id.");
      save({ profiles: [...get().profiles.filter((p) => p.id !== profile.id), profile] });
      return profile;
    },
    setChannel(id, channel) {
      if (!Number.isInteger(channel) || channel < 1 || channel > 16) throw new Error("MIDI channels are 1–16.");
      save({ channels: { ...get().channels, [id]: channel } });
    },
    setAssignment(id, action, cc) {
      if (!Number.isInteger(cc) || !((cc >= 1 && cc <= 31) || (cc >= 64 && cc <= 95))) throw new Error("Assigned CC numbers are 1–31 or 64–95.");
      save({ assignments: { ...get().assignments, [id + ":" + action]: cc } });
    },
  };
});
