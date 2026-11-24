import { useState } from "react";
import { useSongLibrary } from "@/song/library";
import { DEFAULT_PEDAL_CHANNELS, usePedalLibrary } from "@/song/performance/pedal-library";
import { flushSettings, LIBRARY_PREFIX, readSettings, savedSongSettings, seedSettings, setSetting } from "@/song/performance/settings";
import {
  buildRhythmAutomation,
  automaticRhythmSettings,
  currentRhythmAutomation,
  replaceRhythmAutomation,
  RHYTHM_CONTROLS,
  RHYTHM_PEDAL_ID,
  rhythmSongOptions,
  suggestRhythmAutomation,
  type RhythmAutomationDraft,
  type RhythmAutomationSong,
  type RhythmControls,
} from "@/song/performance/rhythm-automation";
import type { RhythmAutomationEntry } from "./RhythmAutomationSong";

interface DraftEntry {
  song: RhythmAutomationSong;
  draft: RhythmAutomationDraft;
}
interface SavedEdit {
  song: RhythmAutomationSong;
  chart: string;
  options: string;
}

/** Holds a reviewed cue draft and saves the entire selected playlist only if none of its inputs changed. */
export function useRhythmAutomation(current: RhythmAutomationSong, locked: boolean, onSaveChart: (chart: string) => void) {
  const index = useSongLibrary((state) => state.index);
  const pedal = usePedalLibrary();
  const [scope, setScope] = useState("song");
  const [firstMemory, setFirstMemory] = useState(1);
  const [controls, setControls] = useState<RhythmControls>(() => ({
    channel: pedal.channels[RHYTHM_PEDAL_ID] ?? DEFAULT_PEDAL_CHANNELS[RHYTHM_PEDAL_ID],
    start: pedal.assignments[`${RHYTHM_PEDAL_ID}:rhythm-start`] ?? 80,
    division: pedal.assignments[`${RHYTHM_PEDAL_ID}:rhythm-division`] ?? 81,
    fill: pedal.assignments[`${RHYTHM_PEDAL_ID}:fill`] ?? 82,
    stop: pedal.assignments[`${RHYTHM_PEDAL_ID}:rhythm-stop`] ?? 83,
  }));
  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedEdit[]>([]);
  const [retry, setRetry] = useState(false);
  const blocked = locked || saving;
  const playlists = (index.playlists ?? []).filter((playlist) => !playlist.smart);
  const latest = (song: RhythmAutomationSong): RhythmAutomationSong => {
    if (song.key === current.key)
      return {
        ...current,
        settings: current.key.startsWith(LIBRARY_PREFIX)
          ? savedSongSettings(current.key.slice(LIBRARY_PREFIX.length), current.settings)
          : readSettings(current.key),
      };
    const id = song.key.slice(LIBRARY_PREFIX.length);
    const fromIndex = index.songs.find((entry) => entry.id === id);
    if (!fromIndex) throw new Error(`${song.title} is no longer in the library. Preview the playlist again.`);
    return { ...song, duration: fromIndex.duration, settings: savedSongSettings(id, fromIndex.settings) };
  };
  const conflicts = RHYTHM_CONTROLS.flatMap(({ key, action }) =>
    Object.entries(pedal.assignments)
      .filter(
        ([name, cc]) =>
          name.startsWith(`${RHYTHM_PEDAL_ID}:`) && !RHYTHM_CONTROLS.some((control) => name === `${RHYTHM_PEDAL_ID}:${control.action}`) && cc === controls[key],
      )
      .map(([name]) => `CC ${controls[key]} is already assigned to ${name.slice(RHYTHM_PEDAL_ID.length + 1)}. Choose a different number for ${action}.`),
  );
  const entries: RhythmAutomationEntry[] = drafts.map(({ song, draft }) => {
    try {
      return { song, draft, plan: buildRhythmAutomation(song, draft, controls), error: "" };
    } catch (problem) {
      return { song, draft, plan: null, error: problem instanceof Error ? problem.message : String(problem) };
    }
  });
  const preview = () => {
    setError("");
    setMessage("");
    try {
      const playlist = playlists.find((entry) => entry.id === scope);
      const songs =
        scope === "song"
          ? [current]
          : (playlist?.songs ?? []).map((id): RhythmAutomationSong => {
              if (`${LIBRARY_PREFIX}${id}` === current.key) return current;
              const song = index.songs.find((entry) => entry.id === id);
              if (!song) throw new Error("A playlist song is missing from the library. Fix the playlist first.");
              return { key: `${LIBRARY_PREFIX}${id}`, title: song.title, duration: song.duration, settings: savedSongSettings(id, song.settings) };
            });
      if (!songs.length) throw new Error("Choose a playlist with songs.");
      if (new Set(songs.map((song) => song.key)).size !== songs.length)
        throw new Error("This playlist repeats a song. A song keeps one pedal memory; remove duplicate entries before assigning memories by playlist order.");
      if (scope !== "song" && (!Number.isInteger(firstMemory) || firstMemory < 1 || firstMemory + songs.length - 1 > 99))
        throw new Error("The playlist's memories must all fit within 1–99.");
      setDrafts(
        songs.map((song, i) => {
          const stored = rhythmSongOptions(song).rhythmAutomation as Partial<RhythmAutomationDraft> | undefined;
          const memory = scope === "song" && stored && Number.isInteger(stored.memory) ? stored.memory! : scope === "song" ? 1 : firstMemory + i;
          const current = currentRhythmAutomation(song);
          return { song, draft: current ? { ...current.draft, memory } : suggestRhythmAutomation(song, memory) };
        }),
      );
    } catch (problem) {
      setDrafts([]);
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  };
  const write = (song: RhythmAutomationSong, chart: string, options: string) => {
    // Unopened songs need their existing chord and band settings before cue-only edits are compared for regeneration.
    if (song.key.startsWith(LIBRARY_PREFIX)) seedSettings(song.key.slice(LIBRARY_PREFIX.length), song.settings);
    setSetting(song.key, ":options", options);
    if (song.key === current.key) onSaveChart(chart);
    else setSetting(song.key, "", chart);
  };
  const finishSave = async (notice: string) => {
    try {
      await flushSettings();
      setRetry(false);
      setMessage(notice);
    } catch (problem) {
      setRetry(true);
      setError(`The cue edits are kept in the app, but saving to the library failed: ${problem instanceof Error ? problem.message : String(problem)}`);
    }
  };
  const apply = async () => {
    if (blocked || !entries.length || entries.some((entry) => !entry.plan) || conflicts.length) return;
    setError("");
    try {
      const selected = playlists.find((playlist) => playlist.id === scope);
      if (scope !== "song" && JSON.stringify(selected?.songs.map((id) => LIBRARY_PREFIX + id)) !== JSON.stringify(entries.map((entry) => entry.song.key)))
        throw new Error("The playlist order changed since the preview. Preview cues again before saving.");
      // Validate the whole playlist before any song changes, including edits still waiting to be saved.
      for (const { song } of entries) {
        const now = latest(song);
        if (JSON.stringify(now.settings) !== JSON.stringify(song.settings) || now.duration !== song.duration)
          throw new Error(`${song.title} changed since the preview. Preview cues again before saving.`);
      }
      setSaving(true);
      const edits = entries.map(({ song, draft, plan }) => ({
        song,
        chart: plan!.chart,
        options: JSON.stringify({ ...rhythmSongOptions(song), rhythmAutomation: automaticRhythmSettings(song, draft, controls) }),
      }));
      for (const edit of edits) write(edit.song, edit.chart, edit.options);
      pedal.setChannel(RHYTHM_PEDAL_ID, controls.channel);
      for (const { key, action } of RHYTHM_CONTROLS) pedal.setAssignment(RHYTHM_PEDAL_ID, action, controls[key]);
      setSaved(edits);
      setDrafts([]);
      await finishSave(
        `Saved automatic rhythm cues for ${edits.length} song${edits.length === 1 ? "" : "s"}. Select the MIDI output and enable Send cues before playing from the beginning.`,
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setSaving(false);
    }
  };
  const undo = async () => {
    if (blocked) return;
    setError("");
    try {
      for (const edit of saved) {
        const now = latest(edit.song).settings;
        if (now[""] !== edit.chart || now[":options"] !== edit.options)
          throw new Error(`${edit.song.title} changed since saving. Undo was not applied to any song.`);
      }
      setSaving(true);
      for (const edit of saved) write(edit.song, edit.song.settings[""] ?? "", edit.song.settings[":options"] ?? "{}");
      setSaved([]);
      await finishSave("Restored the previous song cues and options. The pedal control assignments are kept.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setSaving(false);
    }
  };
  const enabled = (rhythmSongOptions(current).rhythmAutomation as { followSong?: boolean } | undefined)?.followSong === true;
  const disable = async () => {
    if (blocked) return;
    setError("");
    setSaving(true);
    try {
      const song = latest(current);
      const options = rhythmSongOptions(song);
      const chart = replaceRhythmAutomation(song.settings[""] ?? "", "");
      delete options.rhythmAutomation;
      const json = JSON.stringify(options);
      write(song, chart, json);
      setSaved([{ song, chart, options: json }]);
      setDrafts([]);
      await finishSave("Automatic RC-10R cues turned off for this song. Other song cues are kept.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setSaving(false);
    }
  };
  return {
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
  };
}
