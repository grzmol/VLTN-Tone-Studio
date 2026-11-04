import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSongMap, type SongMap } from "@/song/songmap/songmap";
import { SongMapImport } from "./SongMapImport";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  flush: vi.fn(async () => {}),
  setSetting: vi.fn(),
  library: { queue: [] as string[], position: 0, load: vi.fn(async () => {}) },
}));

vi.mock("@/song/performance/settings", () => ({
  getSetting: (key: string, suffix: string) => mocks.values.get(key + suffix) ?? "",
  setSetting: (key: string, suffix: string, value: string) => {
    mocks.setSetting(key, suffix, value);
    mocks.values.set(key + suffix, value);
  },
  readOptions: <T,>(key: string, defaults: T): T => ({ ...defaults, ...JSON.parse(mocks.values.get(key + ":options") || "{}") }),
  flushSettings: () => mocks.flush(),
}));
vi.mock("@/song/library", () => ({ useSongLibrary: { getState: () => mocks.library } }));

const KEY = "vltn.song:song-1";

/** A map as the writer makes it, so the test reads the same format the assistant's file has. */
function mapText(extra: Partial<SongMap> = {}): string {
  const map: SongMap = {
    title: "Test song",
    bpm: 120,
    beatsPerBar: 4,
    meterText: "4/4",
    firstBeat: 0.5,
    sections: [
      { start: 0, end: 20, name: "Verse", drums: true, bass: "groove" },
      { start: 20, end: 40, name: "Chorus", drums: false, bass: "off", energy: 4 },
    ],
    bassNotes: [{ start: 2, end: 4, pc: 7 }],
    extra: {},
    ignored: [],
    ...extra,
  };
  return writeSongMap(map);
}

function renderCard(props: { libraryId?: string; playing?: boolean } = {}) {
  return render(<SongMapImport songKey={KEY} libraryId={"libraryId" in props ? props.libraryId : "song-1"} playing={props.playing ?? false} />);
}

function disabled(name: string): boolean {
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}
function checked(name: RegExp | string): boolean {
  const box = screen.getByRole("checkbox", { name: typeof name === "string" ? new RegExp(`^${name}`) : name });
  return box.getAttribute("aria-checked") === "true";
}
/** The status line the card shows after Apply or Undo. */
function status(): string {
  return screen.getByRole("status").querySelector("span")?.textContent ?? "";
}

/** Opens the dialog, pastes the text, and returns the textarea. */
function paste(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Paste…" }));
  const area = screen.getByLabelText("Song map text");
  fireEvent.change(area, { target: { value: text } });
  return area;
}

beforeEach(() => {
  mocks.values.clear();
  mocks.values.set(KEY + ":bpm", "100");
  mocks.values.set(KEY + ":options", JSON.stringify({ mixer: 2 }));
  mocks.values.set(KEY, "");
  mocks.library.queue = [];
  mocks.library.position = 0;
  mocks.setSetting.mockClear();
  mocks.flush.mockClear();
  mocks.library.load.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SongMapImport card", () => {
  it("is disabled for a song that is not saved", () => {
    renderCard({ libraryId: undefined });
    expect(disabled("Paste…")).toBe(true);
    expect(disabled("Import song map…")).toBe(true);
  });

  it("is disabled while the song plays", () => {
    renderCard({ playing: true });
    expect(disabled("Paste…")).toBe(true);
    expect(screen.getByRole("button", { name: "Paste…" }).getAttribute("title")).toBe("Stop the song to import.");
  });
});

describe("SongMapImport dialog", () => {
  it("shows the parts the map changes, and the problems it skipped", () => {
    renderCard();
    paste(mapText().replace("bpm: 120", "bpm: fast"));
    expect(checked("Tempo")).toBe(true);
    expect(checked("2 sections")).toBe(true);
    expect(checked("Drums and bass")).toBe(true);
    expect(checked("1 bass note")).toBe(true);
    expect(screen.getByRole("list", { name: "Problems in the song map" }).textContent).toContain("Skipped:");
  });

  it("leaves the chart unticked when it would replace the song's chart", () => {
    mocks.values.set(KEY, "[Verse]\nA");
    renderCard();
    paste(mapText({ chart: "Verse\n[G]Words" }));
    expect(checked("Chart")).toBe(false);
    expect(screen.getByText("Replaces your chart")).toBeTruthy();
  });

  it("applies only the ticked parts, saves the song and loads it again", async () => {
    renderCard();
    paste(mapText());
    fireEvent.click(screen.getByRole("checkbox", { name: /^Tempo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(mocks.library.load).toHaveBeenCalledWith("song-1", ["song-1"], 0));
    const written = mocks.setSetting.mock.calls.map(([, suffix]) => suffix);
    expect(written).toEqual([":options"]);
    expect(mocks.flush).toHaveBeenCalled();
    const options = JSON.parse(mocks.values.get(KEY + ":options") ?? "{}");
    expect(options.mixer).toBe(2);
    expect(options.sections.map((section: { id: string }) => section.id)).toEqual(["map-1", "map-2"]);
    expect(status()).toBe("Song map applied: sections, drums and bass, 1 bass note.");
  });

  it("puts the song back as it was when Undo is pressed", async () => {
    const before = JSON.stringify({ mixer: 2 });
    renderCard();
    paste(mapText());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(status()).toBe("Song map undone."));
    expect(mocks.values.get(KEY + ":options")).toBe(before);
    expect(mocks.values.get(KEY + ":bpm")).toBe("100");
    expect(mocks.library.load).toHaveBeenCalledTimes(2);
  });
});
