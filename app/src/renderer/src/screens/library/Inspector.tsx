import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLineIcon, ArrowUpDownIcon, CableIcon, CopyIcon, DownloadIcon, FolderPlusIcon, HardDriveDownloadIcon, InfoIcon, PencilIcon, ScanSearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { GearFor, paramTitle } from "@/components/gear";
import { MiniChain } from "@/components/write/MiniChain";
import { conversionFor, conversionNote } from "@/components/write/conversion";
import { summarize, type PresetSummary, type SummaryBlock } from "@/components/write/preset-summary";
import { cn } from "@/lib/utils";
import { usePedalName, useDevice, useProfile } from "@/state/device";
import { isGp5Family, profileOrDefault, slotNameError, snapToneReplacesAmpCab, switchLabel } from "@/state/device-model";
import { EXP_TARGETS } from "@/gp5/lib/protocol.mjs";
import { PRST_MODELS, profileFor } from "@shared/devices";
import type { LocalPreset } from "@shared/host/files";
import { useLibraryActions } from "./actions";
import { formatDay } from "./dnd";
import { writableCollections } from "./LocalPane";
import { emptyName, isEmptyName, useLibrary } from "./store";
import { metaKey, normTag, useMeta, useTags } from "./tags";

const CORE = [2, 9, 3, 4, 5];

/** Inspector body for the current selection: one slot, several slots, or a preset on this computer. */
export function Inspector({ onClose }: { onClose?: () => void }) {
  const selected = useLibrary((s) => s.selected);
  const localSelected = useLibrary((s) => s.localSelected);
  const presets = useLibrary((s) => s.presets);
  const local = localSelected ? presets.find((p) => p.id === localSelected) : undefined;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-3.5">
      {onClose && (
        <Button variant="ghost" size="icon-sm" className="absolute top-0 right-0 z-10" aria-label="Close details" title="Close (Esc)" onClick={onClose}>
          <XIcon />
        </Button>
      )}
      {local ? <LocalInspector p={local} /> : selected.length > 1 ? <MultiInspector slots={selected} /> : selected.length === 1 ? <SlotInspector slot={selected[0]} /> : <NothingSelected />}
    </div>
  );
}

function NothingSelected() {
  return (
    <div className="flex flex-1 flex-col justify-start gap-1 px-2 pt-10 text-center">
      <p className="font-semibold text-silkscreen">Select a slot</p>
      <p className="text-sm text-pretty text-silkscreen-3">Its chain, volume and footswitches show here. Ctrl-click or Shift-click to select several.</p>
    </div>
  );
}

