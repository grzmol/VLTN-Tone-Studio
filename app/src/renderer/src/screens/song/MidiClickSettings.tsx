import { useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "@/app/notify";
import { Checkbox } from "@/components/ui/checkbox";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import {
  MIDI_CLICK_OFFSET_LIMIT,
  MidiClick,
  parseMidiClickSettings,
  readMidiClickSettings,
  saveMidiClickSettings,
  type MidiClickSettings,
} from "@/song/performance/midi-click";
import { midiNow, startMidiScheduler } from "@/song/performance/midi-scheduler-client";
import type { StemPlayer } from "@/song/stems/player";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * Connects the player's clicks to the MIDI click. The settings are kept here and saved on every change; the output is looked up when a
 * note is sent, from the session's Web MIDI access, so a replugged port is followed.
 */
export function useMidiClick(session: PerformanceSession, player: StemPlayer | null) {
  const access = useSession(session, (s) => s.access);
  const [settings, setSettings] = useState(readMidiClickSettings);
  const latest = useRef({ settings, access });
  latest.current = { settings, access };
  const click = useMemo(
    () =>
      new MidiClick({
        settings: () => latest.current.settings,
        output: (id) => latest.current.access?.outputs.get(id),
        start: startMidiScheduler,
        now: midiNow,
        timeOrigin: () => performance.timeOrigin,
        onFault: (message) => showToast({ tone: "fault", title: "MIDI click", body: message }),
      }),
    [],
  );
  const active = settings.enabled && settings.portId !== "";
  useEffect(() => {
    if (!player) return;
    player.setClickListener(active ? (event) => click.onClick(event, player.audioNow) : null, settings.alsoPlay);
    player.onClicksStopped = active ? () => click.cancel() : null;
    return () => {
      player.setClickListener(null);
      player.onClicksStopped = null;
      click.cancel();
    };
  }, [player, click, active, settings.alsoPlay]);
  const update = (patch: Partial<MidiClickSettings>) => {
    const next = parseMidiClickSettings({ ...settings, ...patch });
    saveMidiClickSettings(next);
    setSettings(next);
  };
  return { settings, update, outputs: access ? [...access.outputs.values()] : null };
}

/** Send the click as MIDI: the output, channel, offset and whether the built-in sound plays too. */
export function MidiClickSettingsView({ midi }: { midi: ReturnType<typeof useMidiClick> }) {
  const { settings, update, outputs } = midi;
  return (
    <fieldset className="space-y-2">
      <legend>Send the click as MIDI</legend>
      <label className="flex items-center gap-2">
        <Checkbox checked={settings.enabled} onCheckedChange={(value) => update({ enabled: value === true })} aria-label="Send the click as MIDI" />
        Send the click as MIDI
      </label>
      <p>
        Plays each metronome and count-in beat as a drum note on a MIDI output, for a drum plugin or module. It never goes to the cue output unless you pick
        that one here.
      </p>
      <label className="block">
        Output{" "}
        <select aria-label="MIDI click output" className={field} value={settings.portId} onChange={(e) => update({ portId: e.target.value })}>
          <option value="">None</option>
          {(outputs ?? []).map((port) => (
            <option key={port.id} value={port.id}>
              {port.name || port.id}
            </option>
          ))}
        </select>
      </label>
      {outputs === null && <p className="text-xs">Turn on USB / system MIDI to see the outputs.</p>}
      <label className="block">
        Channel{" "}
        <input
          aria-label="MIDI click channel"
          className={field + " w-20"}
          type="number"
          min="1"
          max="16"
          value={settings.channel}
          onChange={(e) => update({ channel: Number(e.target.value) })}
        />
      </label>
      <label className="block">
        Offset (ms){" "}
        <input
          aria-label="MIDI click offset (ms)"
          className={field + " w-24"}
          type="number"
          min={-MIDI_CLICK_OFFSET_LIMIT}
          max={MIDI_CLICK_OFFSET_LIMIT}
          value={settings.offsetMs}
          onChange={(e) => update({ offsetMs: Number(e.target.value) })}
        />
      </label>
      <label className="flex items-center gap-2">
        <Checkbox checked={settings.alsoPlay} onCheckedChange={(value) => update({ alsoPlay: value !== false })} aria-label="Also play the click here" />
        Also play the click here
      </label>
    </fieldset>
  );
}
