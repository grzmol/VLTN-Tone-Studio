import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { debouncedCommit } from "@/song/performance/debounced-commit";
import { effectiveBpm } from "@/song/performance/speed";
import { useSession, type PerformanceSession } from "@/song/performance/session";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * A number field for pitch or fine tune. What is typed shows at once, but the speed changes (and a render starts) 250 ms after the
 * last keystroke, or at once on Enter or when the field is left, so typing "-12" does not render "-" and "-1" on the way.
 */
function NumberField({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = useMemo(
    () =>
      debouncedCommit<string>((text) => {
        setDraft(null);
        onCommit(Number(text) || 0);
      }),
    [onCommit],
  );
  // A field that goes away with a change still waiting commits it, so nothing typed is lost.
  useEffect(() => commit.flush, [commit]);
  return (
    <input
      aria-label={label}
      className={field + " w-20"}
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        commit.change(e.target.value);
      }}
      onBlur={commit.flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit.flush();
      }}
    />
  );
}

/**
 * The song's speed, pitch and fine tune, and whether the chord names follow the pitch. The speed slider commits when it is let go,
 * so a drag starts one render, not one for every step.
 */
export function SpeedControls({ session, bpm }: { session: PerformanceSession; bpm: number }) {
  const speed = useSession(session, (s) => s.speed);
  const rendering = useSession(session, (s) => s.rendering);
  const [draft, setDraft] = useState<number | null>(null);
  const percent = draft ?? Math.round(speed.rate * 100);
  const setSemitones = useCallback((semitones: number) => session.setSpeed({ semitones }), [session]);
  const setCents = useCallback((cents: number) => session.setSpeed({ cents }), [session]);
  const commit = (e: { currentTarget: HTMLInputElement }) => {
    if (draft === null) return;
    setDraft(null);
    session.setSpeed({ rate: Number(e.currentTarget.value) / 100 });
  };
  return (
    <div aria-label="Speed and pitch" className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold">Speed & pitch</h2>
      <label className="flex items-center gap-2">
        Speed
        <input
          aria-label="Speed"
          className="w-40"
          type="range"
          min="50"
          max="150"
          step="1"
          value={percent}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </label>
      <span className="w-12 tabular-nums">{percent}%</span>
      <Button variant="outline" size="sm" disabled={speed.rate === 1} onClick={() => session.setSpeed({ rate: 1 })}>
        Reset speed
      </Button>
      <label>
        Pitch{" "}
        <NumberField label="Pitch semitones" value={speed.semitones} min={-6} max={6} onCommit={setSemitones} />
      </label>
      <label>
        Fine tune{" "}
        <NumberField label="Pitch cents" value={speed.cents} min={-50} max={50} onCommit={setCents} />{" "}
        cents
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" aria-label="Apply pitch to chords" checked={speed.applyToChords} onChange={(e) => session.setSpeed({ applyToChords: e.target.checked })} />
        Apply pitch to chords
      </label>
      <span className="text-sm tabular-nums text-silkscreen-3">Plays at {Math.round(effectiveBpm(bpm, speed.rate))} BPM</span>
      {rendering && (
        <span role="status" className="text-sm text-silkscreen-3">
          Rendering… {rendering.done} of {rendering.total} tracks
        </span>
      )}
    </div>
  );
}
