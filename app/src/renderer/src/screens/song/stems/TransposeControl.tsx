import { useEffect, useRef, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { notifyError } from "@/app/notify";
import { Button } from "@/components/ui/button";
import { MAX_SEMITONES } from "@/song/stems/transpose-core";
import { transposeStems } from "@/song/stems/transpose";
import type { Stems } from "@/song/types";

export const fmtShift = (n: number) => (n === 0 ? "0" : `${n > 0 ? "+" : "−"}${Math.abs(n)}`);

/**
 * Tune the split's stems down or up (a song in E♭ for a guitar in standard, say). The shift is computed in a worker and
 * replaces what the player plays; going back to 0 puts the original back without computing anything. `beforeSwap` runs
 * just before the new stems replace the old ones, so the caller can keep its playback position.
 */
export function useTranspose(stems: Stems, beforeSwap: () => void) {
  const [applied, setApplied] = useState<{ semitones: number; stems: Stems | null }>({ semitones: 0, stems: null });
  const [job, setJob] = useState<{ semitones: number; progress: number } | null>(null);
  const running = useRef<AbortController | null>(null);
  const swap = useRef(beforeSwap);
  swap.current = beforeSwap;

  // A new split brings new stems: back to the original, and drop a shift still running for the old ones.
  useEffect(() => {
    running.current?.abort();
    setApplied({ semitones: 0, stems: null });
    setJob(null);
    return () => running.current?.abort();
  }, [stems]);

  const set = async (wanted: number) => {
    const semitones = Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, wanted));
    running.current?.abort();
    if (semitones === 0) {
      swap.current();
      setApplied({ semitones: 0, stems: null });
      return setJob(null);
    }
    const ctrl = new AbortController();
    running.current = ctrl;
    setJob({ semitones, progress: 0 });
    try {
      const shifted = await transposeStems(stems, semitones, (progress) => setJob({ semitones, progress }), ctrl.signal);
      swap.current();
      setApplied({ semitones, stems: shifted });
      setJob(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setJob(null);
      notifyError("Couldn't change the key", e);
    }
  };

  return { semitones: applied.semitones, heard: applied.stems ?? stems, job, set };
}

/** − / + a semitone with the shift shown ("+2"), a percentage while it is computed, and a reset. */
export function TransposeControl({ semitones, job, onChange }: { semitones: number; job: { semitones: number; progress: number } | null; onChange(semitones: number): void }) {
  const shown = job ? job.semitones : semitones;
  return (
    <div role="group" aria-label="Transpose" className="flex shrink-0 items-center gap-1" title="Tune the whole song down or up without changing its tempo">
      <span className="mr-0.5 text-[12px] text-silkscreen-3">Key</span>
      <Button variant="outline" size="icon-sm" aria-label="One semitone down" disabled={shown <= -MAX_SEMITONES} onClick={() => onChange(shown - 1)}>
        <MinusIcon aria-hidden />
      </Button>
      <span className="w-14 text-center text-[12px] text-silkscreen-2 tabular-nums" aria-live="polite">
        {job ? `${Math.round(job.progress * 100)}%` : `${fmtShift(shown)} st`}
      </span>
      <Button variant="outline" size="icon-sm" aria-label="One semitone up" disabled={shown >= MAX_SEMITONES} onClick={() => onChange(shown + 1)}>
        <PlusIcon aria-hidden />
      </Button>
      <Button variant="ghost" size="xs" disabled={shown === 0 && !job} onClick={() => onChange(0)}>
        Reset
      </Button>
    </div>
  );
}
