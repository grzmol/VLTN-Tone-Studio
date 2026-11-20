import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/ui/settings-card";
import { drumsChip, isFallback, type DrumSource } from "@/song/band/drum-source";
import type { PartChoice } from "@/song/band/part-choice";

/** The pedal rhythm's transfer state for this song, or "none" when the song has no exported rhythm. */
export type TransferState = "Needs export" | "Needs transfer confirmation" | "Transfer confirmed";

export interface Rc10rSetupState {
  /** The song has automatic RC-10R cues. */
  hasCues: boolean;
  transfer: TransferState;
  /** Name of the connected MIDI output, or empty when none is connected. */
  outputName: string;
  /** Send cues is on. */
  armed: boolean;
  /** The song's drums choice and what plays from it. */
  choice: PartChoice;
  drums: DrumSource;
  fallbackWhy: string;
}

interface Line {
  id: string;
  ok: boolean;
  text: string;
  fixes?: { label: string; run(): void }[];
}

/** The one-line answer in the card header, worded like the drums chip. */
export function rc10rSummary({ choice, drums }: Pick<Rc10rSetupState, "choice" | "drums">): string {
  if (drums.plays === "pedal") return "Ready: the RC-10R plays drums";
  const name = drumsChip(choice, drums, "").text.replace("Drums: ", "").replace(" (fallback)", "").toLowerCase();
  return isFallback(choice, drums) ? `Not ready: playing ${name} drums (fallback)` : `Not ready: this song plays ${name} drums, not the RC-10R`;
}

/** Everything RC-10R in one place: a ready / not-ready checklist on top, the existing detailed controls under Details. */
export function Rc10rSetupCard({
  state,
  onChoosePedalDrums,
  onEnableMidi,
  onChooseOutput,
  onSendCues,
  children,
}: {
  state: Rc10rSetupState;
  onChoosePedalDrums(): void;
  onEnableMidi(): void;
  onChooseOutput(): void;
  onSendCues(): void;
  /** The existing advanced controls: cue builder, transfer confirmation. */
  children: ReactNode;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDetails = () => setDetailsOpen(true);
  const { hasCues, transfer, outputName, armed, choice, drums, fallbackWhy } = state;
  const lines: Line[] = [
    {
      id: "cues",
      ok: hasCues,
      text: hasCues ? "This song has RC-10R cues" : "This song has no RC-10R cues yet",
      fixes: hasCues ? undefined : [{ label: "Build cues…", run: openDetails }],
    },
    {
      id: "transfer",
      ok: transfer === "Transfer confirmed",
      text: transfer === "Transfer confirmed" ? "Rhythm transferred and confirmed on the pedal" : `Rhythm not confirmed on the pedal: ${transfer}`,
      fixes: transfer === "Transfer confirmed" ? undefined : [{ label: "Confirm transfer…", run: openDetails }],
    },
    {
      id: "output",
      ok: !!outputName,
      text: outputName ? `MIDI output connected: ${outputName}` : "No MIDI output connected",
      fixes: outputName
        ? undefined
        : [
            { label: "Choose output", run: onChooseOutput },
            { label: "Enable system MIDI", run: onEnableMidi },
          ],
    },
    {
      id: "send",
      ok: armed,
      text: armed ? "Send cues is on" : "Send cues is off",
      fixes: armed ? undefined : [{ label: "Turn on Send cues", run: onSendCues }],
    },
    {
      id: "drums",
      ok: choice === "pedal",
      text: choice === "pedal" ? "What plays → Drums is RC-10R pedal" : "What plays → Drums is not the RC-10R pedal",
      fixes: choice === "pedal" ? undefined : [{ label: "Use pedal drums for this song", run: onChoosePedalDrums }],
    },
  ];
  const summary = rc10rSummary({ choice, drums });
  return (
    <SettingsCard title="RC-10R drums" summary={summary} storageKey="rc10r-setup">
      <div className="space-y-3 text-sm">
        <p role="status" className={drums.plays === "pedal" ? "text-led-on" : "text-led-warn"}>
          {summary}
          {drums.plays !== "pedal" && fallbackWhy ? ` (${fallbackWhy})` : ""}
        </p>
        <ul aria-label="RC-10R checklist" className="space-y-1">
          {lines.map((line) => (
            <li key={line.id} data-line={line.id} data-ok={line.ok} className="flex flex-wrap items-center gap-2">
              <span aria-hidden className={line.ok ? "text-led-on" : "text-led-warn"}>
                {line.ok ? "✓" : "✗"}
              </span>
              <span className="sr-only">{line.ok ? "Done:" : "Needs attention:"}</span>
              <span>{line.text}</span>
              {line.fixes?.map((fix) => (
                <Button key={fix.label} variant="outline" size="sm" onClick={fix.run}>
                  {fix.label}
                </Button>
              ))}
            </li>
          ))}
        </ul>
        <details open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer font-medium">Details</summary>
          <div className="space-y-3 pt-3">{children}</div>
        </details>
      </div>
    </SettingsCard>
  );
}
