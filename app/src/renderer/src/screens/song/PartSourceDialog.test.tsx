import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { T3kTone } from "@shared/host/tones";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTones } from "@/screens/tones/store";
import { PartSourceDialog, presetBassSearch, presetPartSearch, restoreBassSearch, type BassSourceRole } from "./PartSourceDialog";

const mocks = vi.hoisted(() => ({
  tones: {
    account: vi.fn(),
    search: vi.fn(),
    models: vi.fn(),
    downloadModel: vi.fn(),
    image: vi.fn(async () => null),
    local: vi.fn(async () => []),
    chooseLocalFile: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
}));

vi.mock("@/host", () => ({ host: { tones: mocks.tones }, isElectron: true }));
// The real device store: the cards read the connected pedal, which is disconnected here.
vi.mock("@/state/device", async (importOriginal) => importOriginal<typeof import("@/state/device")>());

const SIGNED_IN = {
  status: "signed-in",
  user: { id: 1, username: "me", display_name: null, avatar_url: null, url: "https://www.tone3000.com/me" },
  configured: true,
  appKey: null,
  splashSeen: true,
  insecureStorage: false,
};
const SIGNED_OUT = { ...SIGNED_IN, status: "signed-out", user: null };

function tone(id: number, title: string, format: "nam" | "ir"): T3kTone {
  return {
    id,
    title,
    description: null,
    gear: format === "ir" ? "cab" : "amp",
    images: null,
    format,
    license: "t3k",
    sizes: ["standard"],
    makes: [],
    models_count: 2,
    a1_models_count: 1,
    a2_models_count: 1,
    custom_models_count: 0,
    irs_count: 0,
    downloads_count: 0,
    favorites_count: 0,
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    published_at: null,
    url: `https://www.tone3000.com/tones/${id}`,
    user: { id: 9, username: "tone_maker", display_name: null, avatar_url: null, url: "https://www.tone3000.com/tone_maker" },
  } as T3kTone;
}

function results(tones: T3kTone[]) {
  return { tones, page: 1, totalPages: 1, total: tones.length, fetchedAt: 1 };
}

function signIn(status: "signed-in" | "signed-out") {
  useTones.setState({ account: (status === "signed-in" ? SIGNED_IN : SIGNED_OUT) as never });
}

/** jsdom has no layout or observers: the grid's infinite scroll watches a sentinel, which does nothing here. */
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObserverStub);
  vi.stubGlobal("IntersectionObserver", ObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  useTones.setState({
    format: "all",
    search: { query: "", sort: "trending", gears: [], architecture: null },
    found: { tones: [], page: 0, totalPages: 1, total: 0, fetchedAt: 0, loading: false, error: null, loaded: false },
  });
  mocks.tones.search.mockReset();
  mocks.tones.search.mockImplementation(async () => results([tone(42, "Bass amp", "nam"), tone(43, "Bass cab", "ir")]));
  mocks.tones.models.mockReset();
  mocks.tones.models.mockResolvedValue([
    { id: 7, name: "A1 model", size: "standard", tone_id: 42, architecture_version: "1", model_url: "", updated_at: "" },
    { id: 8, name: "A2 model", size: "standard", tone_id: 42, architecture_version: "2", model_url: "", updated_at: "" },
  ]);
  mocks.tones.downloadModel.mockReset();
  mocks.tones.downloadModel.mockResolvedValue({ path: "/tones/42/a2.nam", bytes: 10, record: { title: "Bass amp" } });
  mocks.tones.chooseLocalFile.mockReset();
});
afterEach(() => {
  cleanup();
  restoreBassSearch();
  vi.unstubAllGlobals();
});

function renderDialog(role: BassSourceRole, onPick = vi.fn(), onClose = vi.fn(), part: "bass" | "drums" = "bass") {
  presetPartSearch(part, role);
  render(
    <TooltipProvider>
      <PartSourceDialog part={part} role={role} open onClose={onClose} onPick={onPick} />
    </TooltipProvider>,
  );
  return { onPick, onClose };
}

