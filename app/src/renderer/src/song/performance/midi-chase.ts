import type { Cue } from "./chart";

export interface ChaseMessage {
  bytes: number[];
  /** Song position of the cue the state came from. */
  time: number;
}

/** The chase is sent this long before the start position so the pedals have settled when the song begins. */
export const CHASE_LEAD_MS = 100;

/**
 * Controller numbers that every built-in pedal profile uses only for triggers (looper, tap tempo, footswitch presses, patch step).
 * A raw cue cannot say which pedal it targets, so these are not replayed unless the cue is marked `{chase}`. Numbers that some profile
 * uses for a lasting parameter are left out; cues built from the pedal library carry `{nochase}` instead.
 * Kept literal so the scheduler worker stays free of the profile data; midi-chase.test.ts checks it against the profiles.
 */
export const MOMENTARY_CCS: ReadonlySet<number> = new Set([24, 64, 65, 75, 80, 82, 85, 86, 87, 89, 90, 93, 125]);

/** A pedal's trigger controller: its channel as the pedal is set (1–16) and its CC number. */
export type TriggerCc = [channel: number, cc: number];

/** Key of a trigger in the set that `chaseTriggerSet` builds. */
export const triggerKey = (channel: number, cc: number) => `${channel}:${cc}`;

/** The set `isChased` checks: each pedal's assigned trigger CCs, keyed by `triggerKey`. */
export function chaseTriggerSet(triggers: readonly TriggerCc[] = []): ReadonlySet<string> {
  return new Set(triggers.map(([channel, cc]) => triggerKey(channel, cc)));
}

const isBank = (cc: number) => cc === 0 || cc === 32;

/**
 * Whether a message from this cue is state worth replaying when the song starts after it. Notes and clock never are, and neither are
 * triggers or the Start/Continue/Stop bytes, which are one-shot actions. Song select is state (it picks the song or pattern), so it is replayed.
 * A controller is a trigger when it is in `triggers` (the CCs the pedal profiles assign to their trigger commands) or in MOMENTARY_CCS.
 */
export function isChased(cue: Cue, bytes: number[], triggers: ReadonlySet<string> = new Set()): boolean {
  if (cue.chase === false || cue.trigger) return false;
  if (bytes[0] === 0xf0) return cue.chase === true;
  if (bytes[0] === 0xf3) return true;
  const kind = bytes[0] & 240;
  if (kind === 0xc0) return true;
  if (kind === 0xb0) {
    if (cue.chase === true) return true;
    return !MOMENTARY_CCS.has(bytes[1]) && !triggers.has(triggerKey((bytes[0] & 15) + 1, bytes[1]));
  }
  return false;
}

/**
 * What the cues at one position send themselves: the channels that get a program change and the controllers (channel and CC number)
 * they send. A chase to that position leaves these out. The cue's own message is the newer state, and a chase sent at the same moment
 * can land after it, so the pedal is left on the old patch. A channel's program change is left out, but the bank in force on that
 * channel is still sent, unless the cue sends that bank itself: the cue's program change lands in the bank the pedal should be in.
 */
export interface SettledState {
  programChannels: ReadonlySet<number>;
  controllers: ReadonlySet<string>;
}

/** What the cues at `position` (within 1 ms) send, as the scheduler sends them. Cues that never send (triggers) are left out. */
export function settledAt(cues: Cue[], position: number): SettledState {
  const programChannels = new Set<number>();
  const controllers = new Set<string>();
  for (const cue of cues) {
    if (!cue.messages.length || cue.trigger || Math.abs(cue.time - position) > 0.001) continue;
    for (const bytes of cue.messages) {
      const kind = bytes[0] & 240;
      const channel = bytes[0] & 15;
      if (kind === 0xc0) programChannels.add(channel);
      else if (kind === 0xb0) controllers.add(`${channel}:${bytes[1]}`);
    }
  }
  return { programChannels, controllers };
}

/** Whether a chased message is one the cues at the chase position send themselves (see `SettledState`). */
function isSettled(bytes: number[], settled: SettledState): boolean {
  const kind = bytes[0] & 240;
  const channel = bytes[0] & 15;
  if (kind === 0xc0) return settled.programChannels.has(channel);
  return kind === 0xb0 && settled.controllers.has(`${channel}:${bytes[1]}`);
}

/**
 * The messages that bring the pedals to the state they would be in at `position` had the song played from the start.
 * Order: song select, then bank select + program change per channel, then controllers, then SysEx; each group in song order.
 * Only the latest value per (channel, controller), the latest program change per channel and the latest song select are kept.
 * `triggers` lists the assigned trigger controllers (see `chaseTriggerSet`), which are never replayed unless a cue says `{chase}`.
 * `settled` lists what the cues at `position` send (see `settledAt`), which is left out so the cue's own message is not overridden.
 */
export function computeChaseState(
  cues: Cue[],
  position: number,
  triggers: ReadonlySet<string> = new Set(),
  settled: SettledState = { programChannels: new Set(), controllers: new Set() },
): ChaseMessage[] {
  const banks = new Map<number, Map<number, ChaseMessage>>();
  const programs = new Map<number, ChaseMessage[]>();
  const controllers = new Map<string, ChaseMessage>();
  const sysex = new Map<string, ChaseMessage>();
  let songSelect: ChaseMessage | null = null;
  const ordered = cues.filter((cue) => cue.messages.length && !cue.trigger && cue.time < position - 0.001).sort((a, b) => a.time - b.time);
  for (const cue of ordered) {
    for (const bytes of cue.messages) {
      if (!isChased(cue, bytes, triggers) || isSettled(bytes, settled)) continue;
      if (bytes[0] === 0xf3) {
        songSelect = { bytes, time: cue.time };
        continue;
      }
      if (bytes[0] === 0xf0) {
        const key = bytes.join(",");
        sysex.delete(key);
        sysex.set(key, { bytes, time: cue.time });
        continue;
      }
      const channel = bytes[0] & 15;
      if ((bytes[0] & 240) === 0xc0) {
        const selected = [...(banks.get(channel)?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
        programs.set(channel, [...selected.map((bank) => ({ bytes: bank.bytes, time: cue.time })), { bytes, time: cue.time }]);
        continue;
      }
      if (isBank(bytes[1])) {
        const channelBanks = banks.get(channel) ?? new Map<number, ChaseMessage>();
        channelBanks.set(bytes[1], { bytes, time: cue.time });
        banks.set(channel, channelBanks);
      }
      const key = `${channel}:${bytes[1]}`;
      controllers.delete(key);
      controllers.set(key, { bytes, time: cue.time });
    }
  }
  // A channel whose program change a cue sends itself still gets the bank in force, so that program change lands in the right bank.
  const bankInForce = [...banks.entries()]
    .filter(([channel]) => settled.programChannels.has(channel))
    .flatMap(([, channelBanks]) => [...channelBanks.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]));
  return [
    ...(songSelect ? [songSelect] : []),
    ...bankInForce,
    ...[...programs.values()].flat(),
    ...[...controllers.values()].filter((m) => !isBank(m.bytes[1])),
    ...sysex.values(),
  ];
}
