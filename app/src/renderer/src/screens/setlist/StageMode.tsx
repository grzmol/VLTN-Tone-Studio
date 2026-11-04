import { useEffect } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { requestPresetSwitch } from "@/app/preset-switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { DEFAULT_DEVICE, pedalName, profileOrDefault } from "@/state/device-model";
import { drift, indexOfSlot, stepIndex } from "./setlist";
import { useSetlists } from "./store";

/**
 * Full-window view for the stage: the current preset very large, the next one under it, your note. → / Space / Page Down
 * play the next preset, ← / Page Up the previous, Esc leaves. Follows the footswitch: when the pedal changes preset, the
 * list moves with it. Sits under the app's dialogs (z-40 < 50), so "Save your changes?" still shows on top.
 */
export function StageMode() {
  const stage = useSetlists((s) => s.stage);
  const lists = useSetlists((s) => s.setlists);
  const currentId = useSetlists((s) => s.currentId);
  const device = useDevice((s) => s.device) ?? DEFAULT_DEVICE;
  const slot = useDevice((s) => s.slot);
  const names = useDevice((s) => s.names);
  const connected = useDevice((s) => s.status === "connected");
  const busy = useDevice((s) => s.busy !== null);
  const list = lists.find((l) => l.id === currentId && l.device === device);
  const items = list?.items ?? [];
  const at = indexOfSlot(items, connected ? slot : null);
  const can = connected && !busy && items.length > 0;

  const go = (dir: 1 | -1) => {
    const target = items[stepIndex(at, dir, items.length)];
    if (can && target) void requestPresetSwitch(target.slot);
  };

  // Leave stage mode when the setlist goes away (deleted, or another pedal model connected).
  useEffect(() => {
    if (stage && !list) useSetlists.getState().setStage(false);
  }, [stage, list]);

  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return useSetlists.getState().setStage(false);
      // a dialog (e.g. unsaved changes) has focus: leave its keys alone
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Fullscreen when the browser allows it; leaving fullscreen (its own Esc) leaves stage mode too.
  useEffect(() => {
    if (!stage) return;
    let entered = false;
    const onChange = () => entered && !document.fullscreenElement && useSetlists.getState().setStage(false);
    document.addEventListener("fullscreenchange", onChange);
    void document.documentElement.requestFullscreen?.().then(
      () => (entered = true),
      () => {},
    );
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      entered = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [stage]);

  if (!stage || !list) return null;
  const { slotLabel } = profileOrDefault(device);
  const current = at >= 0 ? items[at] : null;
  const next = items[stepIndex(at, 1, items.length)];
  const warn = current && drift(current, names).kind !== "ok";

  return (
    <div role="region" aria-label="Stage mode" className="fixed inset-x-0 top-[52px] bottom-0 z-40 flex flex-col bg-[var(--enclosure)] p-8 text-silkscreen">
      <div className="flex items-center gap-3 text-silkscreen-3">
        <span className="text-lg font-[650]">{list.name}</span>
        <span className="text-sm">{at >= 0 ? `${at + 1} of ${items.length}` : `${items.length} presets`}</span>
        {!connected && <span className="text-sm text-led-warn">The {pedalName(device)} isn't connected</span>}
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="Leave stage mode" onClick={() => useSetlists.getState().setStage(false)}>
          <XIcon aria-hidden />
        </Button>
      </div>

      <div className="flex flex-1 items-center gap-6">
        <Button variant="outline" className="h-full max-h-64 w-24" aria-label="Previous preset" disabled={!can} onClick={() => go(-1)}>
          <ChevronLeftIcon className="size-10" aria-hidden />
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-4 text-center">
          {current ? (
            <>
              <span className="text-2xl font-semibold text-silkscreen-3 tabular-nums">{slotLabel(current.slot)}</span>
              <h1 className={cn("m-0 max-w-full truncate text-[clamp(56px,12vw,180px)] leading-none font-bold tracking-[-0.03em]", warn && "text-led-warn")}>{current.name}</h1>
              {current.note && <p className="m-0 text-3xl text-silkscreen-2">{current.note}</p>}
            </>
          ) : (
            <h1 className="m-0 text-5xl font-bold text-silkscreen-3">{connected ? "Press → to start the setlist" : "Waiting for the pedal"}</h1>
          )}
        </div>
        <Button variant="outline" className="h-full max-h-64 w-24" aria-label="Next preset" disabled={!can} onClick={() => go(1)}>
          <ChevronRightIcon className="size-10" aria-hidden />
        </Button>
      </div>

      <div className="flex items-baseline justify-center gap-3 text-2xl text-silkscreen-3">
        <span>Next</span>
        {next && <span className="font-semibold text-silkscreen-2">{next.name}</span>}
        {next && <span className="tabular-nums">{slotLabel(next.slot)}</span>}
      </div>
    </div>
  );
}
