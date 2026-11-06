import { expect, it } from "vitest";
import { useMidiDiagnostics } from "./midi-diagnostics";
it("bounds recent cue history without clock flooding and accumulates late dispatches/failures until reset", () => {
  const state = useMidiDiagnostics.getState();
  state.reset();
  for (let i = 0; i < 100; i++) state.record({ label: "Cue " + i, intended: 0, queued: i, lateMs: i, bytes: [192, i % 128] });
  state.record({ label: "Clock", intended: 100, queued: 100, lateMs: 0, bytes: [248] });
  state.fault("Port lost");
  expect(useMidiDiagnostics.getState()).toMatchObject({ queued: 101, late: 94, maxLateMs: 99, failures: 1, lastFailure: "Port lost" });
  expect(useMidiDiagnostics.getState().recent).toHaveLength(30);
  expect(useMidiDiagnostics.getState().recent[0].label).toBe("Cue 99");
  state.reset();
  expect(useMidiDiagnostics.getState()).toMatchObject({ queued: 0, recent: [], failures: 0 });
});
it("counts dropped commands and resyncs, keeps the dropped bytes for a later chase, and clears them on reset", () => {
  const state = useMidiDiagnostics.getState();
  state.reset();
  state.resync();
  state.drop([
    { label: "Cue A", intended: 0, queued: 300, lateMs: 300, bytes: [192, 1] },
    { label: "Cue B", intended: 0, queued: 300, lateMs: 300, bytes: [192, 2] },
  ]);
  expect(useMidiDiagnostics.getState()).toMatchObject({ dropped: 2, resyncs: 1, failures: 0 });
  expect(useMidiDiagnostics.getState().droppedMessages.map((m) => m.bytes)).toEqual([
    [192, 2],
    [192, 1],
  ]);
  state.reset();
  expect(useMidiDiagnostics.getState()).toMatchObject({ dropped: 0, resyncs: 0, droppedMessages: [] });
});

it("keeps quarter frames out of the recent list, which is for notes and commands", () => {
  useMidiDiagnostics.getState().reset();
  useMidiDiagnostics.getState().record({ label: "MIDI timecode", intended: 0, queued: 0, lateMs: 0, bytes: [0xf1, 0x72] });
  expect(useMidiDiagnostics.getState().queued).toBe(1);
  expect(useMidiDiagnostics.getState().recent).toEqual([]);
});
