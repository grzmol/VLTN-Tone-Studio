import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FilePlus, RefreshCw } from "lucide-react";
import { snapToneLabel } from "@shared/devices";
import type { ToneRecord } from "@shared/host/tones";
import { isEmptySlot, slotLinkOn } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { useDevice, usePedalName, useProfile } from "@/state/device";
import { vendorApps } from "@/state/device-model";
import { useNav } from "@/state/nav";
import type { SlotName } from "@/state/device-types";
import type { OpenFile } from "@/state/ui";
import { requestPresetSwitch } from "@/app/preset-switch";
import { notifyError, showToast } from "@/app/notify";
import { irSlotLabel, openLinkChoice, openRename, openSheet, readSlots, unlink, useTones } from "./store";
import { buildUsage, type PresetRef } from "./usage";
import { ToneImage } from "./ToneImage";

type Kind = "snaptone" | "ir";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "Read just now";
  if (min < 60) return `Read ${min} min ago`;
  return `Read at ${new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * "On your GP-5" (or GP-50): SnapTone and User IR slot maps, laid out from the pedal's profile. `onAddNam`: a .nam
 * picked from disk, for the SnapTone dialog (LocalNamDialog).
 */
export function SlotPanel({ onAddNam }: { onAddNam: (file: OpenFile) => void }) {
  const namInput = useRef<HTMLInputElement>(null);
  const status = useDevice((s) => s.status);
  const error = useDevice((s) => s.error);
  const busy = useDevice((s) => s.busy);
  const snapTones = useDevice((s) => s.snapTones);
  const userIRs = useDevice((s) => s.userIRs);
  const preset = useDevice((s) => s.preset);
  const readAt = useTones((s) => s.slotsReadAt);
  const slotsError = useTones((s) => s.slotsError);
  const usage = useTones((s) => s.usage);
  const records = useTones((s) => s.records);
  const send = useTones((s) => s.send);
  const now = useNow(30_000);
  const device = useDevice((s) => s.device);
  const pedal = usePedalName();
  const profile = useProfile();
  const connected = status === "connected";
  const [reading, setReading] = useState(false);

  // "Used in": the newest Library backup, with the live preset replacing its own slot (always current).
  const index = useMemo(() => {
    const list = (usage?.presets ?? []).filter((p) => p.slot !== preset?.slot);
    if (preset) list.push({ slot: preset.slot, name: preset.name, prst: preset.prst });
    return buildUsage(list);
  }, [usage, preset]);

  // Slot numbers mean something only on the pedal model the link was made on.
  const links = useMemo(() => {
    const snap = new Map<number, ToneRecord>();
    const ir = new Map<number, ToneRecord>();
    for (const r of Object.values(records)) {
      const link = slotLinkOn(r, device);
      if (!link || link.other) continue;
      (link.kind === "snaptone" ? snap : ir).set(link.slot, r);
    }
    return { snaptone: snap, ir };
  }, [records, device]);

  const targets = useMemo(() => {
    const t = { snaptone: new Set<number>(), ir: new Set<number>() };
    for (const s of Object.values(send)) if (s.proposedSlot !== null && s.phase !== "linked") t[s.kind].add(s.proposedSlot);
    return t;
  }, [send]);

  const read = async () => {
    setReading(true);
    await readSlots();
    setReading(false);
  };

  const [userFirst, userLast] = profile.snapTone.userRange;
  const userSlots = userLast - userFirst + 1;
  const snapUser = snapTones?.filter((s) => s.slot >= userFirst && s.slot <= userLast) ?? [];
  const snapFactory = snapTones?.filter((s) => s.slot < userFirst) ?? [];
  // The block each SnapTone plays in: NS on the GP-5 family, AMP (0-4) or DST (5-9) on the GP-200 family.
  const byBlock = [...new Set(snapUser.map((s) => profile.captureBlock(s.slot)))].map((block) => ({ block, slots: snapUser.filter((s) => profile.captureBlock(s.slot) === block) }));
  // A table the pedal didn't list (GP-200LT without 0x1009 replies) has no count: its slots may or may not be used.
  const usedOf = (list: SlotName[], of: string) =>
    list.some((s) => s.kind === "unknown") ? "Contents unknown: the pedal didn't list them" : `${list.filter((s) => !isEmptySlot(s)).length} of ${of} used`;
  const sourceNote = usage ? `From ${usage.source}` : "Back up the pedal in Library to see which presets use each slot";

  let notice: string | null = null;
  if (error?.code === "busy") notice = `Close ${vendorApps(device).editor} to reconnect.`;
  else if (!connected && snapTones) notice = `The ${pedal} isn't connected. Slots from ${readAt ? new Date(readAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "the last read"}.`;
  else if (!connected) notice = `Connect the ${pedal} to see its capture and IR slots.`;
  else if (slotsError) notice = `Couldn't read the slots: ${slotsError}`;
  const driverProblem = !connected && error?.code === "not-found" && host.platform === "win32";

  return (
    <aside aria-label={`On your ${pedal}`} className="glass mt-5 flex min-h-0 flex-col gap-3.5 overflow-auto rounded-xl px-4 pt-3.5 pb-4">
      <div className="-mb-1 flex items-center gap-2">
        <h2 className="text-[12px] font-semibold text-silkscreen-2">On your {pedal}</h2>
        <span className="grow" />
        {readAt && <span className="text-[11px] text-silkscreen-3">{ago(readAt, now)}</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Read slots from the pedal again" disabled={!connected || reading || Boolean(busy)} onClick={read}>
              <RefreshCw className={cn(reading && "animate-spin motion-reduce:animate-none")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Read slots again (R)</TooltipContent>
        </Tooltip>
      </div>

      <Button variant="outline" size="sm" className="self-start" onClick={() => namInput.current?.click()}>
        <FilePlus data-icon="inline-start" />
        Add NAM from disk…
      </Button>
      <input
        ref={namInput}
        type="file"
        accept=".nam"
        hidden
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onAddNam({ name: file.name, path: null, file });
        }}
      />

      {notice && <p className="text-[12px] text-pretty text-silkscreen-2">{notice}</p>}
      {driverProblem && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => useNav.getState().go("device")}>
          Fix the USB driver on the Device page
        </Button>
      )}

      {snapTones && (
        <section aria-label="SnapTone slots" className="flex flex-col gap-1.5">
          <SlotsHead title="SnapTone captures" count={usedOf(snapUser, `${userSlots} ${userFirst > 0 ? "user slots" : "slots"}`)} />
          {byBlock.length > 1 ? (
            byBlock.map(({ block, slots }) => (
              <div key={block} role="group" aria-label={`SnapTones in the ${block} block`} className="flex flex-col gap-1">
                <h4 className="text-[11px] font-semibold text-silkscreen-3">{`${block} ${slots[0].slot}–${slots[slots.length - 1].slot}`}</h4>
                <SlotGrid kind="snaptone" slots={slots} index={index.snaptone} links={links.snaptone} targets={targets.snaptone} note={sourceNote} />
              </div>
            ))
          ) : (
            <SlotGrid kind="snaptone" slots={snapUser} index={index.snaptone} links={links.snaptone} targets={targets.snaptone} note={sourceNote} />
          )}
          {userFirst > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="group flex h-8 w-full items-center gap-1.5 rounded-sm px-2 text-[12px] font-[550] text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam)] hover:bg-accent">
                <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" aria-hidden />
                <span>{`Factory captures 0–${userFirst - 1}`}</span>
                <span className="grow" />
                <span className="text-[11px] font-normal text-silkscreen-3">{snapFactory.length}, read-only</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <SlotGrid kind="snaptone" slots={snapFactory} index={index.snaptone} links={links.snaptone} targets={targets.snaptone} note={sourceNote} readOnly />
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      )}

      {userIRs && (
        <section aria-label="User IR slots" className="flex flex-col gap-1.5">
          <SlotsHead title="User IRs" count={usedOf(userIRs, `${profile.userIr.slots} slots`)} />
          <SlotGrid kind="ir" slots={userIRs} index={index.ir} links={links.ir} targets={targets.ir} note={sourceNote} />
        </section>
      )}
    </aside>
  );
}