function Head({ title, meta, children }: { title: ReactNode; meta: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 pr-10">
      {children ?? <h2 className="truncate text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-balance text-silkscreen">{title}</h2>}
      <p className="text-sm text-silkscreen-3">{meta}</p>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border pt-3 [&>[data-slot=button]]:w-full">{children}</div>;
}

// ------------------------------------------------------------------------------------------ one slot

function SlotInspector({ slot }: { slot: number }) {
  const names = useDevice((s) => s.names);
  const activeSlot = useDevice((s) => s.slot);
  const saved = useDevice((s) => s.saved);
  const status = useDevice((s) => s.status);
  const busy = useDevice((s) => s.busy);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const body = useLibrary((s) => s.bodies[slot]);
  const renaming = useLibrary((s) => s.renaming === slot);
  const job = useLibrary((s) => s.job);
  const actions = useLibraryActions();
  const pedal = usePedalName();
  const profile = useProfile();
  const label = profile.slotLabel(slot);
  // The GP-200 family has no empty slots: a slot is reset to an init patch instead of cleared
  const clearLabel = profile.emptyName === null ? `Reset slot ${label} to init patch` : `Clear slot ${label}`;
  const name = names[slot]?.name ?? emptyName();
  const empty = isEmptyName(name);
  const connected = status === "connected";
  const writable = connected && !busy;
  const active = activeSlot === slot && connected;
  const prst = activeSlot === slot && saved ? saved.prst : body?.prst;
  const parsed = prst ? summarize(prst) : null;
  const summary = parsed && parsed.name === name ? parsed : null;
  const source = activeSlot === slot && saved ? `Read from the ${pedal}` : body ? (body.from === "backup" ? `Chain from the backup of ${formatDay(body.at)}` : `Read from the ${pedal}`) : null;

  return (
    <>
      <Head
        title={empty ? "Empty slot" : name}
        meta={
          <>
            Slot {label} on {pedal}
            {active && ", playing now"}
          </>
        }
      >
        {renaming ? (
          <RenameField slot={slot} name={name} />
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-silkscreen">{empty ? "Empty slot" : name}</h2>
            {!empty && (
              <Button variant="ghost" size="icon-sm" aria-label="Rename" title={connected ? "Rename (F2)" : `Rename needs the ${pedal}`} disabled={!connected} onClick={() => useLibrary.setState({ renaming: slot })}>
                <PencilIcon />
              </Button>
            )}
          </div>
        )}
      </Head>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {empty ? (
          <p className="text-sm text-pretty text-silkscreen-3">This slot holds the factory empty preset. Drag a preset here, or use Copy to… on another slot.</p>
        ) : summary ? (
          <>
            <ChainPreview s={summary} />
            <Patch s={summary} />
            {source && <p className="text-xs text-silkscreen-3">{source}</p>}
          </>
        ) : (
          <div className="flex flex-col items-start gap-2 rounded-lg bg-well p-3.5 text-sm">
            <p className="text-pretty text-silkscreen-2">The chain of this slot hasn't been read yet. Back up now reads every slot; reading just this one switches the pedal to it for a moment and back.</p>
            <Button variant="outline" size="sm" disabled={!writable || unsaved > 0 || job !== null} onClick={() => void actions.readSlot(slot)}>
              <ScanSearchIcon data-icon="inline-start" />
              {job ? "Reading…" : `Read from ${pedal}`}
            </Button>
            {unsaved > 0 && <p className="text-xs text-silkscreen-3">Save or discard your unsaved changes on the Rig first.</p>}
          </div>
        )}
      </div>

      <Actions>
        <Button disabled={!connected || empty} onClick={() => void actions.openInRig(slot)}>
          <CableIcon data-icon="inline-start" />
          Open in Rig
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!writable || empty} onClick={() => actions.copySlots([slot])}>
            <ArrowDownToLineIcon data-icon="inline-start" />
            Copy to…
          </Button>
          <Button variant="outline" disabled={!writable || empty} onClick={() => actions.duplicateSlot(slot)}>
            <CopyIcon data-icon="inline-start" />
            Duplicate
          </Button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={empty || (!connected && !summary)} onClick={() => void actions.exportSlots([slot])}>
            <DownloadIcon data-icon="inline-start" />
            Export .prst
          </Button>
          <AddToCollection disabled={empty || (!connected && !summary)} onAdd={(id) => void actions.addSlotsToCollection([slot], id)} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-led-fault hover:text-led-fault"
            aria-label={clearLabel}
            title={clearLabel}
            disabled={!writable || empty}
            onClick={() => actions.clearSlots([slot])}
          >
            <Trash2Icon />
          </Button>
        </div>
      </Actions>
    </>
  );
}

function RenameField({ slot, name }: { slot: number; name: string }) {
  const [value, setValue] = useState(name);
  const actions = useLibraryActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const pedal = usePedalName();
  const { nameLength, slotLabel } = useProfile();
  useEffect(() => inputRef.current?.select(), []);
  const trimmed = value.replace(/\s+$/, "");
  const error = slotNameError(value, pedal);
  const cancel = () => useLibrary.setState({ renaming: null });
  const commit = () => {
    if (error || trimmed === name) return cancel();
    cancel();
    actions.renameSlot(slot, trimmed);
  };
  return (
    <Field data-invalid={error ? true : undefined} className="gap-1.5">
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          maxLength={nameLength}
          aria-label={`New name for slot ${slotLabel(slot)}`}
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setValue(e.target.value.slice(0, nameLength))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Keep Enter from also activating the confirmation dialog's focused button.
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              cancel();
            }
          }}
          className="min-w-0 flex-1"
        />
        <Button variant="secondary" disabled={!!error || trimmed === name} onClick={commit}>
          Rename
        </Button>
        <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={cancel}>
          <XIcon />
        </Button>
      </div>
      {error ? (
        <FieldError id={hintId}>{error}</FieldError>
      ) : (
        <div id={hintId} className="flex justify-between gap-3 text-xs text-silkscreen-3">
          <span className="text-pretty">{value.length >= nameLength ? `The ${pedal} stores ${nameLength} characters. Further typing is ignored.` : `The ${pedal} shows up to ${nameLength} characters.`}</span>
          <span className={cn("tabular-nums", value.length >= nameLength && "text-led-warn")}>
            {value.length}/{nameLength}
          </span>
        </div>
      )}
    </Field>
  );
}

