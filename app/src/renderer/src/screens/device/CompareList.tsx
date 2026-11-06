import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toPresetState } from "@/state/preset-codec";
import { diffPresets, type ChangeRow } from "@/state/unsaved-diff";
import type { BackupEntry } from "@/state/device-types";
import type { DeviceKey } from "@shared/devices";
import type { SlotComparison, SlotState } from "./compare";

const GROUPS: { state: SlotState; title: string; hint: string }[] = [
  { state: "changed", title: "Changed", hint: "Same preset name, different settings" },
  { state: "different", title: "Different preset", hint: "Another preset is in this slot" },
  { state: "empty", title: "Empty on one side", hint: "One of them has no preset" },
  { state: "same", title: "Same", hint: "Identical, nothing to write" },
];

/** Block-level differences between the pedal's preset and the backup's, or null when the bytes can't be read. */
function blockRows(slot: number, pedal: BackupEntry | undefined, backup: BackupEntry | undefined, device: DeviceKey): ChangeRow[] | null {
  if (!pedal || !backup) return null;
  try {
    return diffPresets(toPresetState(slot, pedal.prst, device), toPresetState(slot, backup.prst, device));
  } catch {
    return null;
  }
}

/** The pedal's preset and the backup's, block by block, for a slot whose name is the same. */
function ChangedDetail({ slot, pedal, backup, device }: { slot: number; pedal: BackupEntry | undefined; backup: BackupEntry | undefined; device: DeviceKey }) {
  const rows = useMemo(() => blockRows(slot, pedal, backup, device), [slot, pedal, backup, device]);
  if (!rows) return <p className="text-sm text-silkscreen-3">The app can't read this preset, so only the bytes differ.</p>;
  if (!rows.length) return <p className="text-sm text-silkscreen-3">The settings match. Only bytes the pedal doesn't show differ.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Changed settings">
      <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs text-silkscreen-3">
        <span>Setting</span>
        <span>On pedal</span>
        <span>In backup</span>
      </li>
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-silkscreen-2">
          <span className="truncate">
            {r.block ? `${r.block.code} · ` : ""}
            {r.parameter}
          </span>
          <span className="truncate">{r.saved || "—"}</span>
          <span className="truncate">{r.now || "—"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Slots grouped by how they compare with the pedal: Changed (expandable to the block-level diff), Different preset,
 * Empty on one side, Same. `source` is the backup's entries, `pedal` what the pedal holds now.
 */
export function CompareList({
  rows,
  source,
  pedal,
  device,
  slotLabel,
}: {
  rows: SlotComparison[];
  source: BackupEntry[];
  pedal: BackupEntry[];
  device: DeviceKey;
  slotLabel: (slot: number) => string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const pedalBySlot = new Map(pedal.map((e) => [e.slot, e]));
  const sourceBySlot = new Map(source.map((e) => [e.slot, e]));

  return (
    <div className="flex max-h-[260px] flex-col gap-3 overflow-auto rounded-lg bg-well px-3.5 py-3 text-sm" aria-label="Compare with the pedal">
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.state === g.state);
        if (!list.length) return null;
        return (
          <section key={g.state} className="flex flex-col gap-1">
            <h3 className="font-semibold text-silkscreen">
              {g.title} <span className="font-normal text-silkscreen-3">({list.length})</span>
            </h3>
            <p className="text-xs text-silkscreen-3">{g.hint}</p>
            <ul className="flex flex-col">
              {list.map((r) => {
                const expandable = g.state === "changed";
                const expanded = open === r.slot;
                return (
                  <li key={r.slot}>
                    <button
                      type="button"
                      disabled={!expandable}
                      aria-expanded={expandable ? expanded : undefined}
                      onClick={() => setOpen(expanded ? null : r.slot)}
                      className={cn("grid w-full grid-cols-[72px_minmax(0,1fr)] items-center gap-2 rounded-sm py-0.5 text-left", expandable && "hover:bg-accent")}
                    >
                      <span className="flex items-center gap-1 text-silkscreen-3 tabular-nums">
                        {expandable && <ChevronRight className={cn("size-3.5 transition-transform", expanded && "rotate-90")} aria-hidden />}
                        {slotLabel(r.slot)}
                      </span>
                      <span className="truncate text-silkscreen">
                        {r.name || "Untitled"}
                        {r.state === "different" && r.pedalName && <span className="text-silkscreen-3"> (pedal: {r.pedalName})</span>}
                      </span>
                    </button>
                    {expandable && expanded && (
                      <div className="mt-1 mb-2 ml-[80px]">
                        <ChangedDetail slot={r.slot} pedal={pedalBySlot.get(r.slot)} backup={sourceBySlot.get(r.slot)} device={device} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
