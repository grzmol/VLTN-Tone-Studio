import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ArrowDownToLineIcon, CheckIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { usePedalName, useDevice, useProfile } from "@/state/device";
import { acksFrames, writeFrameCount } from "@/state/device-model";
import { cn } from "@/lib/utils";
import { MiniChain } from "./MiniChain";
import { summarize } from "./preset-summary";
import { backUpSlot, describeError, resolveBackupSource, type BackupSource } from "./write-helpers";

export interface ConfirmWriteDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** "Write Puppy to slot 64?" / "Replace Shatte-GT1 in slot 63?" */
  title: string;
  slot: number;
  /** What is in the slot now; null when the slot is empty (no backup needed) */
  replacing: { name: string; detail?: string } | null;
  /** What gets written, already prepared for the connected pedal (MiniChain and frame count come from `prst`) */
  incoming: { name: string; detail?: string; prst: Uint8Array };
  /** Action button label, e.g. "Write to slot 64" */
  action: string;
  /** Overrides the default description */
  description?: ReactNode;
  /** Extra facts or warnings under the facts block (e.g. GP-50 conversion) */
  notes?: ReactNode;
  /**
   * Runs the write. When `backupFirst` is true the dialog has already saved the slot's current preset to the
   * "Replaced presets" collection. Throwing keeps the dialog open with the error; resolving closes it.
   */
  onConfirm(opts: { backupFirst: boolean }): Promise<void>;
}

type Phase = "confirm" | "backup" | "write";

