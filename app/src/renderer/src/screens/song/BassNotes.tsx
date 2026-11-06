import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BassFrom } from "@/song/band/arrangement";
import {
  applyScope,
  barNumberAt,
  bassOverrideAt,
  clearBassOverrideAt,
  NOTE_SOURCE_TEXT,
  noteNameOf,
  noteSourceAt,
  OVERRIDE_SCOPES,
  usesFlats,
  type BassOverride,
  type OverrideOctave,
  type OverrideScope,
  type ScopeContext,
} from "@/song/band/bass-overrides";
import type { BassLineBeat } from "@/song/analysis/bass-line";
import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import type { Section } from "@/song/performance/sections";

const SCOPE_TEXT: Record<OverrideScope, string> = {
  beat: "This beat",
  bar: "This bar",
  untilChange: "Until the next chord change",
  sectionChord: "This chord everywhere in this section",
};
const OCTAVE_TEXT: Record<string, string> = { "-1": "Down an octave", "0": "Same octave", "1": "Up an octave" };

/** What the bass-note editor and the list need from the panel. */
export interface BassNotesContext {
  grid: BeatGrid;
  harmony: readonly ChordAtBeat[];
  overrides: readonly BassOverride[];
  sections: readonly Section[];
  songEnd: number;
  bassLine: readonly BassLineBeat[] | null;
  bassFrom: BassFrom;
  /** False while the song plays or a job runs: the edits are then disabled. */
  disabled: boolean;
  /** Saves the overrides. */
  onChange(overrides: BassOverride[]): void;
  /** Renders about two bars from `from` with `overrides` in place, without saving them. */
  onListen(from: number, overrides: BassOverride[]): void;
}

/** A time in seconds, one decimal place, for the strip and the list. */
const seconds = (time: number) => `${time.toFixed(1)} s`;

/**
 * The editor for one beat's bass note: the beat's time and bar, the chord, the note the bass plays now and why, then the note, the octave
 * nudge and where it applies. Reset removes the override on this beat. Listen plays about two bars around the beat with the choice in place.
 */
export function BassNoteEditor({ beat, context, onClose }: { beat: number; context: BassNotesContext; onClose(): void }) {
  const { grid, harmony, overrides, sections, songEnd, bassLine, bassFrom, disabled, onChange, onListen } = context;
  const flats = usesFlats(harmony);
  const entry = harmony[beat];
  const time = grid.beats[beat];
  const existing = bassOverrideAt(overrides, time);
  const playedPc = entry?.chord?.bass ?? null;
  const source = noteSourceAt(beat, harmony, overrides, bassLine, bassFrom);
  const [pc, setPc] = useState<number>(existing?.pc ?? playedPc ?? 0);
  const [octave, setOctave] = useState<OverrideOctave>(existing?.octave ?? 0);
  const [scope, setScope] = useState<OverrideScope>("beat");
  const scopeContext: ScopeContext = { grid, harmony, sections, songEnd };
  // One bar of the grid's own length before the beat, so the listen covers the bar before and the bar of the beat.
  const barSeconds = grid.beats.length > 1 ? ((grid.beats[grid.beats.length - 1] - grid.beats[0]) / (grid.beats.length - 1)) * grid.beatsPerBar : 2;
  const apply = () => onChange(applyScope(overrides, scope, beat, scopeContext, pc, octave));
  const listen = () => onListen(Math.max(0, time - barSeconds), applyScope(overrides, scope, beat, scopeContext, pc, octave));

  return (
    <section aria-label="Bass note editor" className="flex flex-col gap-3 rounded-md border border-seam p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p>
            Beat {beat + 1} at {seconds(time)}, bar {barNumberAt(grid, beat)}
          </p>
          <p>Chord: {entry?.chord?.name ?? "none"}</p>
          <p>
            The bass plays {playedPc === null ? "nothing" : noteNameOf(playedPc, flats)}, {NOTE_SOURCE_TEXT[source].toLowerCase()}.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(pc)} onValueChange={(value) => setPc(Number(value))} disabled={disabled}>
          <SelectTrigger aria-label="Bass note" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, note) => (
              <SelectItem key={note} value={String(note)}>
                {noteNameOf(note, flats)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(octave)} onValueChange={(value) => setOctave(Number(value) as OverrideOctave)} disabled={disabled}>
          <SelectTrigger aria-label="Octave" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OCTAVE_TEXT).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={scope} onValueChange={(value) => setScope(value as OverrideScope)} disabled={disabled}>
          <SelectTrigger aria-label="Apply to" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OVERRIDE_SCOPES.map((option) => (
              <SelectItem key={option} value={option}>
                {SCOPE_TEXT[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={disabled} onClick={apply}>
          Apply
        </Button>
        <Button size="sm" variant="outline" disabled={disabled} onClick={listen}>
          Listen
        </Button>
        <Button size="sm" variant="outline" disabled={disabled || !existing} onClick={() => onChange(clearBassOverrideAt(overrides, time))}>
          Reset
        </Button>
      </div>
    </section>
  );
}

/** The list of the performer's bass notes, with each one's range, note and a remove button, and Remove all. */
export function BassNoteList({ harmony, overrides, disabled, onChange }: Pick<BassNotesContext, "harmony" | "overrides" | "disabled" | "onChange">) {
  if (overrides.length === 0) return null;
  const flats = usesFlats(harmony);
  return (
    <section aria-label="Your bass notes" className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Your bass notes ({overrides.length})</h4>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange([])}>
          Remove all
        </Button>
      </div>
      <ul className="flex flex-col gap-1">
        {overrides.map((entry) => (
          <li key={entry.start} className="flex items-center justify-between gap-2">
            <span>
              {noteNameOf(entry.pc, flats)}
              {entry.octave ? (entry.octave > 0 ? " up an octave" : " down an octave") : ""}, {seconds(entry.start)} to {seconds(entry.end)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`Remove the bass note from ${seconds(entry.start)}`}
              onClick={() => onChange(overrides.filter((other) => other !== entry))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
