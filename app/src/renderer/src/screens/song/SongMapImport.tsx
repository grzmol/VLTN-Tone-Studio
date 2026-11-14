// Imports a song map into the open saved song (spec 94). The card in the This song view takes a file or pasted text. The dialog shows what
// the map will change, one checkbox per part, and writes only the parts ticked. Apply saves the song and loads it again, so every panel
// reads the new values. Undo puts back what Apply replaced, until the next import or another song.

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HelpNote } from "@/components/ui/help-note";
import { SettingsCard } from "@/components/ui/settings-card";
import { SETTING_SUFFIXES } from "@shared/song-library";
import { host } from "@/host";
import { useSongLibrary } from "@/song/library";
import { flushSettings, getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { planSongMap, type SavedSong, type SongMapPart, type SongMapPlan } from "@/song/songmap/apply";
import { songBrief, type BriefInput } from "@/song/songmap/brief";
import { parseSongMap } from "@/song/songmap/songmap";
import { useSongMapUndo } from "@/song/songmap/undo";

type SettingSuffix = (typeof SETTING_SUFFIXES)[number];
/** A song map larger than this is not a song map. A map is a few kilobytes. */
const MAX_IMPORT_BYTES = 1024 * 1024;
/** Notes longer than this are shown folded, with the full text under How this works. */
const NOTES_SHOWN = 160;

const PART_NAMES: Record<SongMapPart, string> = {
  tempo: "tempo",
  key: "key",
  sections: "sections",
  band: "drums and bass",
  bassNotes: "bass notes",
  marks: "bar marks",
  chart: "chart",
  notes: "notes",
};

/** The song's tempo, options and chart as they are saved now. */
function savedSongOf(songKey: string): SavedSong {
  return {
    bpm: getSetting(songKey, ":bpm"),
    options: readOptions<Record<string, unknown>>(songKey, {}),
    chart: getSetting(songKey, ""),
    lyrics: getSetting(songKey, ":lyrics"),
  };
}

function isSuffix(name: string): name is SettingSuffix {
  return (SETTING_SUFFIXES as readonly string[]).includes(name);
}

/** The (suffix, value) pairs that are settings. A key that is not a setting is left out. */
function settingEntries(pairs: [string, string][]): [SettingSuffix, string][] {
  return pairs.filter((entry): entry is [SettingSuffix, string] => isSuffix(entry[0]));
}

/** Every part the map holds, except a chart that would replace the song's own: that one is left unticked. */
function defaultChoice(plan: SongMapPlan): SongMapPart[] {
  return plan.parts.filter((part) => !(part.part === "chart" && part.replaces)).map((part) => part.part);
}

/** The file name of the brief: the song's title, with the characters a file name cannot hold replaced. */
function briefFileName(title: string): string {
  const safe = title.trim().replace(/[\\/:*?"<>|]/g, "-") || "Song";
  return `${safe} - song brief.md`;
}

/** What the brief is written from, as the song is saved now. */
function briefInputOf(songKey: string, title: string, durationSeconds: number): BriefInput {
  return {
    title,
    durationSeconds,
    bpm: getSetting(songKey, ":bpm"),
    options: readOptions<Record<string, unknown>>(songKey, {}),
    chart: getSetting(songKey, ""),
    lyrics: getSetting(songKey, ":lyrics"),
  };
}

/** Saves the song's pending settings to the library, then loads the song again, so every panel reads the new values. */
async function saveAndReload(libraryId: string): Promise<void> {
  await flushSettings();
  const library = useSongLibrary.getState();
  // A song in the playing set keeps its set; any other song is loaded on its own.
  const inSet = library.queue[library.position] === libraryId;
  await library.load(libraryId, inSet ? library.queue : [libraryId], inSet ? library.position : 0);
}

/** Writes settings through the settings cache, as the runner does. The change reaches the library with the song's other edits. */
function writeEntries(songKey: string, entries: [SettingSuffix, string][]): void {
  for (const [suffix, value] of entries) setSetting(songKey, suffix, value);
}

/**
 * The song map card in the This song view, with the import dialog it opens. The brief export needs the song's audio: `durationSeconds` is
 * its length, and zero means no audio is loaded.
 */
export function SongMapImport({
  songKey,
  libraryId,
  playing,
  title = "",
  durationSeconds = 0,
}: {
  songKey: string;
  libraryId?: string;
  playing: boolean;
  title?: string;
  durationSeconds?: number;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<SongMapPart[] | null>(null);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  // The undo record lives in a store, not here: Apply reloads the song, which remounts this card.
  const undo = useSongMapUndo((state) => state.record);
  const result = useMemo(() => (text.trim() ? parseSongMap(text) : null), [text]);
  const plan = result?.map ? planSongMap(savedSongOf(songKey), result.map) : null;
  const choice = picked ?? (plan ? defaultChoice(plan) : []);
  const notes = readOptions<{ songMapNotes?: unknown }>(songKey, {}).songMapNotes;
  const notesText = typeof notes === "string" ? notes : "";
  const refusal = !libraryId ? "Save the song to import a song map." : playing ? "Stop the song to import." : "";

  const readText = (value: string) => {
    setText(value);
    setPicked(null);
    setProblem("");
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setProblem("That file is larger than 1 MB, so it is not a song map.");
      return;
    }
    readText(await file.text());
    setOpen(true);
  };
  const openPaste = () => {
    readText("");
    setOpen(true);
  };
  const toggle = (part: SongMapPart, on: boolean) => {
    setPicked(on ? [...choice, part] : choice.filter((name) => name !== part));
  };
  const apply = async () => {
    if (!plan || !result?.map || !libraryId || playing || choice.length === 0) return;
    const entries = settingEntries(Object.entries(plan.values(choice)));
    const before = entries.map(([suffix]): [string, string] => [suffix, getSetting(songKey, suffix)]);
    // A part is named by its plan's summary where the summary has the count (the bass notes), and by its name otherwise.
    const applied = choice.map((part) =>
      part === "bassNotes" || part === "marks" ? (plan.parts.find((item) => item.part === part)?.summary ?? PART_NAMES[part]) : PART_NAMES[part],
    );
    try {
      writeEntries(songKey, entries);
      await saveAndReload(libraryId);
      useSongMapUndo.getState().set({ songKey, before, applied: applied.join(", ") });
      setStatus("");
      setOpen(false);
    } catch (error) {
      setProblem(`The song map could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const undoApply = async () => {
    if (!undo || undo.songKey !== songKey || !libraryId) return;
    try {
      writeEntries(songKey, settingEntries(undo.before));
      await saveAndReload(libraryId);
      useSongMapUndo.getState().clear();
      setStatus("Song map undone.");
    } catch (error) {
      setProblem(`The song map could not be undone: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const hasAudio = durationSeconds > 0;
  // The brief is built when it is asked for, so it holds the song as it is then. Neither action changes the song.
  const exportBrief = async () => {
    try {
      const bytes = new TextEncoder().encode(songBrief(briefInputOf(songKey, title, durationSeconds)));
      await host.song.saveFiles([{ name: briefFileName(title), bytes }], "Export song brief");
      setProblem("");
    } catch (error) {
      setProblem(`The song brief could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(songBrief(briefInputOf(songKey, title, durationSeconds)));
      setProblem("");
      setStatus("Song brief copied.");
    } catch (error) {
      setProblem(`The song brief could not be copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const showUndo = undo?.songKey === songKey;
  // The line after Apply comes from the stored record, so it survives the reload; "undone" and errors are this card's own.
  const shownStatus = status || (showUndo && undo ? `Song map applied: ${undo.applied}.` : "");

  return (
    <SettingsCard
      title="Song map"
      storageKey="song-map"
      summary="Import a song map from an assistant: tempo, key, sections, drums and bass, bass notes, chart and notes."
      actions={
        <>
          <Button variant="outline" size="sm" disabled={!!refusal} title={refusal || undefined} onClick={() => fileInput.current?.click()}>
            Import song map…
          </Button>
          <Button variant="outline" size="sm" disabled={!!refusal} title={refusal || undefined} onClick={openPaste}>
            Paste…
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasAudio}
            title={hasAudio ? undefined : "Load a song with audio to export its brief."}
            onClick={() => void exportBrief()}
          >
            Export song brief…
          </Button>
          <Button variant="outline" size="sm" disabled={!hasAudio} onClick={() => void copyBrief()}>
            Copy brief
          </Button>
        </>
      }
    >
      <input
        ref={fileInput}
        aria-label="Choose a song map file"
        type="file"
        accept=".md,.txt"
        hidden
        onChange={(event) => {
          void readFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {notesText && (
        <p className="text-xs">
          From the song map: {notesText.length > NOTES_SHOWN ? `${notesText.slice(0, NOTES_SHOWN)}…` : notesText}
          {notesText.length > NOTES_SHOWN && (
            <HelpNote label="Full notes">
              <p className="whitespace-pre-line">{notesText}</p>
            </HelpNote>
          )}
        </p>
      )}
      {shownStatus && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{shownStatus}</span>
          {showUndo && (
            <Button variant="outline" size="sm" disabled={playing} onClick={() => void undoApply()}>
              Undo
            </Button>
          )}
        </p>
      )}
      {problem && !open && (
        <p role="alert" className="text-xs text-red-400">
          {problem}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import a song map</DialogTitle>
            <DialogDescription>Choose the parts to apply. Nothing changes until you press Apply.</DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Song map text"
            className="min-h-40 w-full rounded border border-seam bg-background p-2 font-mono text-sm"
            placeholder={"---\nsongmap: 1\n---"}
            value={text}
            onChange={(event) => readText(event.target.value)}
          />
          {result && result.problems.length > 0 && (
            <ul aria-label="Problems in the song map" className="list-disc space-y-1 pl-5 text-xs text-amber-300">
              {result.problems.map((item) => (
                <li key={`${item.line}-${item.message}`}>Skipped: {item.message}</li>
              ))}
            </ul>
          )}
          {result && !result.map && (
            <p role="alert" className="text-sm text-red-400">
              This is not a song map of this version, so nothing can be applied.
            </p>
          )}
          {plan && plan.parts.length === 0 && (
            <p className="text-sm text-silkscreen-3" role="status">
              This song map matches the song. There is nothing to change.
            </p>
          )}
          {plan && plan.parts.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-semibold">What will change</legend>
              {plan.parts.map((part) => (
                <label key={part.part} className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={choice.includes(part.part)} onCheckedChange={(value) => toggle(part.part, value === true)} />
                  <span>
                    {part.summary}
                    {part.replaces && <span className="block text-xs text-amber-300">{part.replaces}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {problem && open && (
            <p role="alert" className="text-xs text-red-400">
              {problem}
            </p>
          )}
          {refusal && <p className="text-xs text-amber-300">{refusal}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!plan || choice.length === 0 || !!refusal} onClick={() => void apply()}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
