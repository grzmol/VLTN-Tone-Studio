import { SettingsCard } from "@/components/ui/settings-card";
import { Checkbox } from "@/components/ui/checkbox";
import type { LibrarySong } from "@shared/song-library";
import { describeBinding } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import {
  WHILE_PLAYING_OPTIONS,
  bindingClaiming,
  songEntries,
  triggerClashes,
  type SongScope,
  type SongTriggerSettings as Options,
  type WhilePlaying,
} from "@/song/performance/song-triggers";

const field = "rounded border border-seam bg-transparent p-2 text-[13px]";

/**
 * Whether songs load from MIDI, and how. Each song's own trigger is set in its song options. Below the options, every song whose trigger
 * another song shares, or a remote binding answers, is named, so the library can be fixed before a set.
 */
export function SongTriggerSettings({ songs: library, inputReady }: { songs: readonly LibrarySong[]; inputReady: boolean }) {
  const options = useMidiConfiguration((s) => s.songTriggers);
  const bindings = useMidiConfiguration((s) => s.bindings);
  const songs = songEntries(library);
  const save = (patch: Partial<Options>) => useMidiConfiguration.getState().update({ songTriggers: { ...options, ...patch } });
  const withTrigger = songs.flatMap((song) => (song.trigger ? [{ title: song.title, trigger: song.trigger }] : []));
  // A clash is named once, on the later song of the pair, so the list does not say the same thing twice.
  const clashLines = songs.flatMap((song) => {
    const earlier = triggerClashes(songs, song.id).filter((other) => songs.indexOf(other) < songs.indexOf(song));
    return earlier.length ? [`${song.title}: same trigger as ${earlier.map((other) => other.title).join(", ")}. The first song in the library loads.`] : [];
  });
  const boundLines = withTrigger.flatMap((song) => {
    const binding = bindingClaiming(song.trigger, bindings);
    return binding ? [`${song.title}: ${describeBinding(binding)} runs a remote action on its message, so the song does not load.`] : [];
  });
  const hint = WHILE_PLAYING_OPTIONS.find((option) => option.id === options.whilePlaying)?.hint;
  return (
    <SettingsCard
      title="Load songs from MIDI"
      summary={`${withTrigger.length} song${withTrigger.length === 1 ? "" : "s"} with a trigger`}
      storageKey="song-triggers"
      defaultOpen={false}
    >
      <p className="text-[12px] text-silkscreen-3">
        {withTrigger.length} song{withTrigger.length === 1 ? "" : "s"} with a trigger. Triggers listen on the selected MIDI input, and our own output is
        ignored.
      </p>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox aria-label="Load songs from MIDI" checked={options.listen} onCheckedChange={(checked) => save({ listen: checked === true })} />
        Load songs from MIDI on the selected input
      </label>
      {!inputReady && <p className="text-[12px] text-silkscreen-3">Choose a MIDI input in MIDI setup. Triggers do nothing without one.</p>}
      <div className="flex flex-wrap items-start gap-4">
        <label className="flex flex-col gap-1 text-[13px]">
          Songs that can load
          <select aria-label="Song trigger scope" className={field} value={options.scope} onChange={(e) => save({ scope: e.target.value as SongScope })}>
            <option value="library">Whole library</option>
            <option value="playlist">Current playlist only</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          While a song plays
          <select
            aria-label="While a song plays"
            className={field}
            value={options.whilePlaying}
            onChange={(e) => save({ whilePlaying: e.target.value as WhilePlaying })}
          >
            {WHILE_PLAYING_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          {hint && <span className="max-w-72 text-[12px] text-silkscreen-3">{hint}</span>}
        </label>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <Checkbox aria-label="Start a song loaded from MIDI" checked={options.autoplay} onCheckedChange={(checked) => save({ autoplay: checked === true })} />
        Start a song as soon as a trigger loads it
      </label>
      {(clashLines.length > 0 || boundLines.length > 0) && (
        <ul aria-label="Trigger conflicts" className="flex flex-col gap-1 text-[12px] text-silkscreen-2">
          {[...clashLines, ...boundLines].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}
