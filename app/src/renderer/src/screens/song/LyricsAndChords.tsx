import { lazy, Suspense, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { HelpNote } from "@/components/ui/help-note";
import { host } from "@/host";
import { transpose, type Cue } from "@/song/performance/chart";
import { useActiveIndex } from "@/song/performance/playback-clock";
import { CAPO_MAX, keySpelling } from "@/song/performance/speed";
import { useSession, type PerformanceSession } from "@/song/performance/session";

// The chart editor is loaded when this panel first renders it, so the CodeMirror code is kept out of the main bundle.
const ChartCodeEditor = lazy(() => import("./ChartCodeEditor"));

const field = "rounded border border-seam bg-transparent p-2";

/** Small safe formatting subset; imported charts never become HTML. */
function chartLine(text: string) {
  return text
    .replace(/\[N\]/g, "—")
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g)
    .map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith("*") ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : /^\[[A-G]/.test(part) ? (
        <span key={i} className="mr-1 font-bold text-sky-400">
          {part.slice(1, -1)}
        </span>
      ) : (
        part
      ),
    );
}

/** The plain lyrics preview. It owns the active-line subscription so the panel does not re-render on line changes. */
function ChartLines({ cues, shift, flats }: { cues: Cue[]; shift: number; flats?: boolean }) {
  const active = useActiveIndex(useMemo(() => cues.map((cue) => cue.time), [cues]));
  return cues.map((cue, i) => (
    <p key={i} className={i === active ? "rounded bg-white/10 font-bold" : "text-silkscreen-3"}>
      {chartLine(transpose(cue.text, shift, flats) || "♪")}
    </p>
  ));
}

/** Transpose, capo, chart import and export, and the chart editor. */
export function LyricsAndChords({
  session,
  chart,
  onSaveChart,
  shift,
  onShift,
  songKey,
  capo,
  onCapo,
}: {
  session: PerformanceSession;
  chart: string;
  onSaveChart: (chart: string) => void;
  shift: number;
  onShift: (value: number) => void;
  /** The song's key, which the chord names are spelled by */
  songKey?: string;
  capo: number;
  onCapo: (value: number) => void;
}) {
  // Lyric lines are the chart's own cues: the triggers and the MIDI file's messages have no lyrics to show.
  const sessionCues = useSession(session, (s) => s.cues);
  const cues = useMemo(() => sessionCues.filter((cue) => !cue.trigger && !cue.fromFile), [sessionCues]);
  const flats = keySpelling(songKey, shift);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Lyrics & chords</h2>
        <label>
          Transpose{" "}
          <input
            aria-label="Transpose semitones"
            className={field + " w-20"}
            type="number"
            min="-12"
            max="12"
            value={shift}
            onChange={(e) => onShift(Math.max(-12, Math.min(12, Number(e.target.value) || 0)))}
          />
        </label>
        <label>
          Capo{" "}
          <input
            aria-label="Capo fret"
            className={field + " w-16"}
            type="number"
            min="0"
            max={CAPO_MAX}
            value={capo}
            onChange={(e) => onCapo(Number(e.target.value) || 0)}
          />
        </label>
        <label className="cursor-pointer underline">
          Import TXT / LRC / ChordPro
          <input
            type="file"
            accept=".txt,.lrc,.cho,.chordpro"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void f.text().then(onSaveChart).catch(session.fail);
              e.target.value = "";
            }}
          />
        </label>
        <Button
          variant="outline"
          onClick={() =>
            void host.song.saveFiles([{ name: "performance.lrc", bytes: new TextEncoder().encode(chart) }], "Export lyrics and MIDI cues").catch(session.fail)
          }
        >
          Export chart
        </Button>
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Chart editor</summary>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <Suspense
              fallback={<textarea aria-label="Lyrics and MIDI chart" className={field + " min-h-64 w-full font-mono text-sm"} value={chart} readOnly />}
            >
              <ChartCodeEditor
                label="Lyrics and MIDI chart"
                value={chart}
                onChange={onSaveChart}
                hint={"[00:00.00] [C]Verse\n[00:10.00] [Am]Your lyrics {midi:pc 1 0}\n[00:20.00] [F]Chorus {midi:cc 1 64 127}"}
              />
            </Suspense>
            <HelpNote>
              <p>
                Saved locally for this audio filename and length. LRC timestamps enable scrolling and MIDI. Chords use [Am] or [C/G]. MIDI: pc, cc, note, off,
                sysex. Note cues need a matching off cue. Transpose changes the chart only.
              </p>
            </HelpNote>
          </div>
          <div className="max-h-96 overflow-auto rounded border border-seam p-4 text-2xl leading-relaxed" aria-label="Performance lyrics">
            {cues.length ? (
              <ChartLines cues={cues} shift={shift} flats={flats} />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">{chartLine(transpose(chart, shift, flats))}</pre>
            )}
          </div>
        </div>
      </details>
    </>
  );
}
