/** A physical controller must see a press before its release. Times use performance.now(). */
export const TRIGGER_HOLD_MS = 100;
const RESET_MS = 10;
interface Pulse {
  press: number | null;
  release: number | null;
}
interface ControlState {
  bytes: number[];
  pending: Pulse[];
}

/** Output queues outlive song sessions. Keep every pending interval until it can no longer affect cleanup. */
export class TriggerPulses {
  private outputs = new WeakMap<object, Map<string, ControlState>>();

  timestamp(output: object, bytes: number[], timestamp: number | undefined, now: number): number | undefined {
    if (bytes.length !== 3 || (bytes[0] & 240) !== 176 || ![0, 127].includes(bytes[2])) return timestamp;
    const controls = this.outputs.get(output) ?? new Map<string, ControlState>();
    this.outputs.set(output, controls);
    const key = `${bytes[0]}:${bytes[1]}`;
    const control = controls.get(key) ?? { bytes: [bytes[0], bytes[1], 0], pending: [] };
    control.pending = control.pending.filter((pulse) => pulse.release === null || pulse.release + RESET_MS > now);
    const previous = control.pending.at(-1);
    const requested = Math.max(now, timestamp ?? now);
    let at = requested;
    if (bytes[2] === 127) {
      if (previous?.release !== null && previous?.release !== undefined) at = Math.max(at, previous.release + RESET_MS);
      control.pending.push({ press: at, release: null });
    } else {
      if (previous?.press !== null && previous?.press !== undefined) at = Math.max(at, previous.press + TRIGGER_HOLD_MS);
      if (previous && previous.release === null) previous.release = at;
      else control.pending.push({ press: null, release: at });
    }
    controls.set(key, control);
    return at > requested ? at : timestamp;
  }

  /** Cancel future presses, but preserve the release of any press that could already be on the wire. */
  releasesAfterClear(output: object, now: number): { bytes: number[]; timestamp: number }[] {
    const controls = this.outputs.get(output);
    if (!controls) return [];
    const releases: { bytes: number[]; timestamp: number }[] = [];
    for (const [key, control] of controls) {
      const active = control.pending.filter((pulse) => pulse.press !== null && pulse.press <= now && (pulse.release === null || pulse.release > now));
      if (!active.length) {
        controls.delete(key);
        continue;
      }
      const press = Math.max(...active.map((pulse) => pulse.press!));
      const timestamp = Math.max(now, press + TRIGGER_HOLD_MS);
      releases.push({ bytes: [...control.bytes], timestamp });
      control.pending = [{ press, release: timestamp }];
    }
    return releases;
  }
}
