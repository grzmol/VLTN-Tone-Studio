import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { doubleTempo, halveTempo, nudgeGrid, shiftDownbeat, type BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { BandGrid } from "./BandGrid";
import { BassNoteEditor, BassNoteList, type BassNotesContext } from "./BassNotes";

export interface BandGridSectionProps {
  grid: BeatGrid | null;
  harmony: readonly ChordAtBeat[];
  /** True while the panel is busy or the song plays: the grid's actions are then disabled. */
  blocked: boolean;
  busy: boolean;
  /** What the panel is doing now, shown with a spinner, or null. */
  work: string | null;
  /** Replaces the grid, from a correction or a found beat. */
  onGrid(grid: BeatGrid | null): void;
  onFind(): void;
  onCancel(): void;
  /** Builds the grid from the metronome's fixed tempo. */
  onFixed(): void;
  /** Writes a steady grid's tempo to the metronome. */
  onSetTempo(): void;
  /** The tempo the performer set by hand, which the beat is found from when `use` is on. Not shown when not given. */
  myTempo?: { bpm: number; use: boolean; onUse(use: boolean): void };
  /** The performer's bass notes (spec 87): the strip's beats pick one to edit, and the list shows them. Not shown when not given. */
  bassNotes?: Omit<BassNotesContext, "grid" | "harmony">;
  /** Which half to show: the timing controls and the tempo summary (Timing tab), or the chord strip with the bass notes (Notes tab). */
  view: "timing" | "notes";
}

/** The beat grid, in two views: the timing controls (find the beat, corrections, fixed tempo), or the chord strip and the bass notes. */
export function BandGridSection({
  grid,
  harmony,
  blocked,
  busy,
  work,
  onGrid,
  onFind,
  onCancel,
  onFixed,
  onSetTempo,
  myTempo,
  bassNotes,
  view,
}: BandGridSectionProps) {
  // The beat whose bass note is open in the editor. A beat is toggled off by picking it again.
  const [editing, setEditing] = useState<number | null>(null);
  if (view === "notes") {
    return (
      <section aria-label="Bass notes" className="flex min-w-0 flex-col gap-3">
        {grid ? (
          <>
            <BandGrid
              grid={grid}
              harmony={harmony}
              overrides={bassNotes?.overrides}
              selected={editing}
              onSelect={bassNotes ? (beat) => setEditing(editing === beat ? null : beat) : undefined}
            />
            {bassNotes && editing !== null && editing < grid.beats.length && (
              <BassNoteEditor key={editing} beat={editing} context={{ ...bassNotes, grid, harmony }} onClose={() => setEditing(null)} />
            )}
            {bassNotes && <BassNoteList harmony={harmony} overrides={bassNotes.overrides} disabled={bassNotes.disabled} onChange={bassNotes.onChange} />}
          </>
        ) : (
          <p className="text-silkscreen-3">No chord strip yet. Find the beat on the Timing tab first.</p>
        )}
      </section>
    );
  }
  return (
    <section aria-label="Beat grid" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={blocked} onClick={onFind}>
          Find the beat
        </Button>
        {myTempo && (
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={myTempo.use} disabled={blocked} onCheckedChange={(value) => myTempo.onUse(value === true)} />
            Use my tempo ({myTempo.bpm} BPM)
          </label>
        )}
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(halveTempo(grid))}>
          Half tempo
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(doubleTempo(grid))}>
          Double tempo
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(shiftDownbeat(grid, -1))}>
          Downbeat ←
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(shiftDownbeat(grid, 1))}>
          Downbeat →
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(nudgeGrid(grid, -0.01))}>
          Nudge −10 ms
        </Button>
        <Button size="sm" variant="outline" disabled={blocked || !grid} onClick={() => grid && onGrid(nudgeGrid(grid, 0.01))}>
          Nudge +10 ms
        </Button>
        <Button size="sm" variant="outline" disabled={blocked} onClick={onFixed}>
          Use fixed BPM
        </Button>
        {busy && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {work && (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {work}
        </p>
      )}
      {grid ? (
        <>
          <p>
            {grid.bpm.toFixed(1)} BPM, {grid.steady ? "steady" : "drifting"}, {grid.beats.length} beats, {grid.beatsPerBar} per bar.
          </p>
          {grid.steady && (
            <div>
              <Button size="sm" variant="outline" disabled={blocked} onClick={onSetTempo}>
                Set metronome to this tempo
              </Button>
            </div>
          )}
        </>
      ) : (
        <p className="text-silkscreen-3">No beat grid yet. Find the beat, or use the fixed BPM.</p>
      )}
    </section>
  );
}
