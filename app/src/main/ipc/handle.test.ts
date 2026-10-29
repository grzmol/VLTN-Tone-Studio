// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// handle.ts loads Electron at import time; only the pieces sendTo needs are replaced.
vi.mock("electron", () => ({
  app: { getPath: () => "/unused" },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: vi.fn() },
}));

const { sendTo } = await import("./handle");

/** A window stub: webContents records what was sent and can report itself destroyed. */
function fakeWindow(destroyed = false) {
  const send = vi.fn();
  return { send, window: { isDestroyed: () => false, webContents: { send, isDestroyed: () => destroyed } } };
}

describe("sendTo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the payload on the channel to a live window", () => {
    const { send, window } = fakeWindow();
    sendTo(() => window as never, "app:event", { type: "window-focus", focused: true });
    expect(send).toHaveBeenCalledExactlyOnceWith("app:event", { type: "window-focus", focused: true });
  });

  it("drops the message when the window's webContents is destroyed, without throwing", () => {
    const { send, window } = fakeWindow(true);
    expect(() => sendTo(() => window as never, "update:state", {})).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("drops the message when there is no window", () => {
    expect(() => sendTo(() => null, "tones:event", {})).not.toThrow();
  });
});
