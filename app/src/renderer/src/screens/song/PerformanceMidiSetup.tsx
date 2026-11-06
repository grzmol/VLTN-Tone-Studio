import { SettingsCard } from "@/components/ui/settings-card";
import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { BluetoothControls } from "@/bluetooth/BluetoothControls";
import { useMidiConfiguration, MIDI_SETUP_PRESETS, rememberedPort } from "@/song/performance/midi-configuration";
import { BLUETOOTH_PORT_ID, selectArmed, selectOutput, useSession, type PerformanceSession } from "@/song/performance/session";
import { removeCueToken, replaceCueToken } from "@/song/performance/chart";
import { MidiCueBuilder } from "./MidiCueBuilder";
import { MidiFileField } from "./MidiFileField";
import type { MidiFileOption } from "@/song/performance/smf";
import { MidiHealth } from "./MidiHealth";
import { TimecodeSettings } from "./TimecodeSettings";
import { HelpNote } from "@/components/ui/help-note";

const field = "rounded border border-seam bg-transparent p-2";

/** MIDI preflight and timing for the current song and output. */
export function SessionMidiHealth({ session }: { session: PerformanceSession }) {
  const cues = useSession(session, (s) => s.cues);
  const parseError = useSession(session, (s) => s.parseError);
  const player = useSession(session, (s) => s.player);
  const clock = useSession(session, (s) => s.clock);
  const tempoOnStart = useSession(session, (s) => s.tempoOnStart);
  const portId = useSession(session, (s) => s.portId);
  const output = useSession(session, selectOutput);
  const midiConfig = useMidiConfiguration();
  const timecodeOn = useSession(session, (s) => s.timecode.enabled);
  const timecodeFps = useSession(session, (s) => s.timecode.fps);
  const timecodeOffset = useSession(session, (s) => s.timecode.offset);
  // Only the settings that change what is sent are passed on; the object is memoised so the health check is not re-run every render.
  const timecode = useMemo(
    () => (timecodeOn ? { fps: timecodeFps, offset: timecodeOffset, bluetooth: portId === BLUETOOTH_PORT_ID } : undefined),
    [timecodeOn, timecodeFps, timecodeOffset, portId],
  );
  // A trimmed song's cues are checked against the part that plays: cues outside it never fire.
  const range = useMemo(
    () => (player && (player.start > 0 || player.duration < player.length) ? { start: player.start, end: player.duration } : undefined),
    [player?.start, player?.duration, player?.length],
  );
  return (
    <MidiHealth
      cues={cues}
      duration={player?.duration ?? 0}
      range={range}
      clock={clock}
      tempoChannel={tempoOnStart ? midiConfig.tempoChannel : undefined}
      timecode={timecode}
      outputName={portId === BLUETOOTH_PORT_ID ? `Bluetooth ${output?.name || ""}` : output?.name || undefined}
      parseError={parseError}
    />
  );
}

