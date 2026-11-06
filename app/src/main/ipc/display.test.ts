import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudienceModel, AudienceUpdate } from "@shared/audience";
import type { AudienceStatus } from "@shared/host/audience";

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }));
vi.mock("electron", () => ({
  app: { getPath: () => "/unused" },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
  },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}), on: () => {}, removeListener: () => {} },
}));

import {
  AudienceController,
  isAudienceContents,
  parseDisplayId,
  readDisplayId,
  registerDisplayIpc,
  sendAudienceStatus,
  writeDisplayId,
  type AudienceWindowHooks,
} from "./display";

const main = { id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const projector = { id: 7, bounds: { x: 1440, y: 0, width: 1920, height: 1080 }, workArea: { x: 1440, y: 0, width: 1920, height: 1080 } };

/** A fake display list the test changes, and fake windows the controller creates. */
function harness(initialDisplayId: number | null = null) {
  let displays = [main, projector];
  let saved = initialDisplayId;
  const windows: {
    mode: string;
    bounds: unknown;
    hooks: AudienceWindowHooks;
    send: ReturnType<typeof vi.fn>;
    setBounds: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const statuses: AudienceStatus[] = [];
  const controller = new AudienceController({
    displays: () => displays,
    primary: () => main,
    createWindow: (mode, bounds, hooks) => {
      const window = { mode, bounds, hooks, send: vi.fn(), setBounds: vi.fn(), destroy: vi.fn() };
      windows.push(window);
      return window;
    },
    loadDisplayId: () => initialDisplayId,
    saveDisplayId: (displayId) => {
      saved = displayId;
    },
    onStatus: (status) => statuses.push(status),
  });
  return {
    controller,
    windows,
    statuses,
    saved: () => saved,
    setDisplays: (next: (typeof main)[]) => (displays = next),
  };
}

const model = (patch: Partial<AudienceModel> = {}): AudienceModel => ({
  songKey: "song-1",
  screen: "lyrics",
  blackout: false,
  blackBetweenSongs: false,
  title: "Harbour Lights",
  nextTitle: null,
  timed: false,
  lines: [{ time: null, heading: null, text: "Verse one", chords: [] }],
  showChords: true,
  fontScale: 1,
  rotation: 0,
  pdf: null,
  ...patch,
});

describe("AudienceController", () => {
  it("opens on the chosen display fitted to its bounds, and remembers the choice", () => {
    const h = harness();
    h.controller.choose(7);
    const status = h.controller.open();
    expect(h.windows).toHaveLength(1);
    expect(h.windows[0].mode).toBe("display");
    expect(h.windows[0].bounds).toEqual(projector.bounds);
    expect(status).toMatchObject({ open: true, mode: "display", displayId: 7, message: "Showing on Display 2." });
    expect(h.saved()).toBe(7);
  });

  it("falls back to a window when the remembered display is not connected, and says why", () => {
    const h = harness(7);
    h.setDisplays([main]);
    const status = h.controller.open();
    expect(h.windows[0].mode).toBe("window");
    expect(h.windows[0].bounds).toMatchObject({ width: 1280, height: 720 });
    expect(status.message).toBe("The chosen display is not connected. Showing in a window.");
    expect(status.displayId).toBe(7);
  });

  it("moves a window onto its display when the display is plugged back in mid-show", () => {
    const h = harness(7);
    h.setDisplays([main]);
    h.controller.open();
    h.setDisplays([main, projector]);
    const status = h.controller.displaysChanged();
    expect(h.windows).toHaveLength(2);
    expect(h.windows[0].destroy).toHaveBeenCalled();
    expect(h.windows[1]).toMatchObject({ mode: "display" });
    expect(status?.message).toBe("Showing on Display 2.");
  });

  it("falls back to a window when its display is unplugged mid-show, without throwing", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    h.controller.open();
    h.setDisplays([main]);
    const status = h.controller.displaysChanged();
    expect(h.windows[0].destroy).toHaveBeenCalled();
    expect(h.windows[1]).toMatchObject({ mode: "window" });
    expect(status?.open).toBe(true);
    expect(status?.message).toBe("The chosen display is not connected. Showing in a window.");
  });

  it("refits the window when its display changes size, and does nothing when no window is open", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    expect(h.controller.displaysChanged()).toBeNull();
    h.controller.open();
    const resized = { ...projector, bounds: { ...projector.bounds, width: 1280, height: 720 } };
    h.setDisplays([main, resized]);
    h.controller.displaysChanged();
    expect(h.windows[0].setBounds).toHaveBeenCalledWith(resized.bounds);
    expect(h.windows).toHaveLength(1);
  });

  it("does not change playback when the performer closes the window: it only reports that it is closed", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    h.controller.open();
    h.windows[0].hooks.onClosed();
    const last = h.statuses.at(-1);
    expect(last).toMatchObject({ open: false, mode: null, displayId: 7 });
    expect(last?.message).toBe("Audience display is off. Display 2 is ready.");
  });

  it("keeps the latest state, sends updates to an open window, and replays the state when the page loads", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    const first: AudienceUpdate = { model: model(), clock: { songKey: "song-1", songPosition: 4, at: 100, rate: 1, playing: true } };
    h.controller.publish(first);
    h.controller.open();
    const window = h.windows[0];
    h.controller.publish({ model: null, clock: { songKey: "song-1", songPosition: 5, at: 200, rate: 1, playing: true } });
    expect(window.send).toHaveBeenCalledWith({ model: null, clock: expect.objectContaining({ songPosition: 5 }) });
    window.hooks.onLoaded();
    expect(window.send).toHaveBeenLastCalledWith({ model: model(), clock: expect.objectContaining({ songPosition: 5 }) });
  });

  it("ignores the close of a window it has already replaced", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    h.controller.open();
    h.setDisplays([main]);
    h.controller.displaysChanged();
    const replaced = h.windows[0];
    replaced.hooks.onClosed();
    expect(h.controller.status()).toMatchObject({ open: true, mode: "window" });
  });

  it("shows an error and closes the window when the page cannot load", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    h.controller.open();
    h.windows[0].hooks.onError("The audience view could not load.");
    expect(h.controller.status()).toMatchObject({ open: false, message: "The audience view could not load." });
  });

  it("closes the window on close and on dispose", () => {
    const h = harness(7);
    h.setDisplays([main, projector]);
    h.controller.open();
    expect(h.controller.close()).toMatchObject({ open: false });
    expect(h.windows[0].destroy).toHaveBeenCalled();
    h.controller.open();
    h.controller.dispose();
    expect(h.windows[1].destroy).toHaveBeenCalled();
  });

  it("is a window when no display was chosen, and says the display is off before it is opened", () => {
    const h = harness();
    expect(h.controller.status()).toMatchObject({ open: false, displayId: null, message: "Audience display is off." });
    h.controller.open();
    expect(h.windows[0].mode).toBe("window");
    expect(h.controller.choose(null).message).toBe("Showing in a window.");
  });
});