// ------------------------------------------------------------------------------------------ several slots

function MultiInspector({ slots }: { slots: number[] }) {
  const names = useDevice((s) => s.names);
  const writable = useDevice((s) => s.status === "connected" && s.busy === null);
  const connected = useDevice((s) => s.status === "connected");
  const bodies = useLibrary((s) => s.bodies);
  const actions = useLibraryActions();
  const pedal = usePedalName();
  const { slotLabel, emptyName: pedalEmptyName } = useProfile();
  const resets = pedalEmptyName === null;
  const both = slots.length === 2;
  const usedSlots = slots.filter((s) => !isEmptyName(names[s]?.name));

  return (
    <>
      <Head title={`${slots.length} slots selected`} meta={`On ${pedal}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        <ul className="flex flex-col gap-0.5 rounded-lg bg-well p-1.5">
          {slots.map((slot) => {
            const name = names[slot]?.name ?? emptyName();
            const s = bodies[slot] ? summarize(bodies[slot].prst) : null;
            const ok = s && s.name === name;
            return (
              <li key={slot} className="grid h-8 grid-cols-[minmax(22px,auto)_minmax(0,1fr)_auto] items-center gap-3 px-1.5 text-[13px]">
                <span className="text-sm font-semibold text-silkscreen-3 tabular-nums">{slotLabel(slot)}</span>
                <span className={cn("truncate font-semibold text-silkscreen", isEmptyName(name) && "font-medium text-silkscreen-4")}>{isEmptyName(name) ? "Empty" : name}</span>
                <MiniChain chain={ok ? s : null} />
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-pretty text-silkscreen-3">
          {both ? "Swapping writes both slots on the pedal." : `Copying, moving and ${resets ? "resetting" : "clearing"} write these slots on the pedal.`} You confirm before anything is stored.
        </p>
      </div>
      <Actions>
        {both ? (
          <Button disabled={!writable} onClick={() => actions.swapSlots(slots[0], slots[1])}>
            <ArrowUpDownIcon data-icon="inline-start" />
            Swap slots {slotLabel(slots[0])} and {slotLabel(slots[1])}
          </Button>
        ) : (
          <Button disabled={!writable || !usedSlots.length} onClick={() => actions.copySlots(slots)}>
            <CopyIcon data-icon="inline-start" />
            Copy {slots.length} slots to…
          </Button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!connected} onClick={() => void actions.backupSlots(slots)}>
            <HardDriveDownloadIcon data-icon="inline-start" />
            {both ? "Back up both" : `Back up ${slots.length}`}
          </Button>
          <Button variant="outline" disabled={!connected} onClick={() => void actions.exportSlots(slots)}>
            <DownloadIcon data-icon="inline-start" />
            {both ? "Export both" : `Export ${slots.length}`}
          </Button>
        </div>
        <div className="flex gap-1">
          <AddToCollection disabled={!connected} onAdd={(id) => void actions.addSlotsToCollection(slots, id)} />
          <Button variant="ghost" size="sm" className="ml-auto text-led-fault hover:text-led-fault" disabled={!writable || !usedSlots.length} onClick={() => actions.clearSlots(slots)}>
            <Trash2Icon data-icon="inline-start" />
            {resets ? "Reset" : "Clear"} {usedSlots.length === 1 ? "1 slot" : `${usedSlots.length} slots`}
          </Button>
        </div>
      </Actions>
    </>
  );
}

// ------------------------------------------------------------------------------------------ a preset on this computer

function LocalInspector({ p }: { p: LocalPreset }) {
  const collections = useLibrary((s) => s.collections);
  const writable = useDevice((s) => s.status === "connected" && s.busy === null);
  const device = useDevice((s) => s.device);
  const actions = useLibraryActions();
  const collection = collections.find((c) => c.id === p.collectionId);
  const s = summarize(p.prst);
  const conversion = s ? conversionFor(s, device) : null;
  const restore = collection?.kind === "backup" && p.slot !== null;

  return (
    <>
      <Head title={p.name} meta={`${collection?.title ?? "This computer"}, ${p.fileName}`} />
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto">
        {s ? (
          <>
            {conversion && (
              <p className="flex items-start gap-1.5 text-sm text-pretty text-silkscreen-2">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {conversionNote(conversion)}
              </p>
            )}
            <ChainPreview s={s} />
            <Patch s={s} />
            <MetaEditor p={p} />
            {p.source && <p className="text-xs text-silkscreen-3">From {p.source}, added {formatDay(p.addedAt)}</p>}
          </>
        ) : (
          <p className="text-sm text-led-fault">This file can't be read as a {PRST_MODELS} preset.</p>
        )}
      </div>
      <Actions>
        <Button disabled={!writable || !s} onClick={() => actions.writeLocal(p)}>
          <ArrowDownToLineIcon data-icon="inline-start" />
          {restore && collection ? `Restore to slot ${profileOrDefault(collection.device).slotLabel(p.slot!)}…` : "Write to slot…"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void actions.exportLocal([p])}>
            <DownloadIcon data-icon="inline-start" />
            Export .prst
          </Button>
          <AddToCollection variant="outline" exclude={p.collectionId} onAdd={(id) => void actions.addLocalToCollection([p], id)} />
        </div>
        {collection && collection.kind !== "backup" && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="ml-auto text-led-fault hover:text-led-fault" onClick={() => void actions.removeLocal(p)}>
              <Trash2Icon data-icon="inline-start" />
              Remove from {collection.title}
            </Button>
          </div>
        )}
      </Actions>
    </>
  );
}

/** Star rating and tags of a preset on this computer (tags.ts). */
function MetaEditor({ p }: { p: LocalPreset }) {
  const meta = useMeta(p);
  const key = metaKey(p);
  const { setStars, addTag, removeTag } = useTags.getState();
  const [draft, setDraft] = useState("");
  const commit = () => {
    addTag(key, draft);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-0.5" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-label={`${n} ${n === 1 ? "star" : "stars"}`} aria-pressed={meta.stars >= n} onClick={() => setStars(key, n)} className={cn("text-lg leading-none", meta.stars >= n ? "text-silkscreen" : "text-silkscreen-3")}>
            {meta.stars >= n ? "★" : "☆"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {meta.tags.map((t) => (
          <button key={t} type="button" aria-label={`Remove tag ${t}`} onClick={() => removeTag(key, t)} className="rounded-full bg-faceplate-raised px-2 py-0.5 text-xs text-silkscreen-2 hover:text-led-fault">
            #{t} <XIcon className="inline size-3" aria-hidden />
          </button>
        ))}
        <Input
          className="h-7 w-32 text-xs"
          placeholder="Add tag"
          aria-label="Add tag"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === ",") && normTag(draft) && (e.preventDefault(), commit())}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

function AddToCollection({ onAdd, disabled, exclude, variant = "ghost" }: { onAdd(id: string): void; disabled?: boolean; exclude?: string; variant?: "ghost" | "outline" }) {
  const collections = useLibrary((s) => s.collections);
  const actions = useLibraryActions();
  const targets = writableCollections(collections).filter((c) => c.id !== exclude);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={variant === "ghost" ? "sm" : "default"} disabled={disabled}>
          <FolderPlusIcon data-icon="inline-start" />
          Add to collection
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {targets.length > 0 && (
          <>
            <DropdownMenuGroup>
              {targets.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => onAdd(c.id)}>
                  {c.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => actions.collectionDialog({ kind: "new", then: (c) => onAdd(c.id) })}>New collection…</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ------------------------------------------------------------------------------------------ chain + patch

function valueText(b: SummaryBlock): string {
  const p = b.model?.params.find((x) => x.index === 0) ?? b.model?.params[0];
  if (!p) return "";
  const v = b.params[p.index];
  const label = p.labels?.[Math.round(v - p.min)];
  if (label !== undefined) return `${paramTitle(p.name)} ${label}`;
  const n = Number.isInteger(p.step) ? Math.round(v) : Math.round(v * 10) / 10;
  return `${paramTitle(p.name)} ${n}${p.unit ? ` ${p.unit}` : ""}`;
}

function ChainRow({ b, replaced }: { b: SummaryBlock; replaced: boolean }) {
  const wide = b.code === "AMP" || b.code === "CAB";
  return (
    <div className={cn("grid h-[30px] grid-cols-[36px_30px_minmax(0,1fr)_auto_7px] items-center gap-2 px-1 text-sm", !b.enabled && "text-silkscreen-4")}>
      <span className={cn("grid h-[29px] place-items-center overflow-hidden", !b.enabled && (replaced ? "brightness-40 saturate-0" : "brightness-55 saturate-20"))} aria-hidden>
        <GearFor block={b} className={wide ? "w-9" : "w-[19px]"} />
      </span>
      <span className={cn("text-xs font-semibold tracking-[0.04em]", b.enabled ? "text-silkscreen-2" : "text-silkscreen-4")}>{b.code}</span>
      <span className={cn("truncate", b.enabled ? "text-silkscreen" : "text-silkscreen-4")}>{b.model?.title ?? "Unknown model"}</span>
      <span className="text-xs whitespace-nowrap text-silkscreen-3">{replaced ? "Replaced" : valueText(b)}</span>
      <span className={cn("size-[7px] rounded-full", b.enabled ? "bg-led-on" : "bg-led-off")} aria-label={b.enabled ? "On" : "Off"} role="img" />
    </div>
  );
}

function ChainPreview({ s }: { s: PresetSummary }) {
  const codes = profileFor(s.device).blocks;
  const gp5 = isGp5Family(s.device);
  const seq = s.order.length === codes.length ? s.order : gp5 ? [0, 1, 2, 9, 3, 4, 5, 6, 7, 8] : codes.map((_, i) => i);
  // The GP-5 family's fixed core (DST NS AMP CAB EQ) is framed; the GP-200 family has none
  const start = gp5 ? seq.findIndex((i) => CORE.includes(i)) : seq.length;
  const nsOn = snapToneReplacesAmpCab(s.device) && !!s.blocks[codes.indexOf("NS")]?.enabled;
  const replacedByNs = [codes.indexOf("AMP"), codes.indexOf("CAB")];
  const row = (i: number) => <ChainRow key={i} b={s.blocks[i]} replaced={nsOn && replacedByNs.includes(i)} />;
  return (
    <section aria-label="Chain" className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold text-silkscreen">Chain</h3>
      <div className="flex shrink-0 flex-col rounded-lg bg-well px-1.5 py-1">
        {seq.slice(0, start).map(row)}
        {start < seq.length && <div className="my-[3px] flex flex-col border-y border-seam-strong py-[3px]">{seq.slice(start, start + 5).map(row)}</div>}
        {seq.slice(start + 5).map(row)}
        {nsOn && (
          <p className="flex items-center gap-1.5 px-1.5 pt-0.5 text-xs text-silkscreen-3">
            <InfoIcon className="size-3" aria-hidden />
            SnapTone is on, so it replaces AMP and CAB.
          </p>
        )}
      </div>
    </section>
  );
}

function FsChips({ blocks, codes }: { blocks: number[]; codes: readonly string[] }) {
  if (!blocks.length) return <span className="text-sm text-silkscreen-3">None</span>;
  return (
    <span className="col-span-3 flex flex-wrap gap-1">
      {blocks.map((k) => (
        <span key={k} className="inline-flex h-5 items-center gap-[5px] rounded-full px-[7px] text-xs font-semibold tracking-[0.04em] text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
          <span className="size-1.5 rounded-full" style={{ background: `var(--block-${codes[k].toLowerCase()})` }} aria-hidden />
          {codes[k]}
        </span>
      ))}
    </span>
  );
}

/** "DLY Time 0–100%", "Volume 0–100" or "Off": what the preset's EXP pedal (GP-50) sweeps. */
function expText(s: PresetSummary): string {
  const exp = s.exp!;
  if (!exp.on) return "Off";
  if (exp.targetModule === 0) return `Volume ${exp.volMin}–${exp.volMax}`;
  const code = EXP_TARGETS[exp.targetModule];
  const param = s.blocks.find((b) => b.code === code)?.model?.params[exp.targetParam];
  return `${code}${param ? ` ${paramTitle(param.name)}` : ""} ${exp.paramMin}–${exp.paramMax}%`;
}

function Patch({ s }: { s: PresetSummary }) {
  const key = "text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase";
  const codes = profileFor(s.device).blocks;
  return (
    <dl className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <dt className={key}>Volume</dt>
      <dd className="font-semibold text-silkscreen">{s.volume}</dd>
      <dt className={key}>Tempo</dt>
      <dd className="font-semibold text-silkscreen">
        {s.bpm} <small className="text-xs font-medium text-silkscreen-3">BPM</small>
      </dd>
      {s.footswitches.map((blocks, i) => (
        <Fragment key={i}>
          <dt className={key}>{switchLabel(s.device, i)}</dt>
          <dd className="col-span-3">
            <FsChips blocks={blocks} codes={codes} />
          </dd>
        </Fragment>
      ))}
      {s.exp && (
        <>
          <dt className={key}>EXP</dt>
          <dd className="col-span-3 font-semibold text-silkscreen">{expText(s)}</dd>
        </>
      )}
    </dl>
  );
}
