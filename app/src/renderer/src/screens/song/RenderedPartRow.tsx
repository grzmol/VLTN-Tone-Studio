// One part's rendered-audio row in the Band panel (spec 84): the button that brings in the performer's own bounce, the file it uses, and
// Back to generated. A file whose first hit is off the first note waits here for the line-up choice, which is never made silently.
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { lineUpLabel } from "@/song/band/rendered";
import type { RenderedKind, RenderedPart } from "@/song/band/arrangement";
import { AUDIO_ACCEPT } from "@/song/decode";

export interface PendingLineUp {
  /** What the gap is, for example "The first hit is 300 ms after the first note." */
  text: string;
  /** How far the file moves to line up, in seconds. Negative moves it earlier. */
  shiftSeconds: number;
  onLineUp(): void;
  onUseAsIs(): void;
}

export interface RenderedPartRowProps {
  kind: RenderedKind;
  /** The rendered audio the part uses, or undefined while the part is the generated one. */
  rendered: RenderedPart | undefined;
  /** True while playing, while busy, and with no song: every action waits. */
  disabled: boolean;
  pending: PendingLineUp | null;
  onFile(file: File): void;
  onBack(): void;
}

export function RenderedPartRow({ kind, rendered, disabled, pending, onFile, onBack }: RenderedPartRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const label = kind === "drums" ? "drums" : "bass";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-silkscreen-2">
          {rendered
            ? `Using your rendered ${label}: ${rendered.name}`
            : `Your own ${label}, rendered outside the app, can take the place of the generated one.`}
        </span>
        <input
          ref={input}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
          Use my rendered {label}…
        </Button>
        {rendered && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={onBack}>
            Back to generated
          </Button>
        )}
      </div>
      {pending && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-seam px-3 py-2">
          <span className="min-w-0 flex-1">{pending.text}</span>
          <Button size="sm" onClick={pending.onLineUp}>
            {lineUpLabel(pending.shiftSeconds)}
          </Button>
          <Button variant="outline" size="sm" onClick={pending.onUseAsIs}>
            Use as it is
          </Button>
        </div>
      )}
    </div>
  );
}
