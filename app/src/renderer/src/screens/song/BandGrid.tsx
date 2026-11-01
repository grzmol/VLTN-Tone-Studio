import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { NOTE_NAMES } from "@/song/analysis/chord-templates";

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

/**
 * A horizontal strip of the grid: one column per bar, one tick per beat, the downbeat drawn taller, and the chord name above the beat where
 * it changes. It scrolls sideways for a long song, and uses the app's own tokens so it reads in light and dark themes.
 */
export function BandGrid({ grid, harmony }: { grid: BeatGrid; harmony: readonly ChordAtBeat[] }) {
  if (grid.beats.length === 0) return <p className="text-sm text-silkscreen-3">No beats in the grid.</p>;
  const bars = barsOf(grid);
  const changeAt = (beat: number) => {
    const chord = harmony[beat]?.chord?.name ?? null;
    const before = beat > 0 ? (harmony[beat - 1]?.chord?.name ?? null) : null;
    return chord !== null && chord !== before ? chord : null;
  };
  // The bass note under a chord change, shown only when it is not the chord's root (a slash chord or a note from the original bass).
  const bassAt = (beat: number) => {
    const chord = harmony[beat]?.chord ?? null;
    return changeAt(beat) !== null && chord && chord.bass !== chord.root ? NOTE_NAMES[chord.bass] : null;
  };
  return (
    <div role="list" aria-label="Beat grid" className="flex min-w-0 gap-2 overflow-x-auto pb-2 text-xs">
      {bars.map((bar, index) => (
        <div role="listitem" aria-label={`Bar ${index + 1}`} key={bar[0]} className="flex shrink-0 flex-col gap-1 border-l border-seam pl-1.5">
          <div className="flex h-4 items-end gap-1 whitespace-nowrap text-led-on">
            {bar.map((beat) => {
              const chord = changeAt(beat);
              return chord ? <span key={beat}>{chord}</span> : null;
            })}
          </div>
          <div className="flex items-end gap-0.5">
            {bar.map((beat) => {
              const down = beat === bar[0] && (beat - grid.downbeat) % grid.beatsPerBar === 0;
              return (
                <span
                  key={beat}
                  title={`Beat ${beat + 1} at ${grid.beats[beat].toFixed(2)} s`}
                  className={`w-1.5 rounded-sm ${down ? "h-8 bg-led-on" : "h-4 bg-seam"}`}
                />
              );
            })}
          </div>
          <div className="flex h-4 items-start gap-1 whitespace-nowrap text-silkscreen-3">
            {bar.map((beat) => {
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
