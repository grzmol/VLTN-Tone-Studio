import { useState } from "react";
import { profileFor } from "@shared/devices";
import { CheckIcon, ChevronDownIcon, EllipsisIcon, GitCompareArrowsIcon, Redo2Icon, SaveIcon, Undo2Icon, XIcon } from "lucide-react";
import { keyLabel } from "@/app/keys";
import { notifyError, notifySuccess, notifyWriteDone } from "@/app/notify";
import { ConfirmWriteDialog } from "@/components/write/ConfirmWriteDialog";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { host } from "@/host";
import { useDevice, usePedalName } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { slotNameError } from "@/state/device-model";
import { useCommand } from "@/state/ui";
import { playPreset, redo, undo } from "./edits";
import { ExpControl } from "./ExpControl";
import { FootswitchControl } from "./FootswitchControl";
import { PatchPanel } from "./PatchPanel";
import { TempoControl } from "./TempoControl";
import { Tuner } from "./Tuner";
import { VariationMenu } from "./Variation";
import { useHistory } from "./history";
import { useRig } from "./rig-store";

interface Props {
  preset: PresetState;
  connected: boolean;
}

/**
 * Preset name, unsaved count, tempo, footswitches (CTRL), EXP (GP-50) or patch settings (GP-200 family); undo/redo,
 * Compare with saved, Discard, Save split button.
 */