/** Output and input selection, arming, setup presets and the command library. */
export function PerformanceMidiSetup({
  session,
  chart,
  onSaveChart,
  onShowChart,
  midiFile,
  onMidiFile,
  timecodeOffset,
  onTimecodeOffset,
}: {
  session: PerformanceSession;
  chart: string;
  onSaveChart: (chart: string) => void;
  /** Goes to the Lyrics & chords view. */
  onShowChart?: () => void;
  midiFile: MidiFileOption | null;
  onMidiFile: (file: MidiFileOption | null) => void;
  timecodeOffset: string;
  onTimecodeOffset: (value: string) => void;
}) {
  const midiConfig = useMidiConfiguration();
  const bluetooth = useSession(session, (s) => s.bluetooth);
  const access = useSession(session, (s) => s.access);
  const portId = useSession(session, (s) => s.portId);
  const inputId = useSession(session, (s) => s.inputId);
  const midiStatus = useSession(session, (s) => s.midiStatus);
  const cues = useSession(session, (s) => s.cues);
  const parseError = useSession(session, (s) => s.parseError);
  const output = useSession(session, selectOutput);
  const armed = useSession(session, selectArmed);
  const remembered = useSession(session, (s) => s.armedByPreference);
  const playing = useSession(session, (s) => s.playing);
  const latestChart = useRef(chart);
  latestChart.current = chart;
  useSession(session, (s) => s.portsVersion);
  const outputs = [...(access?.outputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter((p) => p.state === "connected");
  const inputs = [...(access?.inputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter((p) => p.state === "connected");
  return (
    <SettingsCard
      title="Performance MIDI controller"
      summary={`${output?.state === "connected" ? output.name : "Output disconnected"} · ${armed ? (remembered ? "Cues armed (remembered)" : "Cues armed") : "Cues disarmed"}`}
      storageKey="midi-controller"
    >
      <HelpNote>
        <p>Computer → Bluetooth or USB MIDI → GP-150 / GP-180 → physical MIDI OUT/THRU → MIDI pedals. Choose one performance output below.</p>
      </HelpNote>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <div className="w-full space-y-2 rounded border border-seam p-3" aria-label="MIDI setup presets">
          <div className="flex flex-wrap items-center gap-3">
            <label>
              Setup preset{" "}
              <select
                aria-label="MIDI setup preset"
                className={field}
                value={midiConfig.preset}
                onChange={(e) => midiConfig.update({ preset: e.target.value })}
              >
                {MIDI_SETUP_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              onClick={() => {
                const preset = MIDI_SETUP_PRESETS.find((p) => p.id === midiConfig.preset);
                if (!preset) return;
                session.pause();
                session.setArmed(false);
                session.setClock(preset.clock);
                midiConfig.update({ tempoOnStart: preset.tempo });
                if (preset.transport === "bluetooth") {
                  session.setPortId(bluetooth?.id ?? "");
                  midiConfig.update({ output: { id: "bluetooth-midi", name: bluetooth?.name || "GP-150 / GP-180 BLE", transport: "bluetooth" } });
                } else {
                  const ports = [...(access?.outputs.values() ?? [])].filter((p) => p.state === "connected");
                  const saved = midiConfig.output?.transport === "system" ? rememberedPort(ports, midiConfig.output) : undefined;
                  const chosen = saved ?? (ports.length === 1 ? ports[0] : undefined);
                  session.setPortId(chosen?.id ?? "");
                  if (chosen) midiConfig.update({ output: { id: chosen.id, name: chosen.name || "", transport: "system" } });
                  else if (midiConfig.output?.transport === "bluetooth") midiConfig.update({ output: null });
                }
                session.setMidiStatus("Setup applied. Connect the matching output, check pedal settings, then enable Send cues.");
              }}
            >
              Apply MIDI setup
            </Button>
          </div>
          <p className="text-sm text-silkscreen-3">{MIDI_SETUP_PRESETS.find((p) => p.id === midiConfig.preset)?.description}</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>
              <input
                type="checkbox"
                checked={midiConfig.tempoOnStart}
                onChange={(e) => {
                  session.pause();
                  if (e.target.checked) session.setClock(false);
                  midiConfig.update({ tempoOnStart: e.target.checked });
                }}
              />{" "}
              Send song BPM to GP-150 / GP-180 on playback start
            </label>
            <label>
              GP-150 / GP-180 tempo channel{" "}
              <select
                aria-label="GP-150 / GP-180 tempo channel"
                className={field}
                value={midiConfig.tempoChannel}
                onChange={(e) => {
                  session.pause();
                  midiConfig.update({ tempoChannel: Number(e.target.value) });
                }}
              >
                {Array.from({ length: 16 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <HelpNote>
            <p>
              Remembered on this computer: ports, setup, pedal channels, command choices and display preference. Send cues is remembered for the output it was
              turned on for. Send cues stays on for every song until you turn it off or press Disarm. Bluetooth still needs a manual connection. One-time GP-150
              / GP-180 tempo uses the song BPM rounded to a whole number (40–300); use app clock off. Check saved chart cues for conflicting tempo commands.
            </p>
          </HelpNote>
          {midiConfig.output && (
            <p className="text-xs text-silkscreen-3">
              Remembered output: {midiConfig.output.name}.{" "}
              {midiConfig.output.transport === "system" ? "Enable USB / system MIDI to restore it when available." : "Connect Bluetooth MIDI to use it."}
            </p>
          )}
        </div>
        <BluetoothControls
          onConnected={(connection) => {
            session.panic();
            session.setArmed(false);
            session.setPortId(connection.id);
            midiConfig.update({ output: { id: connection.id, name: connection.name, transport: "bluetooth" } });
            session.setMidiStatus("Bluetooth output selected. Enable Send cues to send this song’s commands.");
          }}
        />
        <Button variant="outline" onClick={() => void session.connectMidi()}>
          Enable USB / system MIDI
        </Button>
        <select
          aria-label="MIDI output"
          className={field}
          value={portId}
          onChange={(e) => {
            session.panic();
            session.setArmed(false);
            session.setPortId(e.target.value);
            const port = outputs.find((p) => p.id === e.target.value);
            midiConfig.update({
              output: port ? { id: port.id, name: port.name || "", transport: port.id === "bluetooth-midi" ? "bluetooth" : "system" } : null,
            });
          }}
        >
          <option value="">Select output…</option>
          {outputs.map((p) => (
            <option value={p.id} key={p.id}>
              {p.id === "bluetooth-midi" ? `Bluetooth · ${p.name}` : p.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            disabled={output?.state !== "connected" || !!parseError}
            checked={armed}
            onChange={(e) => {
              session.panic();
              session.sendCues(e.target.checked);
              session.setMidiStatus("");
            }}
          />{" "}
          Send cues
        </label>
        <select
          aria-label="MIDI input"
          className={field}
          value={inputId}
          onChange={(e) => {
            session.setInputId(e.target.value);
            const port = inputs.find((p) => p.id === e.target.value);
            midiConfig.update({
              input: port ? { id: port.id, name: port.name || "", transport: port.id === "bluetooth-midi" ? "bluetooth" : "system" } : null,
            });
          }}
        >
          <option value="">No remote input</option>
          {inputs.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          onClick={() => {
            session.panic();
            session.disarm();
          }}
        >
          Panic / disarm
        </Button>
      </div>
      <HelpNote>
        <p>
          Input: Start/Continue/Stop or CC 80 ≥ 64 toggles playback. Configure a GP-150 / GP-180 MIDI footswitch to send CC 80. Output is opt-in for each song
          or playlist session. PC values are 0–127; channels are 1–16. Bluetooth uses its own connection and does not need Enable USB / system MIDI.
        </p>
      </HelpNote>
      <p role="status" className="text-sm">
        {output?.state === "connected"
          ? `${portId === "bluetooth-midi" ? "Bluetooth" : "System MIDI"} output: ${output.name} · ${armed ? "Song cues enabled" : "Song cues off"}`
          : "Connect Bluetooth MIDI or enable USB / system MIDI, then select an output."}
      </p>
      <HelpNote>
        <p>
          For GP-150 / GP-180 tempo control, use the named Set tempo (BPM) command at song start with app MIDI Clock off, GP-150 / GP-180 clock source Internal
          and TRS clock output On. Continuous app clock fluctuated in real GP-180 USB and Bluetooth tests with a TimeLine and caused audible delay changes.
        </p>
      </HelpNote>
      <TimecodeSettings session={session} offset={timecodeOffset} onOffset={onTimecodeOffset} bluetooth={portId === BLUETOOTH_PORT_ID} />
      <MidiFileField file={midiFile} onChange={onMidiFile} />
      {midiConfig.showCommands && (
        <MidiCueBuilder
          cues={cues}
          canTest={output?.state === "connected" && armed}
          onAdd={(line) => onSaveChart([chart.trimEnd(), line].filter(Boolean).join("\n"))}
          locked={armed && playing}
          onShowChart={onShowChart}
          onRemove={(cue) => {
            const next = removeCueToken(chart, cue);
            if (next === null) return null;
            onSaveChart(next);
            // Undo puts the old text back only while the chart is still the one the removal made.
            return () => {
              if (latestChart.current !== next) return false;
              onSaveChart(chart);
              return true;
            };
          }}
          onReplace={(cue, token, time) => {
            const next = replaceCueToken(chart, cue, token, time);
            if (next === null) return false;
            onSaveChart(next);
            return true;
          }}
          onTest={(bytes) => {
            if (!armed || output?.state !== "connected") return;
            session.sendPerformance(bytes);
            session.setMidiStatus(`MIDI command queued for ${output.name}. Check whether the downstream pedal responds.`);
          }}
        />
      )}
      {midiStatus && (
        <p role="status" className="text-sm">
          {midiStatus}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm">GP-150 / GP-180 routing setup</summary>
        <p className="py-2 text-sm text-silkscreen-3">
          On the GP-150 / GP-180, enable Bluetooth and configure MIDI IN Source as BT Only or Mixed. Configure the pedal’s MIDI-capable EXP/FS jack for MIDI OUT
          and connect the correct TRS MIDI cable to the downstream pedal. Match MIDI channels on the pedals. Forwarding Bluetooth input to physical MIDI OUT
          depends on the GP-150 / GP-180’s routing and firmware; use the test command to verify it. A Bluetooth connection alone does not confirm delivery at
          MIDI OUT.
        </p>
        <p className="pb-2 text-sm text-silkscreen-3">
          For MIDI Clock, check Clock Source and Clock Output separately. The GP-180 manual for this shared MIDI implementation says enabling Clock Output makes
          the pedal ignore incoming clock. Receiving the app’s clock and forwarding it to another pedal must each be verified; successful patch changes do not
          confirm clock routing.
        </p>
      </details>
    </SettingsCard>
  );
}
