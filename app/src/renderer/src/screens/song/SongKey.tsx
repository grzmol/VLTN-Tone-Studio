import { useEffect, useMemo, useState } from "react";
import type { PcmAudio, Stems } from "@/song/types";
import { KEY_NAMES, SONG_KEYS, effectiveSongKey, keyAudio, type KeyEstimate, type KeyInput } from "@/song/performance/key";
import { readOptions, setSetting } from "@/song/performance/settings";
import { generatedTrackKeysIn, isCurrent, songAudioId, type SongAnalysis } from "@/song/analysis/song-analysis";
import type { Section } from "@/song/performance/sections";
import { storedAnalysis } from "./use-song-analysis";
import { HelpNote } from "@/components/ui/help-note";

interface KeySettings {
  songKey: string;
  detectedKey: KeyEstimate | null;
  keyAudioSource: string;
}
/** The id the song's analysis is saved under: the audio without the generated parts, which the analysis never reads. */
function savedAudioId(songKey: string, mix: PcmAudio, stems: Stems | null): string {
  return songAudioId(mix, stems, generatedTrackKeysIn(readOptions<Record<string, unknown>>(songKey, {})));
}

/**
 * The key the song analysis saved for this audio and stem. Null when nothing matches, so the key is estimated again. Reusing it means a
 * song is not analysed twice: the analysis and the key panel both read the same stem.
 */
function savedKey(songKey: string, name: string, mix: PcmAudio | undefined, stems: Stems | null): KeyEstimate | null {
  if (!mix) return null;
  const saved = storedAnalysis(songKey).read();
  if (!saved || !isCurrent(saved, savedAudioId(songKey, mix, stems)) || saved.key?.source !== name) return null;
  return saved.key.estimate;
}

/**
 * The keys of the sections that differ from the song's, as the song analysis saved them for this audio. Each key belongs to the detected
 * section it was measured in; it is named after the song's own section that covers the middle of that one, so the names are the ones on
 * the timeline: "Bridge 1: D major". A key equal to the song's key is left out. Empty when nothing matches, so nothing is shown for a
 * song that was not analysed.
 */
export function sectionKeyLines(saved: SongAnalysis | null, sections: readonly Section[], songKeyName: string | undefined): string[] {
  const lines: string[] = [];
  for (const { sectionId, key } of saved?.keySections ?? []) {
    if (key.name === songKeyName) continue;
    const detected = saved?.sections?.[Number(sectionId)];
    const middle = detected ? (detected.start + detected.end) / 2 : undefined;
    const own = middle === undefined ? undefined : sections.find((section) => section.start <= middle && middle < section.end);
    lines.push(`${own?.name ?? detected?.name ?? "Section"}: ${key.name}`);
  }
  return lines;
}

/** The analysis saved for this audio, or null when there is none or it is out of date. */
function currentAnalysis(songKey: string, mix: PcmAudio | undefined, stems: Stems | null): SongAnalysis | null {
  if (!mix) return null;
  const saved = storedAnalysis(songKey).read();
  return saved && isCurrent(saved, savedAudioId(songKey, mix, stems)) ? saved : null;
}

const FLAVOUR_NAMES = { mixolydian: "Mixolydian", dorian: "Dorian" } as const;

