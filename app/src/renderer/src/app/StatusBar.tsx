import { Fragment } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { useDevice, usePedalName } from "@/state/device";
import { useNav } from "@/state/nav";
import { useUi, type StatusHint, type StatusMessage } from "@/state/ui";
import { host } from "@/host";
import { connectionView } from "@/screens/device/guidance";
import { attachedDevice, pedalName } from "@/state/device-model";
import { liveStatusText } from "@/screens/rig/live-edits";
import { keyLabel } from "./keys";
import { AnalysisChip } from "./AnalysisChip";
import { ConversionChip } from "./ConversionChip";
import { SongRunChip } from "./SongRunChip";

const LED: Record<StatusMessage["led"], string> = { on: "bg-led-on", off: "bg-led-off", warn: "bg-led-warn", fault: "bg-led-fault" };

/** Default hints per screen; screens replace them with `useStatusHints`. */
const DEFAULT_HINTS: Record<string, StatusHint[]> = {
  rig: [
    { keys: ["Mod", "K"], label: "command palette" },
    { keys: ["Mod", "S"], label: "save" },
    { keys: ["F2"], label: "rename slot" },
  ],
  other: [{ keys: ["Mod", "K"], label: "command palette" }],
};

/** 30px status bar: live/offline state and MIDI port on the left, shortcut hints on the right. */
export function StatusBar() {
  const status = useDevice((s) => s.status);
  const portName = useDevice((s) => s.portName);
  const mode = useDevice((s) => s.mode);
  const busy = useDevice((s) => s.busy);
  const hadPreset = useDevice((s) => s.preset !== null);
  const screen = useNav((s) => s.screen);
  const override = useUi((s) => s.message);
  const hints = useUi((s) => s.hints) ?? DEFAULT_HINTS[screen] ?? DEFAULT_HINTS.other;
  const error = useDevice((s) => s.error);
  const features = useDevice((s) => s.features);
  const device = useDevice((s) => s.device);
  const pedal = usePedalName();
  // While connecting: the pedal on the port being opened, not the remembered one
  const connecting = useDevice((s) => (s.status === "connecting" ? pedalName(attachedDevice(s)) : null));
  const live = status === "connected";
  const errorView = status === "error" && error ? connectionView({ status, error, mode, hostStatus: null, platform: host.platform, device, portName }) : null;

  const message: StatusMessage =
    override ??
    (busy
      ? { led: "warn", text: `${busy.label}…` }
      : live
        ? { led: "on", text: liveStatusText(features) }
        : errorView
          ? { led: errorView.led, text: errorView.statusText }
          : status === "connecting"
          ? { led: "warn", text: `Connecting to the ${connecting}…` }
          : hadPreset && screen === "rig"
            ? { led: "off", text: `Offline: the Rig is read-only until the ${pedal} is back. Nothing has been lost.` }
            : { led: "off", text: `Not connected: presets on the pedal can't be changed until the ${pedal} is back` });

  return (
    <footer className="flex h-[30px] shrink-0 items-center gap-4 overflow-hidden pr-5 pl-6 text-[11px] whitespace-nowrap text-silkscreen-3">
      <span className="flex min-w-0 items-center gap-2" role="status">
        <span className={cn("size-[7px] shrink-0 rounded-full", LED[message.led])} aria-hidden />
        <span className="truncate">{message.text}</span>
      </span>
      {live && (
        <>
          <span className="h-3 w-px shrink-0 bg-seam-strong" aria-hidden />
          <span className="shrink-0">{mode === "mock" ? `Simulated ${pedal}` : portName}</span>
        </>
      )}
      <span className="flex-1" />
      <SongRunChip />
      <AnalysisChip />
      <ConversionChip />
      {hints.map((h, i) => (
        <Fragment key={i}>
          <span className="flex shrink-0 items-center gap-1.5">
            <Kbd className="h-[18px] rounded-xs bg-white/8 px-1.5 text-[11px] font-semibold text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--glass-edge)]">{keyLabel(h.keys)}</Kbd>
            {h.label}
          </span>
        </Fragment>
      ))}
    </footer>
  );
}
