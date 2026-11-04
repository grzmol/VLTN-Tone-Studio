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
import { useSongLibrary } from "@/song/library";
import { flushSettings, getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { planSongMap, type SavedSong, type SongMapPart, type SongMapPlan } from "@/song/songmap/apply";
import { parseSongMap } from "@/song/songmap/songmap";

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
  chart: "chart",
  notes: "notes",
};

/** The song's tempo, options and chart as they are saved now. */
function savedSongOf(songKey: string): SavedSong {
  return { bpm: getSetting(songKey, ":bpm"), options: readOptions<Record<string, unknown>>(songKey, {}), chart: getSetting(songKey, "") };
}

function isSuffix(name: string): name is SettingSuffix {
  return (SETTING_SUFFIXES as readonly string[]).includes(name);
}

/** The settings a plan writes, as (suffix, value) pairs. A key that is not a setting is left out. */
function entriesOf(values: Record<string, string>): [SettingSuffix, string][] {
  return Object.entries(values).filter((entry): entry is [SettingSuffix, string] => isSuffix(entry[0]));
}

/** Every part the map holds, except a chart that would replace the song's own: that one is left unticked. */
function defaultChoice(plan: SongMapPlan): SongMapPart[] {
  return plan.parts.filter((part) => !(part.part === "chart" && part.replaces)).map((part) => part.part);
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

/** The song map card in the This song view, with the import dialog it opens. */
export function SongMapImport({ songKey, libraryId, playing }: { songKey: string; libraryId?: string; playing: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<SongMapPart[] | null>(null);
  const [problem, setProblem] = useState("");
  const [status, setStatus] = useState("");
  const [undo, setUndo] = useState<{ songKey: string; before: [SettingSuffix, string][]; applied: string } | null>(null);
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
    const values = plan.values(choice);
    const entries = entriesOf(values);
    const before = entries.map(([suffix]): [SettingSuffix, string] => [suffix, getSetting(songKey, suffix)]);
    // A part is named by its plan's summary where the summary has the count (the bass notes), and by its name otherwise.
    const applied = choice.map((part) => (part === "bassNotes" ? (plan.parts.find((item) => item.part === part)?.summary ?? PART_NAMES[part]) : PART_NAMES[part]));
    try {
      writeEntries(songKey, entries);
      await saveAndReload(libraryId);
      setUndo({ songKey, before, applied: applied.join(", ") });
      setStatus(`Song map applied: ${applied.join(", ")}.`);
      setOpen(false);
    } catch (error) {
      setProblem(`The song map could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const undoApply = async () => {
    if (!undo || undo.songKey !== songKey || !libraryId) return;
    try {
      writeEntries(songKey, undo.before);
      await saveAndReload(libraryId);
      setUndo(null);
      setStatus("Song map undone.");
    } catch (error) {
      setProblem(`The song map could not be undone: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const showUndo = undo?.songKey === songKey;

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
      {status && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{status}</span>
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
      {/* Export song brief… (spec 95) goes here, next to the import buttons. */}
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
          {plan && plan.parts.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-semibold">What will change</legend>
              {plan.parts.map((part) => (
                <label key={part.part} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={choice.includes(part.part)}
                    onCheckedChange={(value) => toggle(part.part, value === true)}
                  />
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