describe("parseDisplayId", () => {
  it("accepts null (a window) and a whole non-negative number", () => {
    expect(parseDisplayId(null)).toBeNull();
    expect(parseDisplayId(0)).toBe(0);
    expect(parseDisplayId(7)).toBe(7);
  });

  it("refuses anything else", () => {
    for (const value of [-1, 1.5, "7", Number.NaN, Number.MAX_VALUE, undefined, {}]) {
      expect(() => parseDisplayId(value), String(value)).toThrow("Choose a display");
    }
  });
});

describe("the remembered display file", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vltn-audience-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a display, and reads a missing or damaged file as no display", async () => {
    const path = join(dir, "audience.json");
    expect(readDisplayId(path)).toBeNull();
    writeDisplayId(path, 7);
    expect(readDisplayId(path)).toBe(7);
    writeDisplayId(path, null);
    expect(readDisplayId(path)).toBeNull();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{not json");
    expect(readDisplayId(path)).toBeNull();
    await writeFile(path, JSON.stringify({ displayId: "7" }));
    expect(readDisplayId(path)).toBeNull();
  });
});

describe("the audience IPC", () => {
  const mainContents = { id: 11 };
  const other = { sender: { id: 99 } };
  const fromMain = { sender: mainContents };
  beforeEach(() => {
    ipc.handlers.clear();
    registerDisplayIpc(() => ({ webContents: mainContents }) as never);
  });

  it("refuses every audience call from a window other than the performance screen", async () => {
    for (const channel of ["audience:status", "audience:open", "audience:close", "audience:publish"]) {
      const result = await ipc.handlers.get(channel)!(other, {});
      expect(result, channel).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    }
  });

  it("refuses an update that is not valid, and accepts one that is", async () => {
    const bad = await ipc.handlers.get("audience:publish")!(fromMain, { model: { screen: "shell" }, clock: null });
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid" } });
    const good = await ipc.handlers.get("audience:publish")!(fromMain, { model: null, clock: null });
    expect(good).toEqual({ ok: true, data: undefined });
  });

  it("refuses a display id that is not a number", async () => {
    const bad = await ipc.handlers.get("audience:chooseDisplay")!(fromMain, "7");
    expect(bad).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("reports the audience as off to the performance screen when it asks for the status", async () => {
    const result = await ipc.handlers.get("audience:status")!(fromMain);
    expect(result).toMatchObject({ ok: true, data: { open: false, displayId: null } });
  });
});

describe("audience content check", () => {
  it("recognises no web contents until an audience window exists", () => {
    expect(isAudienceContents({ id: 3 })).toBe(false);
    expect(isAudienceContents(null)).toBe(false);
  });
});

describe("sendAudienceStatus", () => {
  const status = { open: false, displayId: null } as AudienceStatus;

  it("sends nothing when the performance window is gone, as it is during quit", () => {
    const send = vi.fn();
    sendAudienceStatus(() => null, status);
    sendAudienceStatus(() => ({ isDestroyed: () => true, webContents: { send, isDestroyed: () => false } }) as never, status);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when the performance window's web contents are destroyed", () => {
    const send = vi.fn();
    sendAudienceStatus(() => ({ isDestroyed: () => false, webContents: { send, isDestroyed: () => true } }) as never, status);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the status to the performance window otherwise", () => {
    const send = vi.fn();
    sendAudienceStatus(() => ({ isDestroyed: () => false, webContents: { send, isDestroyed: () => false } }) as never, status);
    expect(send).toHaveBeenCalledWith("audience:status", status);
  });
});