/** The one write confirmation: facts, optional backup, progress, errors in place. */
export function ConfirmWriteDialog({ open, onOpenChange, title, slot, replacing, incoming, action, description, notes, onConfirm }: ConfirmWriteDialogProps) {
  const [backupFirst, setBackupFirst] = useState(true);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [error, setError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState<string | null>(null);
  const [source, setSource] = useState<BackupSource | null>(null);
  const busy = useDevice((s) => s.busy);
  const connected = useDevice((s) => s.status === "connected");
  const pedal = usePedalName();
  const label = useProfile().slotLabel(slot);
  const frameTotal = useMemo(() => writeFrameCount(incoming.prst), [incoming.prst]);
  // The GP-200 family sends no ACKs: only the frames sent are known until the read-back
  const acked = useDevice((s) => s.device === null || acksFrames(s.device));
  const checkboxId = useId();
  const running = phase !== "confirm";

  useEffect(() => {
    if (!open) return;
    setPhase("confirm");
    setError(null);
    setBackedUp(null);
    setSource(null);
    let live = true;
    void host.app.getSettings().then((s) => live && setBackupFirst(s.backupBeforeWrite), () => {});
    if (replacing) void resolveBackupSource(slot).then((s) => live && setSource(s), () => {});
    return () => {
      live = false;
    };
    // Resolve once per opening; the slot and its contents don't change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canBackUp = replacing !== null && source?.kind !== "none";
  const doBackup = canBackUp && backupFirst;
  const backupDate = source?.kind === "backup" ? new Date(source.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  const backupHint =
    source?.kind === "none"
      ? source.reason
      : source?.kind === "backup"
        ? `Saves the copy from the backup of ${backupDate} to Replaced presets (reading the slot now would drop your unsaved changes)`
        : "Saves it to Replaced presets on this computer";
  const chain = incoming.prst ? summarize(incoming.prst) : null;

  const changeBackup = (on: boolean) => {
    setBackupFirst(on);
    // The choice is remembered for the next write.
    void host.app.setSettings({ backupBeforeWrite: on }).catch(() => {});
  };

  const confirm = async () => {
    setError(null);
    try {
      if (doBackup && !backedUp) {
        setPhase("backup");
        const saved = await backUpSlot(slot, source ?? undefined);
        setBackedUp(saved.fileName);
      }
      setPhase("write");
      await onConfirm({ backupFirst: doBackup });
      onOpenChange(false);
    } catch (e) {
      setError(describeError(e, slot));
      setPhase("confirm");
    }
  };

  const writeFraction = busy?.kind === "write" ? busy.progress : 0;
  const pct = phase === "backup" ? 6 : phase === "write" ? (doBackup ? 15 : 0) + writeFraction * (doBackup ? 70 : 85) : 0;
  const frames = Math.round(writeFraction * frameTotal);
  const verifying = phase === "write" && writeFraction >= 1;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <AlertDialogContent className="max-w-[480px] gap-4" onEscapeKeyDown={(e) => running && e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{running ? `Writing ${incoming.name} to slot ${label}` : title}</AlertDialogTitle>
          <AlertDialogDescription className="text-pretty">
            {running
              ? `Keep the ${pedal} connected until the check finishes.`
              : (description ??
                `The ${pedal} stores the preset in slot ${label}. Tone Studio reads the slot back afterwards to check that every byte arrived.${replacing ? " The pedal has no undo." : ""}`)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {running ? (
          <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2 text-sm">
              {doBackup && (
                <Step n={1} state={phase === "backup" ? "run" : "done"} label={phase === "backup" ? `Backing up slot ${label}` : `Backed up slot ${label}`} detail={backedUp ?? "Reading it from the pedal"} />
              )}
              <Step
                n={doBackup ? 2 : 1}
                state={phase === "backup" ? "todo" : verifying ? "done" : "run"}
                label={verifying ? "Sent the preset" : "Sending the preset"}
                detail={`${frames} of ${frameTotal} frames ${acked ? "acknowledged" : "sent"}`}
              />
              <Step n={doBackup ? 3 : 2} state={verifying ? "run" : "todo"} label="Verifying" detail={`Reading slot ${label} back`} />
            </ol>
            <Progress value={verifying ? 92 : pct} aria-label="Write progress" />
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg bg-well px-3.5 py-3 text-sm">
              <dt className="text-silkscreen-3">Preset</dt>
              <dd className="flex min-w-0 items-center gap-2 text-silkscreen">
                <span className="truncate font-semibold">{incoming.name}</span>
                {chain && <MiniChain chain={chain} />}
              </dd>
              {incoming.detail && (
                <>
                  <dt className="text-silkscreen-3">From</dt>
                  <dd className="min-w-0 text-silkscreen">{incoming.detail}</dd>
                </>
              )}
              <dt className="text-silkscreen-3">Slot {label} now</dt>
              <dd className="min-w-0 text-silkscreen">
                {replacing ? (
                  <>
                    <span className="font-semibold">{replacing.name}</span>
                    {replacing.detail && <span className="text-silkscreen-3">, {replacing.detail}</span>}
                  </>
                ) : (
                  "Empty, nothing is replaced"
                )}
              </dd>
            </dl>
            {notes}
            <div className="flex items-start gap-2.5 text-sm">
              <Checkbox
                id={checkboxId}
                className="mt-0.5"
                checked={canBackUp ? backupFirst : false}
                disabled={!canBackUp}
                onCheckedChange={(v) => changeBackup(v === true)}
              />
              <Label htmlFor={checkboxId} className={cn("flex flex-col items-start gap-0.5 font-normal", canBackUp ? "text-silkscreen" : "text-silkscreen-3")}>
                <span>
                  Back up slot {label} first{!replacing && " (not needed, the slot is empty)"}
                </span>
                {replacing && <span className="text-xs text-pretty text-silkscreen-3">{backupHint}</span>}
                {source?.kind === "backup" && source.stale && (
                  <span className="text-xs text-pretty text-led-fault">This copy is from {backupDate} and may be older than what's on the pedal.</span>
                )}
              </Label>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-led-fault">
            {error}
          </p>
        )}

        <AlertDialogFooter className="items-center">
          {running ? (
            <>
              <span className="mr-auto text-xs text-silkscreen-3">A write can't be stopped once frames are sent.</span>
              <Button disabled>
                <Spinner data-icon="inline-start" />
                Writing
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
              <Button variant={replacing ? "destructive" : "default"} disabled={!connected} onClick={() => void confirm()}>
                <ArrowDownToLineIcon data-icon="inline-start" />
                {error ? "Retry" : action}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Step({ n, state, label, detail }: { n: number; state: "done" | "run" | "todo"; label: string; detail: string }) {
  return (
    <li className={cn("grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5", state === "todo" && "text-silkscreen-3")}>
      <span
        aria-hidden
        className={cn(
          "mt-px grid size-5 place-items-center rounded-full text-xs font-semibold",
          state === "done" ? "bg-silkscreen-2 text-lamp-ink" : "shadow-[inset_0_0_0_1.5px_var(--seam-strong)]",
          state === "run" && "shadow-[inset_0_0_0_1.5px_var(--lamp)]",
        )}
      >
        {state === "done" ? <CheckIcon className="size-3" strokeWidth={3} /> : n}
      </span>
      <span className="flex flex-col">
        <span className={cn("font-medium", state !== "todo" && "text-silkscreen")}>{label}</span>
        <span className="text-xs text-silkscreen-3">{detail}</span>
        <span className="sr-only">{state === "done" ? "done" : state === "run" ? "in progress" : "waiting"}</span>
      </span>
    </li>
  );
}
