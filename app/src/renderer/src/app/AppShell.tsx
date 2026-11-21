import { useEffect, type ComponentType } from "react";
import { isElectron } from "@/host";
import { isDeviceKey } from "@shared/devices";
import { useDevice } from "@/state/device";
import { DEFAULT_DEVICE } from "@/state/device-model";
import { useNav, type Screen } from "@/state/nav";
import { TitleBar } from "./TitleBar";
import { Rail } from "./Rail";
import { StatusBar } from "./StatusBar";
import { useAppCommands } from "./commands";
import { useDeviceWatch } from "./device-watch";
import { useShowGuard } from "./show-guard";
import { useUpdateWatch } from "./updates";
import { CommandPalette } from "./palette/CommandPalette";
import { AboutDialog } from "./overlays/AboutDialog";
import { WhatsNewDialog } from "./overlays/WhatsNewDialog";
import { useWhatsNewOnLaunch } from "./whats-new";
import { UpdateDialog } from "./overlays/UpdateDialog";
import { UnsavedSwitchDialog } from "./overlays/UnsavedSwitchDialog";
import { FileDropOverlay } from "./overlays/FileDropOverlay";
import { RigScreen } from "@/screens/rig/RigScreen";
import { LibraryScreen } from "@/screens/library/LibraryScreen";
import { TonesScreen } from "@/screens/tones/TonesScreen";
import { DeviceScreen } from "@/screens/device/DeviceScreen";
import { CaptureEditorScreen } from "@/screens/capture/CaptureEditorScreen";
import { SongScreen } from "@/screens/song/SongScreen";
import { SetlistScreen } from "@/screens/setlist/SetlistScreen";
import { StageMode } from "@/screens/setlist/StageMode";

const SCREENS: Record<Screen, ComponentType> = {
  rig: RigScreen,
  library: LibraryScreen,
  tones: TonesScreen,
  device: DeviceScreen,
  capture: CaptureEditorScreen,
  song: SongScreen,
  setlist: SetlistScreen,
};

/** Window frame: 52px title bar, floating glass rail, the active screen, 30px status bar, app-wide overlays. */
export function AppShell() {
  const screen = useNav((s) => s.screen);
  useLaunchParams();
  useAppCommands();
  useDeviceWatch();
  useShowGuard();
  useUpdateWatch();
  useWhatsNewOnLaunch();
  const Active = SCREENS[screen];
  return (
    <div className="grid h-full grid-cols-[84px_minmax(0,1fr)] grid-rows-[52px_minmax(0,1fr)]">
      <TitleBar className="col-span-2" />
      <Rail />
      <main className="flex min-h-0 min-w-0 flex-col">
        <div className="min-h-0 flex-1">
          <Active />
        </div>
        <StatusBar />
      </main>
      <CommandPalette />
      <StageMode />
      <UnsavedSwitchDialog />
      <AboutDialog />
      <WhatsNewDialog />
      <UpdateDialog />
      <FileDropOverlay />
    </div>
  );
}

/**
 * Launch parameters (demo builds, screenshots, E2E): `?mock=<device key>` connects that simulated model (`gp5`, `gp50`,
 * `gp200`, `gp200lt`, `gp200jr`), a bare `?mock` the simulated GP-5 with the bundled 100-slot backup;
 * `?screen=library` (and `&param=`) opens a screen. The desktop app connects to the
 * real pedal on launch; failures stay in the device store's error state (chip and Device screen show it).
 */
function useLaunchParams() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const screen = q.get("screen");
    if (screen === "rig" || screen === "library" || screen === "tones" || screen === "device" || screen === "capture" || screen === "song" || screen === "setlist") useNav.getState().go(screen, q.get("param"));
    const mock = q.get("mock");
    if (mock !== null) void useDevice.getState().connect("mock", { mockDevice: isDeviceKey(mock) ? mock : DEFAULT_DEVICE }).catch(() => {});
    else if (isElectron) void useDevice.getState().connect("webmidi").catch(() => {});
  }, []);
}
