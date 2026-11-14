import { shell, type BrowserWindow } from "electron";
import { HostError } from "@shared/ipc";
import { handle } from "./ipc/handle";

const MIDI_SETUP = "/System/Applications/Utilities/Audio MIDI Setup.app";

/** Discovery runs in macOS's MIDI app, so its radio cannot block Tone Studio's main thread. */
export class BluetoothSetupLauncher {
  private pending: ((error?: HostError) => void) | null = null;
  constructor(private launch = () => shell.openPath(MIDI_SETUP)) {}

  open(): Promise<void> {
    if (this.pending) return Promise.reject(new HostError("invalid", "Bluetooth MIDI setup is already opening."));
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = (error?: HostError) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.pending = null;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () =>
          finish(
            new HostError(
              "io",
              "macOS MIDI setup did not respond. Tone Studio is still available. Open Audio MIDI Setup from Applications → Utilities, then retry.",
            ),
          ),
        10000,
      );
      this.pending = finish;
      void Promise.resolve()
        .then(this.launch)
        .then(
          (error) => {
            finish(
              error
                ? new HostError("io", "Could not open Audio MIDI Setup. Open it from Applications → Utilities and connect Bluetooth MIDI there.")
                : undefined,
            );
          },
          () => finish(new HostError("io", "Could not open Audio MIDI Setup. Open it from Applications → Utilities and connect Bluetooth MIDI there.")),
        );
    });
  }

  /** Cancels our wait without closing a system app that the user may already be using. */
  cancel(): void {
    this.pending?.(new HostError("cancelled", "Opening MIDI setup cancelled. Existing MIDI connections were left unchanged."));
  }
}

export function registerBluetoothSetupIpc(getWindow: () => BrowserWindow | null): { dispose(): void } {
  const setup = new BluetoothSetupLauncher();
  const authorized = (sender: Electron.WebContents, frame: Electron.WebFrameMain | null) => {
    const window = getWindow();
    if (!window || sender !== window.webContents || frame !== window.webContents.mainFrame)
      throw new HostError("unauthorized", "Bluetooth MIDI setup is only available in the main window.");
    return window;
  };
  handle("bluetooth:setup", async (event) => {
    const window = authorized(event.sender, event.senderFrame);
    if (process.platform !== "darwin") throw new HostError("unsupported", "System Bluetooth MIDI setup is available on macOS.");
    const cancel = () => setup.cancel();
    window.once("closed", cancel);
    try {
      await setup.open();
    } finally {
      window.removeListener("closed", cancel);
    }
  });
  handle("bluetooth:cancel-setup", (event) => {
    authorized(event.sender, event.senderFrame);
    setup.cancel();
  });
  return { dispose: () => setup.cancel() };
}
