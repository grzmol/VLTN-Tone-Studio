import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { bassOverrideAt, noteNameOf, usesFlats, type BassOverride } from "@/song/band/bass-overrides";

/** The beats of the song, grouped into bars from each downbeat. A bar before the first downbeat is shown as a short bar. */
function barsOf(grid: BeatGrid): number[][] {
  const bars: number[][] = [];
  grid.beats.forEach((_, beat) => {
    const startsBar = bars.length === 0 || (beat - grid.downbeat) % grid.beatsPerBar === 0;
    if (startsBar) bars.push([beat]);
    else bars[bars.length - 1].push(beat);
  });
  return bars;
}

export interface BandGridProps {
  grid: BeatGrid;
  harmony: readonly ChordAtBeat[];
  /** The bass notes the performer set (spec 87). Their beats are marked in the strip, and each one shows its note once. */
  overrides?: readonly BassOverride[];
  /** The beat whose bass note is being edited, if any. */
  selected?: number | null;
  /** Makes each beat and chord label a button that picks that beat to edit. Without it the strip is only shown. */
  onSelect?(beat: number): void;
}

/**
 * A horizontal strip of the grid: one column per bar, one tick per beat, the downbeat drawn taller, and the chord name above the beat where
 * it changes. The bass note under a chord change shows where the bass differs from the chord, and a note the performer set shows its name
 * with a ring on its beats. It scrolls sideways for a long song, and uses the app's own tokens so it reads in light and dark themes.
 */
export function BandGrid({ grid, harmony, overrides = [], selected = null, onSelect }: BandGridProps) {
  if (grid.beats.length === 0) return <p className="text-sm text-silkscreen-3">No beats in the grid.</p>;
  const bars = barsOf(grid);
  const flats = usesFlats(harmony);
  const changeAt = (beat: number) => {
    const chord = harmony[beat]?.chord?.name ?? null;
    const before = beat > 0 ? (harmony[beat - 1]?.chord?.name ?? null) : null;
    return chord !== null && chord !== before ? chord : null;
  };
  // The bass note under a chord change, shown only when it is not the chord's root (a slash chord, a note from the original bass or a
  // note the performer set).
  const bassAt = (beat: number) => {
    const chord = harmony[beat]?.chord ?? null;
    return changeAt(beat) !== null && chord && chord.bass !== chord.root ? noteNameOf(chord.bass, flats) : null;
  };
  const overriddenAt = (beat: number) => bassOverrideAt(overrides, grid.beats[beat]);
  const startsOverride = (beat: number) => overriddenAt(beat) !== undefined && overriddenAt(beat - 1) !== overriddenAt(beat);
  const handle = (beat: number, label: string, className: string, content?: string) =>
    onSelect ? (
      <button
        type="button"
        key={beat}
        aria-label={label}
        aria-pressed={selected === beat}
        onClick={() => onSelect(beat)}
        className={`cursor-pointer rounded-sm p-0 ${className} ${selected === beat ? "ring-2 ring-silkscreen-1" : ""}`}
      >
        {content}
      </button>
    ) : null;
  return (
    <div role="list" aria-label="Beat grid" className="flex min-w-0 gap-2 overflow-x-auto pb-2 text-xs">
      {bars.map((bar, index) => (
        <div role="listitem" aria-label={`Bar ${index + 1}`} key={bar[0]} className="flex shrink-0 flex-col gap-1 border-l border-seam pl-1.5">
          <div className="flex h-4 items-end gap-1 whitespace-nowrap text-led-on">
            {bar.map((beat) => {
              const chord = changeAt(beat);
              if (!chord) return null;
              return onSelect ? (
                <button
                  key={beat}
                  type="button"
                  aria-label={`Edit the bass on beat ${beat + 1}, ${chord}`}
                  onClick={() => onSelect(beat)}
                  className="cursor-pointer"
                >
                  {chord}
                </button>
              ) : (
                <span key={beat}>{chord}</span>
              );
            })}
          </div>
          <div className="flex items-end gap-0.5">
            {bar.map((beat) => {
              const down = beat === bar[0] && (beat - grid.downbeat) % grid.beatsPerBar === 0;
              const height = down ? "h-8" : "h-4";
              const colour = overriddenAt(beat) ? "bg-seam ring-2 ring-led-on" : down ? "bg-led-on" : "bg-seam";
              const title = `Beat ${beat + 1} at ${grid.beats[beat].toFixed(2)} s`;
              return onSelect ? (
                handle(beat, `Beat ${beat + 1}, ${title}`, `h-8 w-1.5 ${height} ${colour}`)
              ) : (
                <span key={beat} title={title} className={`w-1.5 rounded-sm ${height} ${colour}`} />
              );
            })}
          </div>
          <div className="flex h-4 items-start gap-1 whitespace-nowrap text-silkscreen-3">
            {bar.map((beat) => {
              if (startsOverride(beat)) {
                const note = noteNameOf(overriddenAt(beat)!.pc, flats);
                return (
                  <span key={beat} title="Your bass note">
                    {note}
                  </span>
                );
              }
              const bass = bassAt(beat);
              return bass ? (
                <span key={beat} title="Bass note played under this chord">
                  {bass}
                </span>
              ) : null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
