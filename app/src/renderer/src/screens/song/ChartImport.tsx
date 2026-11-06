import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseChart } from "@/song/performance/chart";
import { importChart } from "@/song/performance/import/import-chart";
import type { ChartMetadata, ImportResult } from "@/song/performance/import/import-result";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { usePlaybackClock } from "@/song/performance/playback-clock";

/** The largest file the import reads. A chart is a few kilobytes; anything larger is probably not a chart. */
const MAX_IMPORT_BYTES = 1024 * 1024;

const FORMAT_NAMES: Record<ImportResult["format"], string> = {
  chordpro: "ChordPro",
  "chord-over-lyrics": "Chords above lyrics",
  app: "The app's chart format",
};

/** A duration as minutes and seconds, such as 3:42. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

/** The song details an import read, as the summary lists them. */
function metadataLines(metadata: ChartMetadata): string[] {
  const entries: [string, string | number | undefined][] = [
    ["Title", metadata.title],
    ["Artist", metadata.artist],
    ["Key", metadata.key],
    ["Tempo", metadata.tempo],
    ["Capo", metadata.capo],
    ["Year", metadata.year],
    ["Duration", metadata.duration === undefined ? undefined : clock(metadata.duration)],
  ];
  return entries.filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([name, value]) => `${name}: ${value}`);
}

/**
 * Reads ChordPro or chord-over-lyrics text into the chart. The summary lists what was read and what was kept as a comment. Replacing the
 * chart is refused while the song plays, and when the chart holds MIDI commands, which an import would otherwise drop without a warning.
 */
export function ChartImport({ chart, onImport }: { chart: string; onImport: (chart: string, metadata: ChartMetadata) => void }) {
  const macros = useMidiConfiguration((s) => s.macros);
  const playing = usePlaybackClock((s) => s.playing);
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState("");
  const hasMidi = (() => {
    try {
      return parseChart(chart, macros).some((cue) => cue.messages.length || cue.trigger);
    } catch {
      return false;
    }
  })();
  const readText = (value: string) => {
    setText(value);
    setResult(value.trim() ? importChart(value, macros) : null);
    setMessage("");
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage("That file is larger than 1 MB, so it is not a chart. Choose a ChordPro or text file.");
      return;
    }
    readText(await file.text());
  };
  const refusal = playing
    ? "Stop playback before replacing the chart with an import."
    : hasMidi
      ? "This chart has MIDI commands or triggers. Remove them in the editor first, so the import cannot drop them without you seeing it."
      : "";
  const lines = result?.metadata ? metadataLines(result.metadata) : [];
  return (
    <section aria-label="Import a chart" className="space-y-3 rounded-lg border border-seam p-3">
      <div>
        <h3 className="font-semibold">Import ChordPro or chords above lyrics</h3>
        <p className="text-silkscreen-3">
          Paste the text, or choose a file. Chords stay in their places. Headings and comments come across, and anything the app does not support is
          listed below before you replace the chart.
        </p>
      </div>
      <textarea
        aria-label="Text to import"
        className="min-h-40 w-full rounded border border-seam bg-background p-2 font-mono text-sm"
        placeholder={"{title: Song}\n[C]Words [G]here"}
        value={text}
        onChange={(event) => readText(event.target.value)}
      />
      <input
        aria-label="Choose a text or ChordPro file"
        type="file"
        accept=".cho,.chordpro,.pro,.crd,.txt"
        onChange={(event) => void readFile(event.target.files?.[0])}
      />
      {message && (
        <p role="alert" className="text-red-400">
          {message}
        </p>
      )}
      {result && (
        <div aria-label="Import summary" className="space-y-2">
          <p>
            Format: {FORMAT_NAMES[result.format]}. {result.chart.split("\n").filter((line) => line.trim()).length} lines.
          </p>
          {lines.length > 0 && <p>Song details: {lines.join(" · ")}. Key, tempo, capo and year are applied to the song when you replace the chart.</p>}
          {result.notes.length > 0 && (
            <div>
              <p className="font-semibold">Not taken as written ({result.notes.length})</p>
              <ul className="list-disc space-y-1 pl-5">
                {result.notes.map((note, index) => (
                  <li key={index}>
                    Line {note.line}: {note.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.error ? (
            <p role="alert" className="text-red-400">
              The import does not parse as a chart: {result.error}. Fix the text and read it again.
            </p>
          ) : (
            refusal && (
              <p role="status" className="text-amber-300">
                {refusal}
              </p>
            )
          )}
        </div>
      )}
      <Button disabled={!result || !!result.error || !!refusal} onClick={() => result && onImport(result.chart, result.metadata)}>
        Replace chart with this import
      </Button>
    </section>
  );
}
