import { useSession, type PerformanceSession } from "@/song/performance/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { preparationSettings, usePreparationDefaults } from "@/song/performance/start-preparation";
import { readOptions, setSetting } from "@/song/performance/settings";
import { useSongSettingsRevision } from "@/song/performance/use-song-settings";

/** Song overrides keep the wait and automatic opening presets separate from the musical timeline. */
export function SongPreparationSettings({ songKey, locked, session }: { songKey: string; locked: boolean; session: PerformanceSession }) {
  const used = useSession(session, (state) => state.preparationOnceUsed);
  useSongSettingsRevision(songKey);
  const defaults = usePreparationDefaults((state) => state.settings);
  const options = readOptions<Record<string, unknown>>(songKey, {});
  const settings = preparationSettings(options.preparation, defaults);
  const save = (patch: Partial<typeof settings>) =>
    setSetting(songKey, ":options", JSON.stringify({ ...readOptions(songKey, {}), preparation: { ...settings, ...patch } }));
  return (
    <section aria-label="Before song preparation" className="space-y-2 rounded border border-seam p-3 text-sm">
      <h3 className="font-medium">Before song</h3>
      <p>
        Prepare pedals → presets and your commands → loading wait → song BPM → Ready. Play then starts the count-in and song. Play on its own prepares
        automatically.
      </p>
      <fieldset disabled={locked} className="flex flex-wrap items-center gap-3">
        <label>
          <input type="checkbox" checked={settings.enabled} onChange={(event) => save({ enabled: event.target.checked })} /> Prepare pedals before playback
        </label>
        <label>
          Preset loading wait (seconds)
          <Input
            aria-label="Pedal preparation wait"
            className="w-24"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={settings.settleMs / 1000}
            onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber)) save({ settleMs: event.target.valueAsNumber * 1000 });
            }}
          />
        </label>
        <label>
          Gap between setup commands (seconds)
          <Input
            aria-label="Preparation command gap"
            className="w-24"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={(settings.commandGapMs ?? 0) / 1000}
            onChange={(event) => {
              if (Number.isFinite(event.target.valueAsNumber)) save({ commandGapMs: event.target.valueAsNumber * 1000 });
            }}
          />
        </label>
        <label>
          <input type="checkbox" checked={settings.openingPresets} onChange={(event) => save({ openingPresets: event.target.checked })} /> Prepare opening
          preset changes automatically
        </label>
        <Button size="sm" variant="outline" onClick={() => usePreparationDefaults.getState().set(settings)}>
          Use these as defaults
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSetting(songKey, ":options", JSON.stringify({ ...readOptions(songKey, {}), preparation: undefined }))}
        >
          Use default settings
        </Button>
      </fieldset>
      <p>
        In Song MIDI cues choose When → Before song. Add named pedal commands, raw MIDI or macros; use ↑/↓ to order command lines. Opening Program Change and
        bank-select messages can run early automatically; drum/looper starts and notes keep their song times.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {used} once command line{used === 1 ? "" : "s"} used for this song load.
        </span>
        <Button size="sm" variant="outline" disabled={locked || used === 0} onClick={session.resetPreparationCommands}>
          Reset once commands
        </Button>
      </div>
      <p>
        Prepare again respects each command’s Repeat rule. Once commands stay used after sending begins, including cancellation or a lost connection. Reset once
        commands allows them on the next preparation; it sends nothing by itself.
      </p>
      <p>
        Wait after on a command line applies once after its entire bank/preset pair or macro. These waits add to the gap between commands and the final loading
        wait. Use zero for the global gap or loading wait when you want only individual command waits.
      </p>
      <p>
        Automatic GP tempo follows your preparation commands. If your commands set a different tempo, turn off automatic song BPM. Cancel start clears queued
        commands and prevents the song from starting; commands already received by a pedal cannot be undone.
      </p>
    </section>
  );
}
