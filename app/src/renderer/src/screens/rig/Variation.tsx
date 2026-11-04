import { useRef, useState } from "react";
import { ShuffleIcon } from "lucide-react";
import { profileFor } from "@shared/devices";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notifyError } from "@/app/notify";
import { useDevice } from "@/state/device";
import { toPresetState } from "@/state/preset-codec";
import type { PresetState } from "@/state/device-types";
import { useLibrary } from "@/screens/library/store";
import { applyBlock, editBlock, recordBlock, snapshot } from "./edits";
import { morphed, randomized } from "./variation-params";

const AMOUNTS = [
  ["Subtle", 0.08],
  ["Medium", 0.2],
  ["Wild", 0.45],
] as const;

const dev = () => useDevice.getState();

/** Every block with a catalog model gets nudged; each block is one undo step. ponytail: one grouped step if undoing 10 blocks annoys. */
async function randomizePreset(amount: number) {
  const p = dev().preset;
  if (!p) return;
  for (const b of p.blocks) if (b.model) await editBlock("Randomize", { ...snapshot(b), params: randomized(b, amount) });
}

/** Shuffle button: Randomize at three strengths, and Morph toward another preset. */
export function VariationMenu({ preset, disabled }: { preset: PresetState; disabled: boolean }) {
  const [picker, setPicker] = useState(false);
  const [target, setTarget] = useState<PresetState | null>(null);
  const names = useDevice((s) => s.names);
  const bodies = useLibrary((s) => s.bodies);
  const profile = profileFor(preset.device);
  // Morph needs the other preset's body: slots seen in a backup or a read (same pedal family, not this slot).
  const candidates = names.filter((n) => n.slot !== preset.slot && bodies[n.slot]);

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Vary the sound" disabled={disabled}>
                <ShuffleIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Randomize or morph</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Randomize knobs</DropdownMenuLabel>
          {AMOUNTS.map(([label, amount]) => (
            <DropdownMenuItem key={label} onSelect={() => void randomizePreset(amount).catch((e) => notifyError("Couldn't randomize", e))}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!candidates.length} onSelect={() => setPicker(true)}>
            Morph toward another preset…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CommandDialog open={picker} onOpenChange={setPicker} title="Morph toward" description="Pick the preset to blend into this one">
        <CommandInput placeholder="Find a preset by number or name" />
        <CommandList className="max-h-[360px]">
          <CommandEmpty>No preset with a known sound matches</CommandEmpty>
          <CommandGroup heading="Presets this app has seen">
            {candidates.map((n) => (
              <CommandItem
                key={n.slot}
                value={`${profile.slotLabel(n.slot)} ${n.name}`}
                onSelect={() => {
                  setPicker(false);
                  try {
                    setTarget(toPresetState(n.slot, bodies[n.slot].prst, preset.device));
                  } catch (e) {
                    notifyError("Couldn't read that preset", e);
                  }
                }}
              >
                <span className="min-w-6 shrink-0 font-semibold whitespace-nowrap text-silkscreen-3 tabular-nums">{profile.slotLabel(n.slot)}</span>
                <span className="flex-1 truncate">{n.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      {target && <MorphDialog from={preset} to={target} onClose={() => setTarget(null)} />}
    </>
  );
}

/** Slider from this preset (0) to `to` (100); blocks with different models stay as they are. Keep records one undo step per block. */
function MorphDialog({ from, to, onClose }: { from: PresetState; to: PresetState; onClose(): void }) {
  const [amount, setAmount] = useState(0);
  // What each block looked like when the dialog opened: the blend starts from, and Cancel returns to, these.
  const startBlocks = useRef(from.blocks).current;
  const start = useRef(from.blocks.map(snapshot)).current;
  const blendable = startBlocks.filter((b) => to.blocks[b.index]?.fxid === b.fxid).length;

  const move = (pct: number) => {
    setAmount(pct);
    for (const b of startBlocks) {
      const other = to.blocks[b.index];
      const params = other && morphed(b, other, pct / 100);
      if (!params) continue;
      for (const p of b.model?.params ?? []) if (params[p.index] !== dev().preset?.blocks[b.index].params[p.index]) dev().setParam(b.index, p.index, params[p.index]);
    }
  };
  const cancel = () => {
    for (const s of start) void applyBlock(s).catch(() => {});
    onClose();
  };
  const keep = () => {
    for (const s of start) {
      const now = dev().preset?.blocks[s.index];
      if (now) recordBlock(`Morph toward ${to.name.trim()}`, s, snapshot(now));
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && cancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Morph toward {to.name.trim()}</DialogTitle>
          <DialogDescription>
            {blendable ? `${blendable} of ${startBlocks.length} blocks share a model and blend; the others stay as they are.` : "No block uses the same model in both presets, so nothing will change."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 py-2">
          <span className="text-sm text-silkscreen-3">This</span>
          <Slider aria-label="Morph amount" min={0} max={100} step={1} value={[amount]} onValueChange={([v]) => move(v)} disabled={!blendable} />
          <span className="text-sm text-silkscreen-3">{to.name.trim()}</span>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={keep} disabled={amount === 0}>
            Keep {amount}%
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