describe("PartSourceDialog", () => {
  it("starts the TONE3000 search on the bass preset, and lists only the captures for a capture", async () => {
    signIn("signed-in");
    renderDialog("amp");
    expect(await screen.findByText("Bass amp")).toBeTruthy();
    expect(screen.queryByText("Bass cab")).toBeNull();
    expect(mocks.tones.search).toHaveBeenCalledWith(expect.objectContaining({ query: "bass", gears: ["amp", "amp-cab"] }), 1, undefined);
  });

  it("lists only the cab IRs for a cab IR", async () => {
    signIn("signed-in");
    renderDialog("cab");
    expect(await screen.findByText("Bass cab")).toBeTruthy();
    expect(screen.queryByText("Bass amp")).toBeNull();
  });

  it("picks a tone by downloading its A2 model, and hands the tone on", async () => {
    signIn("signed-in");
    const { onPick } = renderDialog("amp");
    fireEvent.click(await screen.findByText("Bass amp"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ source: "tone3000", toneId: 42, modelId: 8, name: "Bass amp" }));
    expect(mocks.tones.downloadModel).toHaveBeenCalledWith(42, 8);
  });

  it("opens a .nam file by its path, and picks nothing when the file dialog is cancelled", async () => {
    signIn("signed-out");
    mocks.tones.chooseLocalFile.mockResolvedValueOnce({ path: "/Users/me/bass.nam", name: "bass" });
    const { onPick } = renderDialog("amp");
    fireEvent.click(screen.getByRole("button", { name: "Open a .nam file…" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ source: "file", path: "/Users/me/bass.nam", name: "bass" }));
    expect(mocks.tones.chooseLocalFile).toHaveBeenCalledWith("nam");

    mocks.tones.chooseLocalFile.mockResolvedValueOnce(null);
    onPick.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open a .nam file…" }));
    await waitFor(() => expect(mocks.tones.chooseLocalFile).toHaveBeenCalledTimes(2));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("starts each role on its own gear: a pedal, a preamp, an amp, a cab and a space", () => {
    const gearsFor = (role: BassSourceRole) => {
      presetBassSearch(role);
      const { format, search } = useTones.getState();
      restoreBassSearch();
      return { format, gears: search.gears };
    };
    expect(gearsFor("pedal")).toEqual({ format: "nam", gears: ["pedal"] });
    expect(gearsFor("preamp")).toEqual({ format: "nam", gears: ["outboard"] });
    expect(gearsFor("amp")).toEqual({ format: "nam", gears: ["amp", "amp-cab"] });
    expect(gearsFor("cab")).toEqual({ format: "ir", gears: ["cab"] });
    expect(gearsFor("space")).toEqual({ format: "ir", gears: ["space"] });
  });

  it("marks an A1 capture as older, and takes the A2 model when there is one", async () => {
    signIn("signed-in");
    mocks.tones.models.mockResolvedValueOnce([
      { id: 7, name: "A1 model", size: "standard", tone_id: 42, architecture_version: "1", model_url: "", updated_at: "" },
    ]);
    const { onPick } = renderDialog("amp");
    fireEvent.click(await screen.findByText("Bass amp"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp", older: true }));
  });

  it("asks for a sign-in on the Tones screen when signed out, and still offers a file", async () => {
    signIn("signed-out");
    renderDialog("cab");
    expect(screen.getByText(/Sign in to TONE3000 on the Tones screen to search its cab IRs here/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open a .wav file…" })).toBeTruthy();
    expect(mocks.tones.search).not.toHaveBeenCalled();
  });
});

describe("presetBassSearch and restoreBassSearch", () => {
  it("put the browser's own filters back when the picker closes", () => {
    useTones.setState({ format: "all", search: { query: "marshall", sort: "newest", gears: ["pedal"], architecture: "2" } });
    signIn("signed-out");
    presetBassSearch("cab");
    expect(useTones.getState().format).toBe("ir");
    expect(useTones.getState().search).toEqual({ query: "bass", sort: "trending", gears: ["cab"], architecture: null });
    restoreBassSearch();
    expect(useTones.getState().format).toBe("all");
    expect(useTones.getState().search).toEqual({ query: "marshall", sort: "newest", gears: ["pedal"], architecture: "2" });
  });
});

describe("PartSourceDialog for the drums", () => {
  it("searches the outboard gear for an outboard capture, with no bass word", async () => {
    signIn("signed-in");
    renderDialog("outboard", vi.fn(), vi.fn(), "drums");
    expect(await screen.findByText("Choose an outboard capture")).toBeTruthy();
    expect(await screen.findByText("Bass amp")).toBeTruthy();
    expect(mocks.tones.search).toHaveBeenCalledWith(expect.objectContaining({ query: "", gears: ["outboard"] }), 1, undefined);
  });

  it("searches the space IRs for a space IR, and lists only IRs", async () => {
    signIn("signed-in");
    renderDialog("space", vi.fn(), vi.fn(), "drums");
    expect(await screen.findByText("Bass cab")).toBeTruthy();
    expect(screen.queryByText("Bass amp")).toBeNull();
    expect(mocks.tones.search).toHaveBeenCalledWith(expect.objectContaining({ query: "", gears: ["space"] }), 1, undefined);
  });

  it("offers a .wav file on this computer for a space IR", async () => {
    signIn("signed-out");
    const { onPick } = renderDialog("space", vi.fn(), vi.fn(), "drums");
    mocks.tones.chooseLocalFile.mockResolvedValueOnce({ path: "/music/room.wav", name: "room.wav" });
    fireEvent.click(screen.getByRole("button", { name: "Open a .wav file…" }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith({ source: "file", path: "/music/room.wav", name: "room.wav" }));
    expect(mocks.tones.chooseLocalFile).toHaveBeenCalledWith("ir");
  });
});
