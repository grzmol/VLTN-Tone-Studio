import { Cable } from "lucide-react";
import { cn } from "@/lib/utils";
import { host } from "@/host";
import { PresetSwitcher } from "./PresetSwitcher";
import { EditModeSelect } from "./EditModeSelect";
import { DeviceChip } from "./DeviceChip";
import { SearchButton } from "./SearchButton";

/**
 * 52px drag region: brand, preset switcher, search, device chip. Controls sit in
 * floating glass capsules. macOS reserves the traffic lights on the left; Windows/Linux reserve the
 * native window controls (titleBarOverlay) on the right.
 */
export function TitleBar({ className }: { className?: string }) {
  const native = host.kind === "electron";
  const mac = host.platform === "darwin";
  return (
    <header
      className={cn(
        "drag-region flex items-center gap-3 pl-[22px] select-none",
        native && mac && "pl-[92px]",
        className,
      )}
      // Windows/Linux: keep clear of the native window controls (Window Controls Overlay area); 16px elsewhere.
      style={{ paddingRight: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 16px)" }}
    >
      <div className={cn("flex shrink-0 items-center gap-[9px]", native && mac ? "w-[132px]" : "w-[204px] max-[900px]:w-[22px]")}>
        <span className="grid size-[22px] place-items-center text-silkscreen" aria-hidden>
          <Cable className="size-3.5" strokeWidth={2.25} />
        </span>
        <b className="text-[15px] font-semibold tracking-[-0.01em] max-[900px]:hidden">Tone Studio</b>
      </div>
      <PresetSwitcher />
      <EditModeSelect />
      <span className="flex-1" />
      <div className="no-drag flex items-center gap-3">
        <SearchButton />
        <DeviceChip />
      </div>
    </header>
  );
}
