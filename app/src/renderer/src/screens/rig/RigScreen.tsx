import { useEffect } from "react";
import { UsbIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/screens/device/settings-store";
import { useDevice, usePedalName } from "@/state/device";
import { useNav } from "@/state/nav";
import { useCommand, useStatusHints, useUi } from "@/state/ui";
import { AmpCabView, AmpStrip } from "./AmpCabView";
import { ChainOverview } from "./ChainOverview";
import { copyBlock, pasteBlock } from "./clipboard";
import { DisconnectedBanner } from "./DisconnectedBanner";
import { editEnabled, editOrder } from "./edits";
import { useHistory } from "./history";
import { ModelPicker } from "./ModelPicker";
import { GROUPS, groupOf, nudge } from "./order";
import { Pedalboard } from "./Pedalboard";
import { RigHeader } from "./RigHeader";
import { SceneFootswitches } from "./Scenes";
import { useRig } from "./rig-store";

const HINTS = [
  { keys: ["←", "→"], label: "block" },
  { keys: ["Space"], label: "on/off" },
  { keys: ["M"], label: "change model" },
];

/** Rig: the active preset drawn as gear, edited live on the pedal. */
export function RigScreen() {
  const preset = useDevice((s) => s.preset);
  const saved = useDevice((s) => s.saved);
  const status = useDevice((s) => s.status);
  const pedal = usePedalName();
  const group = useRig((s) => s.group);
  const showValues = useAppSettings((s) => s.settings.showValues);
  const settingsLoaded = useAppSettings((s) => s.loaded);
  const connected = status === "connected";
  const readOnly = !connected;

  useStatusHints(HINTS);

  useEffect(() => {
    if (!settingsLoaded) void useAppSettings.getState().load().catch(() => {});
  }, [settingsLoaded]);

  // A new read of the pedal (save, discard, preset switch) starts a fresh history.
  useEffect(() => {
    useHistory.getState().clear();
    useRig.setState({ compare: null });
  }, [saved]);

  // Palette / shell requests: select a block and optionally open its picker.
  const rigFocus = useUi((s) => s.rigFocus);
  useEffect(() => {
    const p = useDevice.getState().preset;
    if (!rigFocus || !p) return;
    const rig = useRig.getState();
    rig.select(rigFocus.block);
    rig.setGroup(groupOf(p.device, p.order, rigFocus.block));
    rig.openPicker(rigFocus.picker ? { block: rigFocus.block, highlight: rigFocus.fxid } : null);
    useUi.getState().clearRigFocus();
  }, [rigFocus, preset]);

  useCommand("copy-block", () => {
    const { selected } = useRig.getState();
    const b = selected === null ? undefined : useDevice.getState().preset?.blocks[selected];
    if (b) copyBlock(b);
  });
  useCommand("paste-block", () => {
    const { selected } = useRig.getState();
    if (selected !== null) void pasteBlock(selected);
  }, connected);

  useRigKeys(readOnly);

  if (!preset) {
    if (status === "connecting") return <RigSkeleton />;
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsbIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Connect your {pedal} to see its preset</EmptyTitle>
          <EmptyDescription>The Rig shows the preset that is active on the pedal and plays every change on it as you turn the knobs.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => useNav.getState().go("device")}>Connect the {pedal}</Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-col", readOnly && "[--rig-banner:136px] [@media(max-height:820px)]:[--rig-banner:52px]")}>
      {readOnly && <DisconnectedBanner />}
      <RigHeader preset={preset} connected={connected} />
      {connected && preset.gp200 && <SceneFootswitches preset={preset} disabled={readOnly} />}
      <div inert={readOnly} className="flex min-h-0 flex-1 flex-col">
        <ChainOverview preset={preset} readOnly={readOnly} />
        <div className="relative flex min-h-0 flex-1 flex-col">
          {group === "amp" ? <AmpCabView preset={preset} readOnly={readOnly} /> : <Pedalboard preset={preset} view={group} readOnly={readOnly} showValues={showValues} />}
          <ModelPicker />
        </div>
        <AmpStrip preset={preset} readOnly={readOnly} />
      </div>
    </div>
  );
}

/** ←/→ select block (crossing groups), Space on/off, M model picker, Alt ←/→ move, Ctrl/Cmd 1/2/3 groups. */
function useRigKeys(readOnly: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu],[role=listbox],[role=slider]")) return;
      const p = useDevice.getState().preset;
      const rig = useRig.getState();
      if (!p || rig.picker) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && !e.altKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        rig.setGroup(GROUPS[Number(e.key) - 1]);
        return;
      }
      if (mod) return;
      const sel = rig.selected;
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey) {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        if (e.altKey) {
          if (readOnly || sel === null) return;
          const next = nudge(p.device, p.order, sel, dir);
          e.preventDefault();
          if (next) {
            editOrder(next);
            rig.setGroup(groupOf(p.device, next, sel));
          }
          return;
        }
        e.preventDefault();
        const i = sel === null ? -1 : p.order.indexOf(sel);
        const nextIdx = sel === null ? (dir > 0 ? 0 : p.order.length - 1) : Math.max(0, Math.min(p.order.length - 1, i + dir));
        const b = p.order[nextIdx];
        rig.select(b);
        rig.setGroup(groupOf(p.device, p.order, b));
        return;
      }
      if (e.altKey || sel === null || readOnly) return;
      if (e.key === " " && !t.closest("button,[role=switch],a")) {
        e.preventDefault();
        editEnabled(sel, !p.blocks[sel].enabled);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        rig.openPicker({ block: sel });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly]);
}

/** While connecting: the model may not be known yet (the remembered one can be another model), so no name. */
function RigSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 px-7 pt-4" aria-busy="true" aria-label="Reading the pedal">
      <Skeleton className="h-9 w-72 rounded-sm" />
      <Skeleton className="h-4 w-96 rounded-sm" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="flex flex-1 items-start justify-center gap-[22px] pt-12">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="aspect-[2/3] w-[clamp(112px,calc((100vh-570px)/1.5),186px)] rounded-[28px]" />
        ))}
      </div>
    </div>
  );
}
