import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTones } from "@/screens/tones/store";
import type { BassTone, ToneBlock } from "@/song/band/arrangement";
import { BassToneChain } from "./BassToneChain";

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
const file = (name: string) => ({ source: "file" as const, path: `/music/${name}`, name });
const amp: ToneBlock = { type: "capture", role: "amp", file: file("amp.nam"), inputDb: 0, outputDb: 0, mix: 1, on: true };
const cab: ToneBlock = { type: "ir", role: "cab", file: file("cab.wav"), inputDb: 0, outputDb: 0, mix: 1, on: true };
const pedal: ToneBlock = { type: "capture", role: "pedal", file: file("comp.nam"), inputDb: -3, outputDb: 2, mix: 0.5, on: true };
const emptyPedal: ToneBlock = { type: "capture", role: "pedal", file: null, inputDb: 0, outputDb: 0, mix: 1, on: true };
const chainOf = (blocks: ToneBlock[], extra: { dryWet?: number; fast?: boolean } = {}): BassTone => ({
  kind: "chain",
  blocks,
  dryWet: extra.dryWet ?? 1,
  fast: extra.fast ?? false,
});

function renderChain(tone: BassTone, songSeconds = 0) {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <BassToneChain tone={tone} songSeconds={songSeconds} onChange={onChange} />
    </TooltipProvider>,
  );
  return onChange;
}

/** The thumb of a slider, found from its root: the slider root carries the aria-label, as in BandSettingsForm. */
const thumb = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"] [role="slider"]`)!;

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