/** The song's key readout and override. It reports the key the chord names are spelled by, so the panel's screens follow the same key. */
export function SongKey({
  stems,
  original,
  storageKey,
  shift = 0,
  libraryKey,
  onSpellingKey,
  sections = [],
}: {
  stems: Stems | null;
  original?: PcmAudio;
  storageKey: string;
  shift?: number;
  /** The key saved on the song's library entry, used when there is no override and no strong estimate */
  libraryKey?: string;
  onSpellingKey?: (key: string | undefined) => void;
  /** The song's own sections, which name the keys of the detected ones */
  sections?: readonly Section[];
}) {
  const [saved] = useState(() => readOptions<KeySettings>(storageKey, { songKey: "", detectedKey: null, keyAudioSource: "" }));
  const [override, setOverride] = useState(SONG_KEYS.includes(saved.songKey) ? saved.songKey : "");
  const [estimate, setEstimate] = useState<KeyEstimate | null>(saved.detectedKey && SONG_KEYS.includes(saved.detectedKey.name) ? saved.detectedKey : null);
  const [analysisSource, setAnalysisSource] = useState(saved.keyAudioSource);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useMemo(() => keyAudio(stems, original), [stems, original]);
  useEffect(() => {
    // Preserve a saved result while the same source is reanalysed. Switching
    // tabs must not replace useful saved metadata with a temporary null.
    if (!input || input.name !== analysisSource) setEstimate(null);
    setAnalysisSource(input?.name ?? "");
    setError("");
    if (!input) {
      setBusy(false);
      return;
    }
    const known = savedKey(storageKey, input.name, original, stems);
    if (known) {
      setEstimate(known);
      setBusy(false);
      return;
    }
    let active = true,
      worker: Worker | undefined;
    setBusy(true);
    try {
      worker = new Worker(new URL("../../song/performance/key-worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<{ estimate?: KeyEstimate | null; error?: string }>) => {
        if (!active) return;
        setEstimate(event.data.estimate ?? null);
        setError(event.data.error ?? "");
        setBusy(false);
        worker?.terminate();
      };
      worker.onerror = () => {
        if (active) {
          setBusy(false);
          setError("Key analysis could not finish. You can choose the key manually.");
          worker?.terminate();
        }
      };
      // The panel reads one stem on its own: no bass, chords or sections, so the key is the harmony's alone.
      const request: KeyInput = { harmony: input.audio, bass: null, chords: [], sections: [] };
      worker.postMessage(request);
    } catch (e) {
      setBusy(false);
      setError(String(e));
      worker?.terminate();
    }
    return () => {
      active = false;
      worker?.terminate();
    };
  }, [input]);
  useEffect(() => {
    try {
      setSetting(
        storageKey,
        ":options",
        JSON.stringify({ ...readOptions(storageKey, {}), songKey: override, detectedKey: estimate, keyAudioSource: analysisSource }),
      );
    } catch {
      setError("Could not save the song key.");
    }
  }, [storageKey, override, estimate, analysisSource]);
  const spellingKey = effectiveSongKey(override, libraryKey, estimate);
  useEffect(() => onSpellingKey?.(spellingKey), [spellingKey, onSpellingKey]);
  const name = override || estimate?.name;
  const sectionLines = useMemo(
    () => sectionKeyLines(currentAnalysis(storageKey, original, stems), sections, name),
    [storageKey, original, stems, sections, name],
  );
  // A modal flavour is named after the key, such as "G major (Mixolydian)". The key itself, and the transposition, stay the major or minor key.
  const flavour = !override && estimate?.flavour ? ` (${FLAVOUR_NAMES[estimate.flavour]})` : "";
  const root = name ? KEY_NAMES.indexOf(name.split(" ")[0]) : -1;
  const displayed = root < 0 ? "" : `${KEY_NAMES[(((root + shift) % 12) + 12) % 12]} ${name!.split(" ")[1]}`;
  return (
    <section aria-label="Song key" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
      <strong>Song key: {name ? `${name}${flavour}` : busy ? "Analysing…" : "Unknown"}</strong>
      <label>
        Key override{" "}
        <select
          aria-label="Song key override"
          className="rounded border border-seam bg-background p-2"
          value={override}
          onChange={(e) => setOverride(e.target.value)}
        >
          <option value="">Automatic estimate</option>
          {SONG_KEYS.map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </label>
      {name && shift !== 0 && (
        <span>
          Displayed chords: {displayed} ({shift > 0 ? "+" : ""}
          {shift} semitones)
        </span>
      )}
      <span role="status" className="text-silkscreen-3">
        {busy
          ? `Analysing ${analysisSource}…`
          : estimate
            ? `Estimated ${estimate.name} from ${analysisSource} · ${
                estimate.confidence === "strong" ? "clearer match" : "tentative match"
              }${estimate.alternatives.length ? ` · alternatives: ${estimate.alternatives.join(", ")}` : ""}`
            : input
              ? `No reliable major/minor key found in ${analysisSource}.`
              : "Open audio or split the song to analyse its key."}
      </span>
      {sectionLines.length > 0 && <p className="w-full text-sm">Section keys: {sectionLines.join(" · ")}</p>}
      <div className="w-full">
        <HelpNote>
          <p>
            Guitar is preferred, then piano, other, bass, vocals or the original mix. This estimates the recording’s overall major/minor key; relative keys,
            modes and key changes can be ambiguous. A manual choice is saved with the song. Key and chord transposition do not change audio or MIDI.
          </p>
        </HelpNote>
      </div>
      {error && (
        <p role="alert" className="w-full text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
