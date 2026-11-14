import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsCard } from "@/components/ui/settings-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RHYTHM_CONTROLS, type RhythmAutomationSong } from "@/song/performance/rhythm-automation";
import { RhythmAutomationSong as SongChoices } from "./RhythmAutomationSong";
import { useRhythmAutomation } from "./use-rhythm-automation";

/** Review automatic rhythm changes for one song or a playlist, using fixed pedal memories. */
export function RhythmAutomationSetup({ current, locked, onSaveChart }: { current: RhythmAutomationSong; locked: boolean; onSaveChart(chart: string): void }) {
  const {
    playlists,
    scope,
    setScope,
    firstMemory,
    setFirstMemory,
    controls,
    setControls,
    entries,
    drafts,
    setDrafts,
    message,
    setMessage,
    error,
    setError,
    saved,
    retry,
    blocked,
    conflicts,
    preview,
    apply,
    undo,
    finishSave,
    enabled,
    disable,
  } = useRhythmAutomation(current, locked, onSaveChart);
  return (
    <SettingsCard title="Automatic RC-10R drums" summary="Build pedal cues from song sections" storageKey="rhythm-automation" defaultOpen={false}>
      <div className="space-y-3 text-sm">
        <p>
          Select the song's pedal memory, start its rhythm, change patterns with fills and play the ending. Preview this song or assign a whole playlist to
          consecutive memories.
        </p>
        <fieldset disabled={blocked} className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              Set up
              <Select
                value={scope}
                onValueChange={(value) => {
                  setScope(value);
                  setDrafts([]);
                  setError("");
                }}
              >
                <SelectTrigger aria-label="Rhythm automation scope" className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="song">This song</SelectItem>
                  {playlists.map((playlist) => (
                    <SelectItem key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {scope !== "song" && (
              <label className="flex flex-col gap-1">
                First pedal memory
                <Input
                  aria-label="First pedal memory"
                  className="w-24"
                  type="number"
                  min={1}
                  max={99}
                  value={Number.isFinite(firstMemory) ? firstMemory : ""}
                  onChange={(event) => {
                    setFirstMemory(event.target.valueAsNumber);
                    setDrafts([]);
                  }}
                />
              </label>
            )}
          </div>
          <details>
            <summary className="cursor-pointer">Pedal setup and timing · channel {controls.channel}</summary>
            <div className="flex flex-wrap items-end gap-3 py-3">
              <label className="flex flex-col gap-1">
                MIDI channel
                <Input
                  aria-label="Rhythm MIDI channel"
                  className="w-24"
                  type="number"
                  min={1}
                  max={16}
                  value={Number.isFinite(controls.channel) ? controls.channel : ""}
                  onChange={(event) => setControls({ ...controls, channel: event.target.valueAsNumber })}
                />
              </label>
              {RHYTHM_CONTROLS.map(({ key, setting }) => (
                <label className="flex flex-col gap-1" key={key}>
                  {setting}
                  <Input
                    aria-label={setting}
                    className="w-24"
                    type="number"
                    min={1}
                    max={95}
                    value={Number.isFinite(controls[key]) ? controls[key] : ""}
                    onChange={(event) => setControls({ ...controls, [key]: event.target.valueAsNumber })}
                  />
                </label>
              ))}
            </div>
            <p>
              Match these channel and CC numbers in the pedal's MIDI menu. Enable PC IN/OUT, save the correct User rhythm in each phrase memory, and set STOP
              MODE to MEAS END+ENDING. Intro bars must match the exported intro; 0 means RHYTHM INTRO is OFF.
            </p>
            <p>
              Pattern changes include the pedal's fill, so they are sent one bar early by default. Adjust the lead after testing the pedal. The ending command
              is sent just before its requested bar.
            </p>
            <p>A steady pedal clock can drift against a recording with a changing tempo. Check alignment through the full song, including its last chorus.</p>
            <p>RC-10R press/release pairs have a 100 ms hold at the MIDI output so the pedal can recognize the press. The press keeps its planned time.</p>
            <p>
              Play from the beginning. After pausing, seeking, looping or jumping, restart the song to align the pedal again. Match its tempo to the song;
              playback speed can be changed while stopped; the matching pedal tempo is sent on restart when automatic GP tempo is enabled.
            </p>
            <p>
              Cue timing follows later song BPM, trim, section, export and MIDI assignment changes automatically. Match the pedal's tempo or enable its MIDI
              clock source; cue planning itself does not transmit tempo.
            </p>
          </details>
          <Button variant="outline" onClick={preview}>
            Preview automatic cues
          </Button>
          {entries.map((entry, i) => (
            <SongChoices
              key={entry.song.key}
              entry={entry}
              onChange={(draft) => {
                setDrafts(drafts.map((value, index) => (index === i ? { ...value, draft } : value)));
                setMessage("");
              }}
            />
          ))}
          {conflicts.map((conflict) => (
            <p role="alert" key={conflict}>
              {conflict}
            </p>
          ))}
          {!!entries.length && (
            <Button disabled={blocked || entries.some((entry) => !entry.plan) || conflicts.length > 0} onClick={() => void apply()}>
              Save automatic cues{entries.length > 1 ? ` for ${entries.length} songs` : ""}
            </Button>
          )}
          {!!saved.length && (
            <Button variant="outline" onClick={() => void undo()}>
              Undo cue changes
            </Button>
          )}
          {enabled && (
            <Button variant="outline" onClick={() => void disable()}>
              Turn off automatic rhythm
            </Button>
          )}
        </fieldset>
        {locked && <p role="alert">Stop song and playlist playback before changing automatic cues.</p>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        {retry && (
          <Button variant="outline" disabled={blocked} onClick={() => void finishSave("Song cue edits saved to the library.")}>
            Retry saving cue edits
          </Button>
        )}
      </div>
    </SettingsCard>
  );
}
