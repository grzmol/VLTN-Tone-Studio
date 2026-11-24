import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectArmed, selectOutput, useSession, type PerformanceSession, type MidiOutput } from "@/song/performance/session";
import { rhythmControlOverrides } from "@/song/performance/rhythm-automation";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { TRIGGER_HOLD_MS } from "@/song/performance/trigger-pulse";
import { rhythmMemory } from "@/song/performance/rhythm-runtime";

/** Explicit hardware checks use the live output and never edit a song or its saved MIDI chart. */
export function RhythmHardwareTest({ session }: { session: PerformanceSession }) {
  const armed = useSession(session, selectArmed);
  const output = useSession(session, selectOutput);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const cues = useSession(session, (s) => s.cues);
  const library = usePedalLibrary();
  const controls = { channel: 2, start: 80, division: 81, fill: 82, stop: 83, ...rhythmControlOverrides(library) };
  const [memory, setMemory] = useState((rhythmMemory(cues)[0]?.[1] ?? 0) + 1);
  const [notice, setNotice] = useState("");
  const test = useRef<{ output: MidiOutput; tempo: number; channel: number; rhythmChannel: number; stop: number } | null>(null);
  const canTest = armed && output?.state === "connected" && !playing && !starting;
  const begin = () => {
    if (!canTest || !output) return false;
    const state = session.state;
    if (!test.current)
      test.current = {
        output,
        tempo: Math.round((state.rhythmTempo ?? state.bpm) * (state.player?.playbackRate ?? 1)),
        channel: state.tempoChannel,
        rhythmChannel: controls.channel,
        stop: controls.stop,
      };
    return true;
  };
  const pulse = (key: "start" | "division" | "fill" | "stop") => {
    if (!begin()) return;
    session.sendPerformance([0xb0 + controls.channel - 1, controls[key], 127], undefined, "RC-10R hardware test");
    session.sendPerformance([0xb0 + controls.channel - 1, controls[key], 0], performance.now() + TRIGGER_HOLD_MS, "RC-10R hardware test");
    setNotice(`${key === "division" ? "Pattern change" : key} command queued. Check the pedal's response.`);
  };
  const tempo = (bpm: number) => {
    if (!begin()) return;
    const state = session.state;
    session.sendPerformance([0xb0 + state.tempoChannel - 1, 73, bpm >> 7], undefined, "Hardware test tempo");
    session.sendPerformance([0xb0 + state.tempoChannel - 1, 74, bpm & 127], undefined, "Hardware test tempo");
    setNotice(`${bpm} BPM command queued to GP-150 / GP-180. Listen for the drum tempo changing.`);
  };
  const restore = () => {
    const saved = test.current;
    test.current = null;
    if (!saved || session.output !== saved.output || saved.output.state !== "connected") return;
    session.sendPerformance([0xb0 + saved.rhythmChannel - 1, saved.stop, 127], undefined, "Hardware test stop");
    session.sendPerformance([0xb0 + saved.rhythmChannel - 1, saved.stop, 0], performance.now() + TRIGGER_HOLD_MS, "Hardware test stop");
    if (saved.tempo >= 40 && saved.tempo <= 300) {
      session.sendPerformance([0xb0 + saved.channel - 1, 73, saved.tempo >> 7], undefined, "Hardware test restore tempo");
      session.sendPerformance([0xb0 + saved.channel - 1, 74, saved.tempo & 127], undefined, "Hardware test restore tempo");
    }
    setNotice(`Ending/Stop queued and song tempo ${saved.tempo} BPM restored. Check the pedal.`);
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    const unregister = session.registerRhythmTestCleanup(() => restoreRef.current());
    return () => {
      unregister();
      restoreRef.current();
    };
  }, [session]);
  return (
    <details className="rounded border border-seam p-3 text-sm">
      <summary className="cursor-pointer">Test RC-10R connection</summary>
      <p className="py-2">
        Stop song playback, connect and arm the output, and match the pedal’s channel and controls. These commands affect the real pedal. A queued command does
        not prove the pedal received it.
      </p>
      <fieldset disabled={!canTest} className="flex flex-wrap items-center gap-2">
        <label>
          Test phrase memory
          <Input
            aria-label="Test phrase memory"
            className="w-24"
            type="number"
            min={1}
            max={99}
            value={Number.isFinite(memory) ? memory : ""}
            onChange={(e) => setMemory(e.target.valueAsNumber)}
          />
        </label>
        <Button
          variant="outline"
          disabled={!Number.isInteger(memory) || memory < 1 || memory > 99}
          onClick={() => {
            if (!begin()) return;
            session.sendPerformance([0xb0 + controls.channel - 1, memory - 1], undefined, "Hardware test memory");
            setNotice(`Memory ${memory} recall queued. Check the pedal.`);
          }}
        >
          Recall memory
        </Button>
        <Button variant="outline" onClick={() => pulse("start")}>
          Start drums
        </Button>
        <Button variant="outline" onClick={() => pulse("fill")}>
          Fill
        </Button>
        <Button variant="outline" onClick={() => pulse("division")}>
          Change pattern
        </Button>
        <Button variant="outline" onClick={() => pulse("stop")}>
          Ending / Stop
        </Button>
        <Button variant="outline" onClick={() => tempo(100)}>
          Slow: 100 BPM
        </Button>
        <Button variant="outline" onClick={() => tempo(180)}>
          Fast: 180 BPM
        </Button>
        <Button variant="outline" onClick={restore}>
          Restore song tempo and stop
        </Button>
      </fieldset>
      <p role="status">{notice}</p>
    </details>
  );
}
