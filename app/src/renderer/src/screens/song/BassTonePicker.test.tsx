import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTones } from "@/screens/tones/store";
import type { BassTone, BassToneFile, ToneBlock } from "@/song/band/arrangement";
import { BassTonePicker } from "./BassTonePicker";

const mocks = vi.hoisted(() => ({
  electron: { value: true },
  tones: {
    account: vi.fn(),
    search: vi.fn(),
    image: vi.fn(async () => null),
    local: vi.fn(async () => []),
    chooseLocalFile: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}));

vi.mock("@/host", () => ({
  host: { tones: mocks.tones },
  get isElectron() {
    return mocks.electron.value;
  },
}));
vi.mock("@/state/device", async (importOriginal) => importOriginal<typeof import("@/state/device")>());

const SIGNED_OUT = { status: "signed-out", user: null, configured: true, appKey: null, splashSeen: true, insecureStorage: false };

const clean: BassTone = { kind: "clean" };
const tunedCapture = { source: "file", path: "/music/bass.nam", name: "Bass amp" } as const;
const tunedIr = { source: "file", path: "/music/cab.wav", name: "4x10 cab" } as const;
/** A chain of one amp and one cab, as the picker saves it. */
function chainOf(stage: { capture: BassToneFile; ir: BassToneFile | null; inputDb: number; outputDb: number; blend: number }): BassTone {
  const blocks: ToneBlock[] = [{ type: "capture", role: "amp", file: stage.capture, inputDb: stage.inputDb, outputDb: stage.outputDb, mix: 1, on: true }];
  if (stage.ir) blocks.push({ type: "ir", role: "cab", file: stage.ir, inputDb: 0, outputDb: 0, mix: 1, on: true });
  return { kind: "chain", blocks, dryWet: stage.blend, fast: false };
}
const tuned = chainOf({ capture: tunedCapture, ir: tunedIr, inputDb: 3, outputDb: -2, blend: 1 });

/** The thumb of a slider, found from its root: the slider root carries the aria-label, as in BandSettingsForm. */
const thumb = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"] [role="slider"]`)!;

function renderPicker(tone: BassTone) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <BassTonePicker tone={tone} onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
}

beforeEach(() => {
  mocks.electron.value = true;
  mocks.tones.account.mockResolvedValue(SIGNED_OUT);
  mocks.tones.search.mockResolvedValue({ tones: [], page: 1, totalPages: 1, total: 0, fetchedAt: 1 });
  mocks.tones.chooseLocalFile.mockReset();
  useTones.setState({ account: null, format: "all", search: { query: "", sort: "trending", gears: [], architecture: null } });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BassTonePicker", () => {
  it("is clean by default, offers a capture, and shows no gain or cab IR controls", () => {
    renderPicker(clean);
    expect(screen.getByText("Clean, as generated")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Choose capture…" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Clean bass" })).toBeNull();
    expect(thumb("Bass tone blend")).toBeNull();
  });

  it("shows the capture with its cab IR, and the drive, output and blend", () => {
    renderPicker(tuned);
    expect(screen.getByText("Bass amp with 4x10 cab")).toBeTruthy();
    expect(screen.getByText("Drive 3 dB")).toBeTruthy();
    expect(screen.getByText("Output -2 dB")).toBeTruthy();
    expect(screen.getByText("Blend 100% amp")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change cab IR…" })).toBeTruthy();
    expect(thumb("Bass tone blend")).toBeTruthy();
  });

  it("moves the blend from the keyboard, and saves it as a fraction", () => {
    const onChange = renderPicker(tuned);
    fireEvent.keyDown(thumb("Bass tone blend"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "chain", dryWet: 0.95 }));
  });

  it("gives the clean bass back, and takes the cab IR off without touching the capture", () => {
    const onChange = renderPicker(tuned);
    fireEvent.click(screen.getByRole("button", { name: "No cab IR" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf({ capture: tunedCapture, ir: null, inputDb: 3, outputDb: -2, blend: 1 }));
    fireEvent.click(screen.getByRole("button", { name: "Clean bass" }));
    expect(onChange).toHaveBeenLastCalledWith({ kind: "clean" });
  });

  it("disables the picker in the web build, and says it needs the desktop app", () => {
    mocks.electron.value = false;
    renderPicker(tuned);
    expect(screen.getByText("Bass tones need the desktop app.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Change capture…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Change cab IR…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the capture search on the bass preset, and puts the browser's own filters back when it closes", async () => {
    useTones.setState({ search: { query: "marshall", sort: "newest", gears: [], architecture: null } });
    renderPicker(clean);
    fireEvent.click(screen.getByRole("button", { name: "Choose capture…" }));
    expect(await screen.findByText("Choose a bass capture")).toBeTruthy();
    expect(useTones.getState().format).toBe("nam");
    expect(useTones.getState().search.query).toBe("bass");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(useTones.getState().search.query).toBe("marshall"));
    expect(useTones.getState().format).toBe("all");
  });

  it("sets a capture from a file and keeps the cab IR and the levels", async () => {
    mocks.tones.chooseLocalFile.mockResolvedValueOnce({ path: "/music/new.nam", name: "new" });
    const onChange = renderPicker(tuned);
    fireEvent.click(screen.getByRole("button", { name: "Change capture…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open a .nam file…" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        chainOf({ capture: { source: "file", path: "/music/new.nam", name: "new" }, ir: tunedIr, inputDb: 3, outputDb: -2, blend: 1 }),
      ),
    );
  });
});
