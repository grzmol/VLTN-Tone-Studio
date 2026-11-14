import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KEY_NAMES } from "@/song/performance/key";
import { octaveUp, noteName, parseSoloScale, scaleDef, scaleNotesOnNeck, scalePositions, SCALES } from "@/song/performance/scales";
import type { ScaleId, SoloScaleChoice } from "@/song/performance/scales";
import { readOptions, setSetting } from "@/song/performance/settings";
import { keyParts, keySpelling } from "@/song/performance/speed";
import { NeckDiagram } from "./NeckDiagram";

const field = "rounded border border-seam bg-transparent p-2";
const LABELS_KEY = "vltn.soloScale.labels";
const FROM_KEY = "key";
const WHOLE_NECK = "all";

type Labels = "fret" | "note";

function readLabels(): Labels {
  try {
    return localStorage.getItem(LABELS_KEY) === "note" ? "note" : "fret";
  } catch {
    return "fret";
  }
}

function saveLabels(labels: Labels): void {
  try {
    localStorage.setItem(LABELS_KEY, labels);
  } catch {
    /* The choice just is not remembered. */
  }
}

/**
 * Where to solo: the notes of a scale on the neck, for the song's key as it will be played. The default is the minor pentatonic. A major
 * key uses its relative minor, which has the same notes as the major pentatonic. The scale and root are saved with the song (`options.soloScale`);
 * the Frets/Notes choice is a preference of this computer.
 */
export function SoloScales({
  songKey,
  shift,
  capo,
  storageKey,
  onChange,
}: {
  /** The key the chord names are spelled by */
  songKey?: string;
  /** Semitones between the song's sounding key and the key shown: the chord names' shift, less the capo */
  shift: number;
  capo: number;
  /** The song's settings key */
  storageKey: string;
  /** Called after the choice is saved, so another view of the same panel can read it again */
  onChange?: () => void;
}) {
  const [choice, setChoice] = useState<SoloScaleChoice>(() => parseSoloScale(readOptions<Record<string, unknown>>(storageKey, {}).soloScale));
  const [position, setPosition] = useState(WHOLE_NECK);
  const [labels, setLabels] = useState<Labels>(readLabels);
  const [note, setNote] = useState("");
  const parts = keyParts(songKey ?? "");
  const flats = keySpelling(songKey, shift) ?? false;
  const scale: ScaleId = choice.scale ?? "minorPentatonic";
  const def = scaleDef(scale);
  const mod12 = (value: number) => ((value % 12) + 12) % 12;

  // "From the song key" is the key's own note. The one exception is the minor pentatonic in a major key, which starts on the relative minor.
  const relative = !!parts && !parts.minor && scale === "minorPentatonic" && choice.root === undefined;
  const soundingRoot = choice.root ?? (parts ? (relative ? mod12(parts.pitch + 9) : parts.pitch) : 0);
  const shownRoot = mod12(soundingRoot + shift);

  const notes = useMemo(() => scaleNotesOnNeck(shownRoot, scale), [shownRoot, scale]);
  const positions = useMemo(() => scalePositions(shownRoot, scale), [shownRoot, scale]);
  const chosen = positions.find((p) => String(p.number) === position);
  const highlight = chosen ? [chosen, octaveUp(chosen)].filter((p) => p !== null).map((p) => ({ fromFret: p.fromFret, toFret: p.toFret })) : undefined;

  const save = (next: SoloScaleChoice) => {
    setChoice(next);
    try {
      setSetting(storageKey, ":options", JSON.stringify({ ...readOptions(storageKey, {}), soloScale: next }));
      setNote("");
      onChange?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const chooseScale = (id: ScaleId) => {
    setPosition(WHOLE_NECK);
    save({ ...choice, scale: id });
  };
  const chooseRoot = (value: string) => {
    const { root: _unused, ...rest } = choice;
    save(value === FROM_KEY ? rest : { ...rest, root: Number(value) });
  };
  const chooseLabels = (value: Labels) => {
    setLabels(value);
    saveLabels(value);
  };

  if (!parts) {
    return (
      <div aria-label="Solo scale" className="rounded border border-seam p-3">
        <p className="text-sm text-silkscreen-3">Set the song's key to see the scale.</p>
      </div>
    );
  }

  const name = `${noteName(shownRoot, flats)} ${def.name.toLowerCase()}`;
  let caption = `${name}.`;
  if (relative) {
    caption = `${name}: the same notes as ${noteName(parts.pitch + shift, flats)} major pentatonic, the song's key.`;
  }
  if (capo > 0) caption += ` Frets are counted from the capo (capo ${capo}).`;
  const title = `${name}, ${chosen ? `position ${chosen.number}` : "whole neck"}`;

  return (
    <div aria-label="Solo scale" className="flex flex-col gap-3 rounded border border-seam p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          Scale
          <select className={field} value={scale} onChange={(e) => chooseScale(e.target.value as ScaleId)}>
            {SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Root
          <select className={field} value={choice.root === undefined ? FROM_KEY : String(choice.root)} onChange={(e) => chooseRoot(e.target.value)}>
            <option value={FROM_KEY}>From the song key</option>
            {KEY_NAMES.map((_, pc) => (
              <option key={pc} value={pc}>
                {noteName(pc + shift, flats)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Position
          <select className={field} value={chosen ? position : WHOLE_NECK} onChange={(e) => setPosition(e.target.value)}>
            <option value={WHOLE_NECK}>Whole neck</option>
            {positions.map((p) => (
              <option key={p.number} value={p.number}>
                Position {p.number}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Show
          <select className={field} value={labels} onChange={(e) => chooseLabels(e.target.value === "note" ? "note" : "fret")}>
            <option value="fret">Frets</option>
            <option value="note">Notes</option>
          </select>
        </label>
      </div>
      <p className="text-sm">{caption}</p>
      <NeckDiagram notes={notes} labels={labels} flats={flats} highlight={highlight} title={title} />
      <p className="text-xs text-silkscreen-3">Standard tuning E A D G B e.</p>
      {note && (
        <p role="status" className="text-sm text-silkscreen-3">
          {note}
        </p>
      )}
    </div>
  );
}

/** The solo scale panel in a dialog, for the Lyrics & chords reader. */
export function SoloScalesDialog({
  open,
  onClose,
  returnFocus,
  ...panel
}: { open: boolean; onClose: () => void; returnFocus?: () => void } & React.ComponentProps<typeof SoloScales>) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="z-[70] max-h-[85vh] overflow-y-auto sm:max-w-5xl"
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (returnFocus) {
            event.preventDefault();
            returnFocus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Solo scale</DialogTitle>
          <DialogDescription>Where to solo on the neck, for the key as you will play it.</DialogDescription>
        </DialogHeader>
        <SoloScales {...panel} />
      </DialogContent>
    </Dialog>
  );
}
