import { SettingsCard } from "@/components/ui/settings-card";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { lrcTime, midiCommand, type Cue } from "@/song/performance/chart";
import { clockPosition } from "@/song/performance/playback-clock";
import { saveMacro, useMidiConfiguration } from "@/song/performance/midi-configuration";
import { macroCodeFor } from "@/song/performance/midi-macros";
import { MacroPanel } from "./MacroPanel";
import { PedalMidiPicker } from "./PedalMidiPicker";
import { HelpNote } from "@/components/ui/help-note";

export function MidiCueBuilder({
  cues,
  onAdd,
  onTest,
  canTest,
}: {
  cues: Cue[];
  onAdd: (line: string) => void;
  onTest: (bytes: number[]) => void;
  canTest: boolean;
}) {
  const [seconds, setSeconds] = useState(0),
    [channel, setChannel] = useState(1);
  const [type, setType] = useState("pc"),
    [number, setNumber] = useState(0),
    [value, setValue] = useState(127),
    [error, setError] = useState("");
  const macros = useMidiConfiguration((s) => s.macros);
  const field = "ml-2 rounded border border-seam bg-background p-2";
  const command = () => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Cue time must be zero or more seconds.");
    const text = `${type} ${channel} ${number}${type === "cc" ? ` ${value}` : ""}`;
    return { text, bytes: midiCommand(text) };
  };
  const run = (test: boolean) => {
    try {
      const cue = command();
      setError("");
      if (test) onTest(cue.bytes);
      else onAdd(`${lrcTime(seconds)} {midi:${cue.text}}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // The song's file messages are many and are shown in the MIDI file field, not in this table.
  const scheduled = cues.filter((cue) => cue.messages.length && !cue.fromFile);
  const saveRaw = () => {
    try {
      const cue = command();
      saveMacro({ code: macroCodeFor(cue.text, macros), label: cue.text.slice(0, 60), commands: [cue.text] });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const describe = (bytes: number[]) =>
    (bytes[0] & 0xf0) === 0xc0
      ? `PC ${bytes[1]}`
      : (bytes[0] & 0xf0) === 0xb0
        ? `CC ${bytes[1]} = ${bytes[2]}`
        : bytes.map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  return (
    <SettingsCard title="Song MIDI cues" summary={`${cues.length} cue${cues.length === 1 ? "" : "s"}`} storageKey="midi-cues">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          At seconds
          <input
            aria-label="Cue time in seconds"
            className={field + " w-24"}
            type="number"
            min="0"
            step="0.01"
            value={seconds}
            onChange={(e) => setSeconds(e.target.valueAsNumber)}
          />
        </label>
        <Button variant="outline" onClick={() => setSeconds(Math.round(clockPosition() * 100) / 100)}>
          Use playback time
        </Button>
      </div>
      <PedalMidiPicker time={seconds} onAdd={onAdd} onTest={onTest} canTest={canTest} />
      <details>
        <summary className="cursor-pointer text-sm">Raw MIDI command</summary>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label>
            Channel
            <input
              aria-label="Cue MIDI channel"
              className={field + " w-20"}
              type="number"
              min="1"
              max="16"
              value={channel}
              onChange={(e) => setChannel(e.target.valueAsNumber)}
            />
          </label>
          <label>
            Command
            <select aria-label="Cue command" className={field} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="pc">Program Change</option>
              <option value="cc">Control Change</option>
            </select>
          </label>
          <label>
            {type === "pc" ? "Program (0–127)" : "Controller (0–127)"}
            <input
              aria-label="Cue command number"
              className={field + " w-20"}
              type="number"
              min="0"
              max="127"
              value={number}
              onChange={(e) => setNumber(e.target.valueAsNumber)}
            />
          </label>
          {type === "cc" && (
            <label>
              Value
              <input
                aria-label="Cue CC value"
                className={field + " w-20"}
                type="number"
                min="0"
                max="127"
                value={value}
                onChange={(e) => setValue(e.target.valueAsNumber)}
              />
            </label>
          )}
          <Button onClick={() => run(false)}>Add MIDI cue</Button>
          <Button variant="outline" disabled={!canTest} onClick={() => run(true)}>
            Send MIDI now
          </Button>
          <Button variant="outline" onClick={saveRaw}>
            Save as macro
          </Button>
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm">MIDI macros</summary>
        <div className="py-2">
          <MacroPanel time={seconds} onAdd={onAdd} onTest={onTest} canTest={canTest} />
        </div>
      </details>
      <HelpNote>
        <p>
          Set the channel to the target pedal. Added cues are saved in this song’s chart and sent during playback when Send cues is enabled. Program numbers are
          wire values: a pedal labelled 1–128 may display one higher. Send MIDI now transmits immediately to the selected output.
        </p>
      </HelpNote>
      {scheduled.length ? (
        <div className="max-h-48 overflow-auto">
          <table aria-label="Scheduled MIDI cues" className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Time</th>
                <th className="p-2">Pedal / action</th>
                <th className="p-2">Channel</th>
                <th className="p-2">MIDI</th>
              </tr>
            </thead>
            <tbody>
              {scheduled.map((cue, i) => (
                <tr key={i} className="border-t border-seam">
                  <td className="p-2 font-mono">{cue.trigger ? `On ${cue.trigger}` : lrcTime(cue.time)}</td>
                  <td className="p-2">{cue.label || "Raw MIDI command"}</td>
                  <td className="p-2">{[...new Set(cue.messages.map((bytes) => (bytes[0] < 0xf0 ? (bytes[0] & 15) + 1 : "System")))].join(", ")}</td>
                  <td className="p-2 font-mono">{cue.messages.map(describe).join(" → ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-silkscreen-3">Edit or remove cues in the chart editor below. Multi-message actions are sent in the order shown.</p>
        </div>
      ) : (
        <p className="text-sm text-silkscreen-3">No MIDI cues in this song yet.</p>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
