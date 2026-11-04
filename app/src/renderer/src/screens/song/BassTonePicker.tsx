// The bass tone row of the Band settings: clean, or a capture with an optional cab IR and the gain and blend that go with them. Changing
// the tone saves it like any setting; Generate is what renders it. Bass tones need the desktop app (the TONE3000 browser and the file
// dialogs are there), so the web build shows the row disabled.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { isElectron } from "@/host";
import { BASS_TONE_INPUT_DB, BASS_TONE_OUTPUT_DB, type BassTone, type BassToneFile } from "@/song/band/arrangement";

import { BassSourceDialog, presetBassSearch, restoreBassSearch, type BassSourceKind } from "./BassSourceDialog";

/** The one capture and cab IR a chain is shown as (the first active capture and the first active cab), until the picker is rebuilt for chains. */
function singleStage(tone: Extract<BassTone, { kind: "chain" }>) {
  const capture = tone.blocks.find((block) => block.on && block.type === "capture");
  if (!capture) return null;
  const cab = tone.blocks.find((block) => block.on && block.type === "ir" && block.role === "cab");
  return { capture: capture.file, ir: cab?.file ?? null, inputDb: capture.inputDb, outputDb: capture.outputDb, blend: tone.dryWet };
}

/** The track of a band slider, as BandSettingsForm draws them: a lighter track keeps the full length visible at any value. */
const BAND_TRACK = "bg-white/15";

export interface BassTonePickerProps {
  tone: BassTone;
  onChange(tone: BassTone): void;
}

export function BassTonePicker({ tone, onChange }: BassTonePickerProps) {
  const [picking, setPicking] = useState<BassSourceKind | null>(null);
  const desktop = isElectron;
  const nam = tone.kind === "chain" ? singleStage(tone) : null;
  const summary = nam ? `${nam.capture.name}${nam.ir ? ` with ${nam.ir.name}` : ""}` : "Clean, as generated";

  const open = (kind: BassSourceKind) => {
    presetBassSearch(kind);
    setPicking(kind);
  };
  const close = () => {
    restoreBassSearch();
    setPicking(null);
  };
  /** Saves the one-stage view as a chain: the amp (or capture) block, then the cab. */
  const set = (next: NonNullable<typeof nam>) => {
    const amp = { type: "capture" as const, role: "amp" as const, file: next.capture, inputDb: next.inputDb, outputDb: next.outputDb, mix: 1, on: true };
    const cab = next.ir ? [{ type: "ir" as const, role: "cab" as const, file: next.ir, inputDb: 0, outputDb: 0, mix: 1, on: true }] : [];
    onChange({ kind: "chain", blocks: [amp, ...cab], dryWet: next.blend, fast: tone.kind === "chain" ? tone.fast : false });
  };
  const pick = (kind: BassSourceKind, file: BassToneFile) => {
    close();
    if (kind === "nam") set({ capture: file, ir: nam?.ir ?? null, inputDb: nam?.inputDb ?? 0, outputDb: nam?.outputDb ?? 0, blend: nam?.blend ?? 1 });
    else if (nam) set({ ...nam, ir: file });
  };

  return (
    <section aria-label="Bass tone" className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Bass tone</span>
        <span className="min-w-0 text-silkscreen-2">{summary}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!desktop} onClick={() => open("nam")}>
            {nam ? "Change capture…" : "Choose capture…"}
          </Button>
          {nam && (
            <Button variant="outline" size="sm" disabled={!desktop} onClick={() => open("ir")}>
              {nam.ir ? "Change cab IR…" : "Add cab IR…"}
            </Button>
          )}
          {nam?.ir && (
            <Button variant="ghost" size="sm" onClick={() => set({ ...nam, ir: null })}>
              No cab IR
            </Button>
          )}
          {nam && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ kind: "clean" })}>
              Clean bass
            </Button>
          )}
        </div>
      </div>
      {!desktop && <p className="text-silkscreen-3">Bass tones need the desktop app.</p>}
      {nam && (
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <label className="flex items-center gap-3">
            Drive {nam.inputDb} dB
            <Slider
              trackClassName={BAND_TRACK}
              aria-label="Bass tone drive"
              min={BASS_TONE_INPUT_DB[0]}
              max={BASS_TONE_INPUT_DB[1]}
              step={1}
              value={[nam.inputDb]}
              onValueChange={([db]) => set({ ...nam, inputDb: db })}
            />
          </label>
          <label className="flex items-center gap-3">
            Output {nam.outputDb} dB
            <Slider
              trackClassName={BAND_TRACK}
              aria-label="Bass tone output"
              min={BASS_TONE_OUTPUT_DB[0]}
              max={BASS_TONE_OUTPUT_DB[1]}
              step={1}
              value={[nam.outputDb]}
              onValueChange={([db]) => set({ ...nam, outputDb: db })}
            />
          </label>
          <label className="flex items-center gap-3">
            Blend {Math.round(nam.blend * 100)}% amp
            <Slider
              trackClassName={BAND_TRACK}
              aria-label="Bass tone blend"
              min={0}
              max={100}
              step={5}
              value={[Math.round(nam.blend * 100)]}
              onValueChange={([percent]) => set({ ...nam, blend: percent / 100 })}
            />
          </label>
        </div>
      )}
      {picking && <BassSourceDialog kind={picking} open onClose={close} onPick={(file) => pick(picking, file)} />}
    </section>
  );
}