export function RigHeader({ preset, connected }: Props) {
  const saved = useDevice((s) => s.saved);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const busy = useDevice((s) => s.busy);
  const stale = useDevice((s) => s.stale);
  const names = useDevice((s) => s.names);
  const pedal = usePedalName();
  const profile = profileFor(preset.device);
  const canUndo = useHistory((s) => s.past.length > 0);
  const canRedo = useHistory((s) => s.future.length > 0);
  const compare = useRig((s) => s.compare);
  const comparing = useRig((s) => s.comparing);
  const [target, setTarget] = useState<number | null>(null);
  const [slotPicker, setSlotPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const live = connected && !busy;
  const editable = live && !compare && !comparing;
  const shownChanges = compare ? compare.changes : unsaved;

  const toggleCompare = async () => {
    const rig = useRig.getState();
    const d = useDevice.getState();
    if (rig.comparing || !d.preset || !d.saved) return;
    useRig.setState({ comparing: true });
    try {
      if (rig.compare) {
        await playPreset(rig.compare.edited);
        useRig.setState({ compare: null });
      } else {
        useRig.setState({ compare: { edited: d.preset, changes: d.unsavedChanges } });
        await playPreset(d.saved);
      }
    } catch (e) {
      notifyError("Couldn't compare with the saved preset", e);
    } finally {
      useRig.setState({ comparing: false });
    }
  };

  const discard = async () => {
    try {
      useRig.setState({ compare: null });
      await useDevice.getState().discard();
      useHistory.getState().clear();
    } catch (e) {
      notifyError("Couldn't discard the changes", e, discard);
    }
  };

  const exportPrst = async () => {
    try {
      const where = await host.files.exportPresets([{ fileName: `${profile.slotLabel(preset.slot)}-${preset.name.trim() || "Preset"}.prst`, prst: preset.prst }]);
      if (where) notifySuccess(`Exported ${preset.name}`, where);
    } catch (e) {
      notifyError("Couldn't export the preset", e);
    }
  };

  const saveTarget = (slot: number) => {
    if (!editable) return;
    setTarget(slot);
  };

  // Registered whenever the Rig can act (not only when there is something to do): an unhandled command is
  // queued by the shell and would fire later.
  useCommand("undo", () => void undo(), editable);
  useCommand("redo", () => void redo(), editable);
  useCommand("compare-with-saved", () => void ((useDevice.getState().unsavedChanges > 0 || useRig.getState().compare) && toggleCompare()), live);
  useCommand("discard-changes", () => void ((useDevice.getState().unsavedChanges > 0 || useRig.getState().compare) && discard()), live);
  useCommand("save-to-slot", () => saveTarget(preset.slot), editable);
  useCommand("rename-slot", () => setRenaming(true), editable);

  const writeTitle =
    target === null
      ? ""
      : target === preset.slot
        ? `Overwrite ${saved?.name ?? preset.name} in slot ${profile.slotLabel(target)}?`
        : `Write ${preset.name} to slot ${profile.slotLabel(target)}?`;
  const replacingName = target === null ? "" : target === preset.slot ? (saved?.name ?? preset.name) : (names[target]?.name ?? "");

  return (
    <div className="flex items-center gap-6 px-7 pt-4 pb-3 max-[1320px]:gap-4 [@media(max-height:820px)]:pt-2.5 [@media(max-height:820px)]:pb-2">
      <div className="min-w-0">
        {renaming ? (
          <RenameField preset={preset} onDone={() => setRenaming(false)} />
        ) : (
          <h1
            className={cn("m-0 truncate text-[32px] leading-[1.05] font-bold tracking-[-0.02em]", !connected && "text-silkscreen-2")}
            onDoubleClick={() => editable && setRenaming(true)}
          >
            <span className="mr-3 font-semibold text-silkscreen-4">{profile.slotLabel(preset.slot)}</span>
            {preset.name}
          </h1>
        )}
        <div className="mt-2 flex items-center gap-[18px] text-sm whitespace-nowrap text-silkscreen-3 max-[1320px]:gap-3.5">
          {shownChanges > 0 ? (
            <span className="flex items-center gap-1.5 font-semibold text-silkscreen">
              <span className="size-1.5 rounded-full bg-led-warn" aria-hidden />
              {shownChanges === 1 ? "1 unsaved change" : `${shownChanges} unsaved changes`}
              {compare && <span className="font-normal text-silkscreen-3">· playing the saved version</span>}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-silkscreen-4" aria-hidden />
              No unsaved changes
            </span>
          )}
          {stale && <span className="font-semibold text-led-warn">Preset changed on the pedal during playback. It will refresh when the song stops.</span>}
          <TempoControl bpm={preset.bpm} range={profile.tempo} disabled={!editable} />
          <FootswitchControl preset={preset} disabled={!editable} />
          {preset.exp && <ExpControl preset={preset} exp={preset.exp} disabled={!editable} />}
          {preset.gp200 && <PatchPanel preset={preset} fields={preset.gp200} disabled={!editable} />}
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <IconTip label="Undo" keys={["Mod", "Z"]}>
          <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!editable || !canUndo} onClick={() => void undo()}>
            <Undo2Icon aria-hidden />
          </Button>
        </IconTip>
        <IconTip label="Redo" keys={["Mod", "Shift", "Z"]}>
          <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!editable || !canRedo} onClick={() => void redo()}>
            <Redo2Icon aria-hidden />
          </Button>
        </IconTip>
        <Tuner />
        <VariationMenu preset={preset} disabled={!editable} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              aria-label="Compare with saved"
              aria-pressed={!!compare}
              disabled={!live || comparing || (!compare && unsaved === 0)}
              onClick={() => void toggleCompare()}
              className={cn("max-[1320px]:w-[34px] max-[1320px]:px-0", compare && "bg-silkscreen text-lamp-ink hover:bg-silkscreen/90")}
            >
              <GitCompareArrowsIcon aria-hidden />
              <span className="max-[1320px]:hidden">{compare ? "Back to your edits" : "Compare with saved"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="min-[1321px]:hidden">{compare ? "Back to your edits" : "Compare with saved"}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" className="max-[1320px]:hidden" disabled={!live || (unsaved === 0 && !compare)} onClick={() => void discard()}>
          Discard
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions" className="min-[1321px]:hidden">
              <EllipsisIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!live || (unsaved === 0 && !compare)} onSelect={() => void discard()}>
              Discard changes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={connected ? -1 : 0}>
                <Button disabled={!editable} onClick={() => saveTarget(preset.slot)} className="rounded-r-none pr-3">
                  <SaveIcon aria-hidden />
                  {busy?.kind === "write" ? `Writing ${Math.round(busy.progress * 100)}%` : `Save to slot ${profile.slotLabel(preset.slot)}`}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{!connected ? `Connect the ${pedal} to save` : compare ? "Go back to your edits to save" : keyLabel(["Mod", "S"])}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="More save options" className="rounded-l-none border-l border-black/15 px-2.5">
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={!editable} onSelect={() => saveTarget(preset.slot)}>
                Save to slot {profile.slotLabel(preset.slot)}
                <DropdownMenuShortcut>{keyLabel(["Mod", "S"])}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => setSlotPicker(true)}>
                Save to another slot…
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!editable} onSelect={() => setRenaming(true)}>
                Rename on pedal…
                <DropdownMenuShortcut>F2</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void exportPrst()}>Export .prst…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CommandDialog open={slotPicker} onOpenChange={setSlotPicker} title="Save to another slot" description="Pick the slot to write this preset to">
        <CommandInput placeholder="Find a slot by number or name" />
        <CommandList className="max-h-[360px]">
          <CommandEmpty>No slot matches</CommandEmpty>
          <CommandGroup heading={`${pedal} slots`}>
            {names.map((n) => (
              <CommandItem
                key={n.slot}
                value={`${profile.slotLabel(n.slot)} ${n.name}`}
                disabled={n.slot === preset.slot}
                onSelect={() => {
                  setSlotPicker(false);
                  saveTarget(n.slot);
                }}
              >
                <span className="min-w-6 shrink-0 font-semibold whitespace-nowrap text-silkscreen-3 tabular-nums">{profile.slotLabel(n.slot)}</span>
                <span className="flex-1 truncate">{n.name}</span>
                {n.slot === preset.slot && <span className="text-xs text-silkscreen-3">This preset</span>}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {target !== null && (
        <ConfirmWriteDialog
          open
          onOpenChange={(o) => !o && setTarget(null)}
          title={writeTitle}
          slot={target}
          replacing={replacingName.trim() ? { name: replacingName, detail: target === preset.slot ? `Saved version of ${replacingName}` : undefined } : null}
          incoming={{ name: preset.name, detail: unsaved > 0 ? `As edited now, including ${unsaved === 1 ? "1 unsaved change" : `${unsaved} unsaved changes`}` : "As shown on the Rig", prst: preset.prst }}
          action={`Write to slot ${profile.slotLabel(target)}`}
          onConfirm={async ({ backupFirst }) => {
            const slot = target;
            await useDevice.getState().saveToSlot(slot);
            useHistory.getState().clear();
            notifyWriteDone({ name: preset.name, slot, backedUp: backupFirst });
          }}
        />
      )}
    </div>
  );
}

function IconTip({ label, keys, children }: { label: string; keys: string[]; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-silkscreen-3">{keyLabel(keys)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Inline rename with a character counter (the model's name length); commits on the pedal immediately. */
function RenameField({ preset, onDone }: { preset: PresetState; onDone(): void }) {
  const [value, setValue] = useState(preset.name.trimEnd());
  const [busy, setBusy] = useState(false);
  const pedal = usePedalName();
  const profile = profileFor(preset.device);
  const nameLength = profile.nameLength;
  const trimmed = value.trimEnd();
  const error = slotNameError(value, pedal);
  const atLimit = value.length >= nameLength;
  const slot = preset.slot;
  const before = preset.name;

  const commit = async () => {
    if (error || busy) return;
    if (trimmed === before.trimEnd()) return onDone();
    setBusy(true);
    try {
      await useDevice.getState().rename(slot, trimmed);
      notifySuccess(`Slot ${profile.slotLabel(slot)} renamed to ${trimmed}`, undefined, {
        label: "Undo",
        run: () => useDevice.getState().rename(slot, before.trimEnd()),
      });
      onDone();
    } catch (e) {
      notifyError(`Couldn't rename slot ${profile.slotLabel(slot)}`, e);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[32px] leading-[1.05] font-semibold text-silkscreen-4">{profile.slotLabel(slot)}</span>
        <input
          autoFocus
          aria-label={`Name of slot ${profile.slotLabel(slot)}`}
          aria-invalid={!!error}
          value={value}
          maxLength={nameLength}
          disabled={busy}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") void commit();
            if (e.key === "Escape") onDone();
          }}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) onDone();
          }}
          className={cn(
            "h-10 max-w-[40vw] rounded-sm bg-well px-3 text-[26px] font-bold text-silkscreen shadow-[inset_0_0_0_1px_var(--glass-edge)] outline-none focus-visible:shadow-[inset_0_0_0_1.5px_var(--silkscreen)]",
            error && "shadow-[inset_0_0_0_1.5px_var(--led-fault)] focus-visible:shadow-[inset_0_0_0_1.5px_var(--led-fault)]",
          )}
          // room for the longest name in wide letters (W ≈ 1.05em at this weight) plus the padding
          style={{ width: `calc(${nameLength * 1.1}em + 24px)` }}
        />
        <span className={cn("text-xs tabular-nums", atLimit ? "text-led-warn" : "text-silkscreen-3")}>
          {value.length}/{nameLength}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Rename on pedal" disabled={!!error || busy} onClick={() => void commit()}>
          <CheckIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Cancel rename" onClick={onDone}>
          <XIcon aria-hidden />
        </Button>
      </div>
      <span role={error ? "alert" : undefined} className={cn("text-xs", error ? "text-led-fault" : "text-led-warn")}>
        {error ?? (atLimit ? `The ${pedal} stores ${nameLength} characters. Further typing is ignored.` : "")}
      </span>
    </div>
  );
}