function SlotsHead({ title, count }: { title: string; count: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[11px]">
      <h3 className="text-[12px] font-[650] text-silkscreen">{title}</h3>
      <span className="text-silkscreen-3">{count}</span>
    </div>
  );
}

function SlotGrid({
  kind,
  slots,
  index,
  links,
  targets,
  note,
  readOnly,
}: {
  kind: Kind;
  slots: SlotName[];
  index: Map<number, PresetRef[]>;
  links: Map<number, ToneRecord>;
  targets: Set<number>;
  note: string;
  readOnly?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-x-1 gap-y-1.5">
      {slots.map((s) => (
        <SlotCell key={s.slot} kind={kind} slot={s} usedIn={index.get(s.slot) ?? []} link={links.get(s.slot)} target={targets.has(s.slot)} note={note} readOnly={readOnly} />
      ))}
    </div>
  );
}

function SlotCell({
  kind,
  slot,
  usedIn,
  link,
  target,
  note,
  readOnly,
}: {
  kind: Kind;
  slot: SlotName;
  usedIn: PresetRef[];
  link?: ToneRecord;
  target: boolean;
  note: string;
  readOnly?: boolean;
}) {
  const empty = isEmptySlot(slot);
  const profile = useProfile();
  const label = kind === "snaptone" ? snapToneLabel(profile.key, slot.slot) : irSlotLabel(slot.slot);
  const stale = link && link.gp5.slotName && link.gp5.slotName !== slot.name;
  const records = useTones((s) => s.records);
  const linkable = Object.values(records).filter((r) => (kind === "snaptone" ? r.format === "nam" : r.format === "ir"));
  const canRename = useDevice((s) => s.features.includes("renameToneSlots"));
  const busy = useDevice((s) => s.busy);

  const onClick = () => {
    if (link) openSheet(link.tone_id);
    else if (empty)
      showToast({
        tone: "ok",
        title: `${label} is empty`,
        body: kind === "snaptone" ? "Send a capture from TONE3000 to fill this slot." : "Send an IR from TONE3000, or drop a .wav file on Tones, to fill this slot.",
      });
  };
  const openOnRig = async (p: PresetRef) => {
    useNav.getState().go("rig");
    await requestPresetSwitch(p.slot);
  };

  const tip = target
    ? "Proposed slot for the file you are sending"
    : empty
      ? "Empty"
      : [
          slot.kind === "unknown" ? "The pedal didn't say what this slot holds; writing to it replaces whatever is there" : null,
          link ? `Linked to ${link.title} on TONE3000${stale ? ` (the pedal now calls it ${slot.name})` : ""}` : null,
          usedIn.length ? `Used in ${usedIn.map((p) => `${profile.slotLabel(p.slot)} ${p.name}`).join(", ")}` : "Not used by any preset",
          note,
        ]
          .filter(Boolean)
          .join(". ");

  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClick}
              aria-label={`${label}, ${empty ? (target ? "proposed" : "empty") : slot.name}`}
              className={cn(
                "relative flex h-[26px] min-w-0 items-center gap-1 rounded-sm px-[5px] text-left text-[11.5px] tracking-[-0.01em] shadow-[inset_0_0_0_1px_var(--seam)] before:absolute before:inset-x-0 before:-inset-y-[3px] hover:bg-accent",
                empty ? "bg-transparent shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--seam)_40%,transparent)]" : "bg-faceplate-raised",
                target && "shadow-[inset_0_0_0_1px_var(--lamp)]",
              )}
            >
              <span className="min-w-4 flex-none text-[11px] font-semibold text-silkscreen-3">{kind === "ir" ? slot.slot + 1 : slot.slot}</span>
              <span className={cn("truncate", target ? "font-semibold text-lamp" : empty ? "font-medium text-silkscreen-4" : "font-semibold text-silkscreen")}>
                {target && empty ? "Proposed" : empty ? "Empty" : slot.name}
              </span>
              {link && (
                <ToneImage url={link.image_url} gear={link.gear} format={link.format} alt="" caption={false} className="ml-auto size-4 rounded-xs [&_svg]:size-2.5" />
              )}
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent className="max-w-72">{tip}</TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-64">
        <ContextMenuGroup>
          {!readOnly && !empty && (
            <ContextMenuItem disabled={linkable.length === 0} onSelect={() => openLinkChoice({ kind, slot: slot.slot })}>
              Link to a TONE3000 tone…
            </ContextMenuItem>
          )}
          {!readOnly && !empty && canRename && (
            <ContextMenuItem disabled={Boolean(busy)} onSelect={() => openRename({ kind, slot: slot.slot })}>
              Rename…
            </ContextMenuItem>
          )}
          {link && (
            <>
              <ContextMenuItem onSelect={() => openSheet(link.tone_id)}>Show {link.title}</ContextMenuItem>
              <ContextMenuItem onSelect={() => unlink(link.tone_id).catch((e) => notifyError("Couldn't unlink", e))}>Unlink</ContextMenuItem>
            </>
          )}
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger disabled={usedIn.length === 0}>Show presets using it</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuGroup>
                {usedIn.map((p) => (
                  <ContextMenuItem key={p.slot} onSelect={() => void openOnRig(p)}>
                    {profile.slotLabel(p.slot)} {p.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem disabled={usedIn.length === 0} onSelect={() => usedIn[0] && void openOnRig(usedIn[0])}>
            Open on Rig
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
