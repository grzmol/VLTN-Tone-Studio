import { create } from "zustand";
export interface MidiTimingEvent {
  label: string;
  intended: number;
  queued: number;
  lateMs: number;
  bytes: number[];
  byteCount?: number;
}
const empty = () => ({
  queued: 0,
  late: 0,
  maxLateMs: 0,
  failures: 0,
  lastFailure: "",
  recent: [] as MidiTimingEvent[],
  /** Late commands that were not sent. Kept (bounded) so a later chase can resend the state that should be current. */
  dropped: 0,
  droppedMessages: [] as MidiTimingEvent[],
  resyncs: 0,
});
export const useMidiDiagnostics = create<
  ReturnType<typeof empty> & {
    record: (event: MidiTimingEvent) => void;
    drop: (events: MidiTimingEvent[]) => void;
    resync: () => void;
    fault: (error: string) => void;
    reset: () => void;
  }
>((set) => ({
  ...empty(),
  record(event) {
    set((s) => ({
      queued: s.queued + 1,
      late: s.late + (event.lateMs > 5 ? 1 : 0),
      maxLateMs: Math.max(s.maxLateMs, event.lateMs),
      recent:
        event.bytes[0] === 248 || event.bytes[0] === 241
          ? s.recent
          : [{ ...event, bytes: event.bytes.slice(0, 32), byteCount: event.bytes.length }, ...s.recent].slice(0, 30),
    }));
  },
  drop(events) {
    set((s) => ({
      dropped: s.dropped + events.length,
      droppedMessages: [...events.map((e) => ({ ...e, bytes: e.bytes.slice(0, 32), byteCount: e.bytes.length })).reverse(), ...s.droppedMessages].slice(0, 30),
    }));
  },
  resync() {
    set((s) => ({ resyncs: s.resyncs + 1 }));
  },
  fault(error) {
    set((s) => ({ failures: s.failures + 1, lastFailure: error }));
  },
  reset() {
    set(empty());
  },
}));
