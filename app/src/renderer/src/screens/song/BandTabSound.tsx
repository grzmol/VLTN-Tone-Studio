import { RENDERED_KINDS, type BandSettings, type RenderedKind } from "@/song/band/arrangement";
import type { PartChoices, PartKeys } from "@/song/band/part-choice";
import { PartChoiceRows } from "./PartChoiceRows";
import { PartToneChain } from "./PartToneChain";
import { RenderedPartRow, type PendingLineUp } from "./RenderedPartRow";

/** The Sound tab: what plays (original, generated or both), the performer's rendered parts, and the drum and bass tone chains. */
export function BandTabSound({
  settings,
  onChange,
  hasSong,
  partChoices,
  partKeys,
  generatedNotes,
  onPartChoice,
  busy,
  blocked,
  pendingLineUp,
  onFile,
  onBack,
  songSeconds,
}: {
  settings: BandSettings;
  onChange(patch: Partial<BandSettings>): void;
  /** False with no song loaded: there is nothing to choose between or to render then. */
  hasSong: boolean;
  partChoices: PartChoices;
  partKeys: PartKeys;
  /** What each generated part says about itself: "Generated · clean (tone missing)" where its tone files were missing. */
  generatedNotes?: Partial<Record<"drums" | "bass", string>>;
  onPartChoice(patch: Partial<PartChoices>): void;
  busy: boolean;
  blocked: boolean;
  pendingLineUp(kind: RenderedKind): PendingLineUp | null;
  onFile(kind: RenderedKind, file: File): void;
  onBack(kind: RenderedKind): void;
  songSeconds: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      {hasSong && <PartChoiceRows choices={partChoices} keys={partKeys} notes={generatedNotes} disabled={busy} onChange={onPartChoice} />}
      {hasSong && (
        <section aria-label="Rendered parts" className="flex flex-col gap-3">
          {RENDERED_KINDS.map((kind) => (
            <RenderedPartRow
              key={kind}
              kind={kind}
              rendered={settings.rendered[kind]}
              disabled={blocked}
              pending={pendingLineUp(kind)}
              onFile={(file) => onFile(kind, file)}
              onBack={() => onBack(kind)}
            />
          ))}
        </section>
      )}
      <section aria-label="Tone chains" className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <PartToneChain part="drums" tone={settings.drumTone} songSeconds={songSeconds} onChange={(drumTone) => onChange({ drumTone })} />
        <PartToneChain part="bass" tone={settings.bassTone} songSeconds={songSeconds} onChange={(bassTone) => onChange({ bassTone })} />
      </section>
      <p className="text-silkscreen-3">Render it with your own instruments, then use it here.</p>
    </div>
  );
}