describe("BassToneChain", () => {
  it("is clean by default, offers the presets, and has no blocks to edit", () => {
    renderChain(clean);
    expect(screen.getByText("Clean, as generated")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Driven bass" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("list", { name: "Bass tone blocks" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clean bass" })).toBeNull();
  });

  it("starts from a preset as empty slots with their roles set", () => {
    const onChange = renderChain(clean);
    fireEvent.click(screen.getByRole("button", { name: "Studio bass" }));
    expect(onChange).toHaveBeenCalledWith({
      kind: "chain",
      dryWet: 1,
      fast: false,
      blocks: [
        { type: "capture", role: "pedal", file: null, inputDb: 0, outputDb: 0, mix: 1, on: true },
        { type: "capture", role: "amp", file: null, inputDb: 0, outputDb: 0, mix: 1, on: true },
        { type: "ir", role: "cab", file: null, inputDb: 0, outputDb: 0, mix: 1, on: true },
        { type: "ir", role: "space", file: null, inputDb: 0, outputDb: 0, mix: 0.2, on: true },
      ],
    });
  });

  it("lists the blocks in order, with an empty slot marked and the chain summary", () => {
    renderChain(chainOf([pedal, amp, emptyPedal, cab]));
    const items = document.querySelectorAll('[aria-label="Bass tone blocks"] > li');
    expect(items).toHaveLength(4);
    expect(screen.getByText("comp.nam → amp.nam → Pedal, empty → cab.wav")).toBeTruthy();
    expect(screen.getByText("Empty slot")).toBeTruthy();
  });

  it("adds a block at the end, with the picker preset to its role, and saves the chosen file", async () => {
    mocks.tones.chooseLocalFile.mockResolvedValueOnce({ path: "/music/new.nam", name: "new.nam" });
    const onChange = renderChain(chainOf([amp]));
    fireEvent.click(screen.getByRole("button", { name: "Add pedal…" }));
    expect(await screen.findByText("Choose a bass pedal")).toBeTruthy();
    expect(useTones.getState().format).toBe("nam");
    expect(useTones.getState().search.gears).toEqual(["pedal"]);
    fireEvent.click(screen.getByRole("button", { name: "Open a .nam file…" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        chainOf([
          amp,
          { type: "capture", role: "pedal", file: { source: "file", path: "/music/new.nam", name: "new.nam" }, inputDb: 0, outputDb: 0, mix: 1, on: true },
        ]),
      ),
    );
    expect(useTones.getState().search.query).toBe("");
  });

  it("adds a cab IR and a space IR, each with a .wav file and its own gear", async () => {
    mocks.tones.chooseLocalFile.mockResolvedValue({ path: "/music/room.wav", name: "room.wav" });
    const onChange = renderChain(chainOf([amp]));
    fireEvent.click(screen.getByRole("button", { name: "Add space IR…" }));
    expect(await screen.findByText("Choose a space IR")).toBeTruthy();
    expect(useTones.getState().search.gears).toEqual(["space"]);
    fireEvent.click(screen.getByRole("button", { name: "Open a .wav file…" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        chainOf([
          amp,
          { type: "ir", role: "space", file: { source: "file", path: "/music/room.wav", name: "room.wav" }, inputDb: 0, outputDb: 0, mix: 1, on: true },
        ]),
      ),
    );
  });

  it("fills an empty slot in place, and keeps the blocks around it", async () => {
    mocks.tones.chooseLocalFile.mockResolvedValueOnce({ path: "/music/comp.nam", name: "comp.nam" });
    const onChange = renderChain(chainOf([amp, emptyPedal]));
    fireEvent.click(screen.getByRole("button", { name: "Choose…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open a .nam file…" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(chainOf([amp, { ...emptyPedal, file: { source: "file", path: "/music/comp.nam", name: "comp.nam" } }])),
    );
  });

  it("moves a block up and down, and removes one", () => {
    const onChange = renderChain(chainOf([pedal, amp, cab]));
    fireEvent.click(screen.getByRole("button", { name: "Move Amp 2 up" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf([amp, pedal, cab]));
    fireEvent.click(screen.getByRole("button", { name: "Move Pedal 1 down" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf([amp, pedal, cab]));
    expect((screen.getByRole("button", { name: "Move Pedal 1 up" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove Cab IR 3" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf([pedal, amp]));
  });

  it("switches a block off and on, without removing it", () => {
    const onChange = renderChain(chainOf([pedal, amp]));
    fireEvent.click(screen.getByRole("switch", { name: "Pedal 1 on" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf([{ ...pedal, on: false }, amp]));
  });

  it("sets a block's drive, output and mix from its sliders, and saves the mix as a fraction", () => {
    const onChange = renderChain(chainOf([amp]));
    fireEvent.keyDown(thumb("Amp 1 mix"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(chainOf([{ ...amp, mix: 0.95 }]));
    fireEvent.keyDown(thumb("Amp 1 input"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(chainOf([{ ...amp, inputDb: 1 }]));
    fireEvent.keyDown(thumb("Amp 1 output"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(chainOf([{ ...amp, outputDb: -1 }]));
  });

  it("sets the chain's dry/wet and the fast render", () => {
    const onChange = renderChain(chainOf([amp], { dryWet: 1 }));
    fireEvent.keyDown(thumb("Bass tone chain mix"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(chainOf([amp], { dryWet: 0.95 }));
    fireEvent.click(screen.getByRole("switch", { name: "Fast render" }));
    expect(onChange).toHaveBeenLastCalledWith(chainOf([amp], { fast: true }));
  });

  it("stops adding at six blocks, and says why", () => {
    const six = [amp, amp, amp, amp, amp, amp];
    renderChain(chainOf(six));
    expect((screen.getByRole("button", { name: "Add pedal…" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Six blocks is the most a chain holds.")).toBeTruthy();
  });

  it("gives a render-time estimate for the song, from its captures, and less for Fast render", () => {
    const { unmount } = renderTone(chainOf([amp, cab]), 480);
    expect(screen.getByText("About 38 s at Generate for this song.")).toBeTruthy();
    unmount();
    renderTone(chainOf([amp, cab], { fast: true }), 480);
    expect(screen.getByText("About 24 s at Generate for this song.")).toBeTruthy();
  });

  it("says a chain of IRs alone is quick, and gives no estimate for an empty song", () => {
    const { unmount } = renderTone(chainOf([cab]), 480);
    expect(screen.getByText("Only IRs: a few seconds at Generate.")).toBeTruthy();
    unmount();
    renderTone(chainOf([amp]), 0);
    expect(screen.queryByText(/at Generate for this song/)).toBeNull();
  });

  it("disables the chain in the web build, and says it needs the desktop app", () => {
    mocks.electron.value = false;
    renderChain(chainOf([amp]));
    expect(screen.getByText("Bass tones need the desktop app.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Change…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add pedal…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

/** Renders a chain for a test that wants to unmount it and draw another. */
function renderTone(tone: BassTone, songSeconds: number) {
  return render(
    <TooltipProvider>
      <BassToneChain tone={tone} songSeconds={songSeconds} onChange={vi.fn()} />
    </TooltipProvider>,
  );
}
