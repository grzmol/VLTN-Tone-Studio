import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSongMap, type SongMap } from "@/song/songmap/songmap";
import { useSongMapUndo } from "@/song/songmap/undo";
import { SongMapImport } from "./SongMapImport";

const mocks = vi.hoisted(() => ({
  values: new Map<string, string>(),
  flush: vi.fn(async () => {}),
  setSetting: vi.fn(),
  library: { queue: [] as string[], position: 0, load: vi.fn(async () => {}) },
  saveFiles: vi.fn(async (files: { name: string }[]) => files[0].name),
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
vi.mock("@/host", () => ({ host: { song: { saveFiles: mocks.saveFiles } } }));

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

function renderCard(props: { libraryId?: string; playing?: boolean; title?: string; durationSeconds?: number } = {}) {
  return render(
    <SongMapImport
      songKey={KEY}
      libraryId={"libraryId" in props ? props.libraryId : "song-1"}
      playing={props.playing ?? false}
      title={props.title}
      durationSeconds={props.durationSeconds}
    />,
  );
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
  useSongMapUndo.setState({ record: null });
  mocks.values.clear();
  mocks.values.set(KEY + ":bpm", "100");
  mocks.values.set(KEY + ":options", JSON.stringify({ mixer: 2 }));
  mocks.values.set(KEY, "");
  mocks.library.queue = [];
  mocks.library.position = 0;
  mocks.setSetting.mockClear();
  mocks.flush.mockClear();
  mocks.library.load.mockClear();
  mocks.saveFiles.mockClear();
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

  it("says so when the map matches the song, and offers nothing to apply", () => {
    renderCard();
    paste("---\nsongmap: 1\nbpm: 100\n---\n");
    expect(screen.getByText("This song map matches the song. There is nothing to change.")).toBeTruthy();
    expect(disabled("Apply")).toBe(true);
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

  it("keeps the status and Undo when the card remounts after the song reloads", async () => {
    const before = JSON.stringify({ mixer: 2 });
    const first = renderCard();
    paste(mapText());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy());
    // Apply reloads the song, which remounts the panel and this card.
    first.unmount();
    renderCard();
    expect(status()).toBe("Song map applied: tempo, sections, drums and bass, 1 bass note.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(status()).toBe("Song map undone."));
    expect(mocks.values.get(KEY + ":options")).toBe(before);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
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

describe("SongMapImport song brief", () => {
  it("is disabled for a song with no audio", () => {
    renderCard({ title: "Test song", durationSeconds: 0 });
    expect(disabled("Export song brief…")).toBe(true);
    expect(disabled("Copy brief")).toBe(true);
  });

  it("saves the brief under the song's name, through the same save path as the chart export", async () => {
    mocks.values.set(KEY, "[00:00.50] [Am]Hello");
    renderCard({ title: "Test song", durationSeconds: 61 });
    fireEvent.click(screen.getByRole("button", { name: "Export song brief…" }));
    await waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledTimes(1));
    const [files, label] = mocks.saveFiles.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }[], string];
    expect(label).toBe("Export song brief");
    expect(files[0].name).toBe("Test song - song brief.md");
    const text = new TextDecoder().decode(files[0].bytes);
    expect(text.startsWith("# Song brief: Test song\n")).toBe(true);
    expect(text).toContain("[00:00.50] [Am]Hello");
  });

  it("replaces the characters a file name cannot hold", async () => {
    renderCard({ title: "AC/DC: Live?", durationSeconds: 61 });
    fireEvent.click(screen.getByRole("button", { name: "Export song brief…" }));
    await waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledTimes(1));
    const [files] = mocks.saveFiles.mock.calls[0] as unknown as [{ name: string }[]];
    expect(files[0].name).toBe("AC-DC- Live- - song brief.md");
  });

  it("says why the brief could not be saved", async () => {
    mocks.saveFiles.mockRejectedValueOnce(new Error("disk full"));
    renderCard({ title: "Test song", durationSeconds: 61 });
    fireEvent.click(screen.getByRole("button", { name: "Export song brief…" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The song brief could not be saved: disk full"));
  });

  it("copies the brief to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderCard({ title: "Test song", durationSeconds: 61 });
    fireEvent.click(screen.getByRole("button", { name: "Copy brief" }));
    await waitFor(() => expect(status()).toBe("Song brief copied."));
    expect(writeText.mock.calls[0][0].startsWith("# Song brief: Test song\n")).toBe(true);
  });
});
