import { useEffect, useMemo, useState } from "react";
import type { Cue } from "@/song/performance/chart";
import { midiPreflight } from "@/song/performance/midi-preflight";
import type { TimecodeRate } from "@/song/performance/timecode";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { useBluetooth, resetBluetoothTiming } from "@/bluetooth/connection";
import { HelpNote } from "@/components/ui/help-note";

/** How often the counters on screen may refresh. The scheduler and Bluetooth writes update their stores far more often than that. */
const REFRESH_MS = 500;

export function MidiHealth({
  cues,
  duration,
  range,
  clock,
  tempoChannel,
  outputName,
  parseError,
  timecode,
}: {
  cues: Cue[];
  duration: number;
  /** The part of a trimmed song that plays, when the song is trimmed */
  range?: { start: number; end: number };
  clock: boolean;
  tempoChannel?: number;
  outputName?: string;
  parseError: string;
  /** Set only while MIDI timecode is on */
  timecode?: { fps: TimecodeRate; offset: string; bluetooth: boolean };
}) {
  const library = usePedalLibrary();
  const report = useMemo(
    () =>
      midiPreflight(cues, {
        duration,
        range,
        clock,
        tempoChannel,
        outputName,
        timecode,
        pedals: configuredPedals(library),
      }),
    [cues, duration, range, clock, tempoChannel, outputName, timecode, library.channels, library.profiles],
  );
  const [timing, setTiming] = useState(() => useMidiDiagnostics.getState());
  const [ble, setBle] = useState(() => useBluetooth.getState().diagnostics);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      timer = undefined;
      setTiming(useMidiDiagnostics.getState());
      setBle(useBluetooth.getState().diagnostics);
    };
    // Throttle on change instead of polling: nothing renders while the stores are quiet.
    const schedule = () => {
      timer ??= setTimeout(refresh, REFRESH_MS);
    };
    const unsubscribe = [useMidiDiagnostics.subscribe(schedule), useBluetooth.subscribe(schedule)];
    return () => {
      clearTimeout(timer);
      unsubscribe.forEach((stop) => stop());
    };
  }, []);
  return (
    <details className="rounded border border-seam p-3" aria-label="MIDI health">
      <summary className="cursor-pointer">
        MIDI preflight & timing · {parseError ? "chart error" : `${report.issues.length} warnings`} · {timing.failures} timing/dispatch failures
      </summary>
      <div className="space-y-3 pt-3 text-sm">
        <p>
          {report.commands} chart commands. {report.channels.map(([ch, count]) => `Ch ${ch}: ${count}`).join(" · ") || "No channel commands."}
        </p>
        <HelpNote>
          <p>
            Warnings are advisory; intentional sequences are preserved. Up to 100 warnings are shown. Profile channels are app settings, not a readback of
            physical pedals. Raw cues cannot identify a pedal or verify its CC assignments. Check the physical routing and receive channels before the set.
          </p>
        </HelpNote>
        {parseError ? (
          <p className="text-red-400">{parseError}</p>
        ) : report.issues.length ? (
          <ul className="max-h-60 list-disc overflow-auto pl-5">
            {report.issues.map((issue, i) => (
              <li key={i}>{issue.text}</li>
            ))}
          </ul>
        ) : (
          <p>No static cue issues found. This does not verify pedal response or physical MIDI routing.</p>
        )}
        <p aria-label="MIDI timing totals">
          Queued: {timing.queued} · More than 5 ms late: {timing.late} · Worst dispatch lateness: {timing.maxLateMs.toFixed(1)} ms · Failures: {timing.failures}
        </p>
        <HelpNote>
          <p>
            Times measure app dispatch to the selected MIDI API, not pedal delivery. Worker scheduling still crosses a window bridge for Web MIDI/Bluetooth.
            Rendering or driver stalls can delay it; interrupted batches are discarded. Counters span songs in this app session.
          </p>
        </HelpNote>
        {timing.lastFailure && <p>Last failure: {timing.lastFailure}</p>}
        {outputName && /bluetooth/i.test(outputName) && ble?.performanceTiming && (
          <p>
            Bluetooth writes: {ble.performanceTiming.commands} · Worst queue lateness: {ble.performanceTiming.maxLateMs.toFixed(1)} ms · Longest packet write:{" "}
            {ble.performanceTiming.maxWriteMs.toFixed(1)} ms
          </p>
        )}
        <button
          className="rounded border border-seam px-3 py-1"
          onClick={() => {
            useMidiDiagnostics.getState().reset();
            resetBluetoothTiming();
            setBle(useBluetooth.getState().diagnostics);
            setTiming(useMidiDiagnostics.getState());
          }}
        >
          Reset timing counters
        </button>
        <div className="max-h-40 overflow-auto">
          <table className="w-full text-left" aria-label="Recent MIDI dispatch">
            <thead>
              <tr>
                <th>Action</th>
                <th>Due (app s)</th>
                <th>Queued (app s)</th>
                <th>Late (ms)</th>
                <th>MIDI bytes</th>
              </tr>
            </thead>
            <tbody>
              {timing.recent.map((event, i) => (
                <tr key={i}>
                  <td>{event.label}</td>
                  <td>{((event.intended - performance.timeOrigin) / 1000).toFixed(3)}</td>
                  <td>{((event.queued - performance.timeOrigin) / 1000).toFixed(3)}</td>
                  <td>{event.lateMs.toFixed(1)}</td>
                  <td>
                    {event.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}
                    {(event.byteCount ?? 0) > event.bytes.length ? ` ... (${event.byteCount} bytes)` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
