import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { usePedalLibrary } from "@/song/performance/pedal-library";
import { clearSettingsCache, getSetting, LIBRARY_PREFIX, readSettings, seedSettings, setSetting } from "@/song/performance/settings";
import { parseChart } from "@/song/performance/chart";
import { RhythmAutomationSetup } from "./RhythmAutomationSetup";

const api = vi.hoisted(() => ({ updateSettings: vi.fn() }));
vi.mock("@/host", () => ({ host: { song: { library: api } } }));
const songs: LibrarySong[] = Array.from({ length: 6 }, (_, i) => ({
  id: `song-${i}`,
  title: `Song ${i + 1}`,
  artist: "",
  sourceName: "",
  duration: 20,
  audio: [],
  updated: "",
  settings: {
    "": `[00:01] Lyrics ${i + 1}\n[00:02] {midi:pc 4 7}`,
    ":bpm": "120",
    ":options": JSON.stringify({
      unrelated: "kept",
      sections: [
        { id: "verse", name: "Verse", start: 0, end: 10, mode: "continue" },
        { id: "chorus", name: "Chorus", start: 10, end: 18, mode: "continue" },
        { id: "ending", name: "Outro", start: 18, end: 20, mode: "continue" },
      ],
    }),
  },
}));
function Harness({ locked = false }: { locked?: boolean }) {
  const key = LIBRARY_PREFIX + songs[0].id;
  const [chart, setChart] = useState(() => getSetting(key, ""));
  return (
    <RhythmAutomationSetup
      current={{ key, title: songs[0].title, duration: 20, settings: { ...readSettings(key), "": chart } }}
      locked={locked}
      onSaveChart={(value) => {
        setSetting(key, "", value);
        setChart(value);
      }}
    />
  );
}
function pick(name: string, option: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}
const preview = () => fireEvent.click(screen.getByRole("button", { name: "Preview automatic cues" }));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("vltn.card.rhythm-automation", "open");
  clearSettingsCache();
  api.updateSettings.mockReset().mockResolvedValue(undefined);
  useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [{ id: "gig", name: "Gig", songs: songs.map((song) => song.id) }] } });
  usePedalLibrary.setState({ profiles: [], channels: {}, assignments: {} });
  seedSettings(songs[0].id, songs[0].settings);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});
afterEach(() => {
  cleanup();
  clearSettingsCache();
});

describe("RC-10R automatic song setup", () => {
  it("previews without saving, then saves cues alongside lyrics and unrelated settings, and supports undo", async () => {
    render(<Harness />);
    preview();
    expect(api.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("table", { name: "Song 1 automatic rhythm cues" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Song 1: Memory"), { target: { value: "6" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues" }));
    });
    const key = LIBRARY_PREFIX + songs[0].id;
    const chart = getSetting(key, "");
    expect(chart).toContain("Lyrics 1");
    expect(parseChart(chart).find((cue) => cue.trigger === "load")?.messages).toEqual([[0xc1, 5]]);
    expect(JSON.parse(getSetting(key, ":options"))).toMatchObject({ unrelated: "kept", rhythmAutomation: { memory: 6 } });
    expect(usePedalLibrary.getState().assignments).toMatchObject({ "boss-rc10r:rhythm-start": 80, "boss-rc10r:rhythm-stop": 83 });
    expect(api.updateSettings).toHaveBeenCalledWith(songs[0].id, expect.objectContaining({ "": chart }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo cue changes" }));
    });
    expect(getSetting(key, "")).toBe(songs[0].settings[""]);
    expect(getSetting(key, ":options")).toBe(songs[0].settings[":options"]);
  });
  it("assigns the whole playlist in order to memories 1–6, including unopened songs, without replacing existing cues", async () => {
    const unopened = songs.map((song, i) =>
      i !== 1
        ? song
        : {
            ...song,
            settings: {
              ...song.settings,
              "": song.settings[""] + "\n[00:03] [Am]",
              ":options": JSON.stringify({ ...JSON.parse(song.settings[":options"]), generatedParts: { drums: "track0" }, bandOutOfDate: false }),
            },
          },
    );
    useSongLibrary.setState({ index: { ...useSongLibrary.getState().index, songs: unopened } });
    render(<Harness />);
    pick("Rhythm automation scope", "Gig");
    preview();
    expect(screen.getAllByRole("table")).toHaveLength(6);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues for 6 songs" }));
    });
    for (let i = 0; i < songs.length; i++) {
      const key = LIBRARY_PREFIX + songs[i].id;
      expect(getSetting(key, "")).toContain(songs[i].settings[""]);
      expect(parseChart(getSetting(key, "")).find((cue) => cue.trigger === "load")?.messages).toEqual([[0xc1, i]]);
      expect(JSON.parse(getSetting(key, ":options")).unrelated).toBe("kept");
    }
    expect(api.updateSettings).toHaveBeenCalledTimes(6);
    expect(JSON.parse(getSetting(LIBRARY_PREFIX + songs[1].id, ":options")).bandOutOfDate).toBe(false);
    preview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues for 6 songs" }));
    });
    expect(getSetting(LIBRARY_PREFIX + songs[5].id, "").match(/automatic rhythm: begin/g)).toHaveLength(1);
  });
  it("keeps newer edits of unopened songs and refuses stale previews before changing any song", async () => {
    setSetting(LIBRARY_PREFIX + songs[1].id, "", "[00:01] Latest lyrics");
    render(<Harness />);
    pick("Rhythm automation scope", "Gig");
    preview();
    setSetting(LIBRARY_PREFIX + songs[1].id, "", "[00:01] Changed during preview");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues for 6 songs" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("changed since the preview");
    expect(getSetting(LIBRARY_PREFIX + songs[0].id, "")).toBe(songs[0].settings[""]);
    preview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues for 6 songs" }));
    });
    expect(getSetting(LIBRARY_PREFIX + songs[1].id, "")).toContain("Changed during preview");
  });
  it("refuses duplicate songs, memory overflow, invalid controls and controls assigned to another pedal action", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("RHY START CC"), { target: { value: "32" } });
    preview();
    expect((screen.getByRole("button", { name: "Save automatic cues" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("RHY START CC"), { target: { value: "80" } });
    act(() => usePedalLibrary.setState({ assignments: { "boss-rc10r:loop-start": 80 } }));
    expect(screen.getByText(/already assigned to loop-start/)).toBeTruthy();
    pick("Rhythm automation scope", "Gig");
    fireEvent.change(screen.getByLabelText("First pedal memory"), { target: { value: "98" } });
    preview();
    expect(screen.getByText(/memories must all fit/)).toBeTruthy();
    act(() => useSongLibrary.setState({ index: { ...emptyLibrary(), songs, playlists: [{ id: "gig", name: "Gig", songs: [songs[0].id, songs[0].id] }] } }));
    preview();
    expect(screen.getByText(/playlist repeats a song/)).toBeTruthy();
  });
  it("keeps edits after a disk failure and retries saving, without transmitting MIDI", async () => {
    api.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    render(<Harness />);
    preview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("disk full");
    expect(getSetting(LIBRARY_PREFIX + songs[0].id, "")).toContain("automatic rhythm: begin");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry saving cue edits" }));
    });
    expect(api.updateSettings).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry saving cue edits" })).toBeNull();
  });
  it("blocks editing while either song or playlist playback is active", () => {
    render(<Harness locked />);
    expect((screen.getByRole("button", { name: "Preview automatic cues" }) as HTMLButtonElement).closest("fieldset")?.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Stop song and playlist playback");
  });
  it("refuses undo if another edit has changed any song", async () => {
    render(<Harness />);
    preview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues" }));
    });
    setSetting(LIBRARY_PREFIX + songs[0].id, ":options", "{}");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo cue changes" }));
    });
    expect(screen.getByRole("alert").textContent).toContain("Undo was not applied");
  });
  it("can turn off the automatic rhythm without deleting the song's other cues", async () => {
    render(<Harness />);
    preview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save automatic cues" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn off automatic rhythm" }));
    });
    const key = LIBRARY_PREFIX + songs[0].id;
    expect(getSetting(key, "")).toContain(songs[0].settings[""]);
    expect(getSetting(key, "")).not.toContain("automatic rhythm: begin");
    expect(JSON.parse(getSetting(key, ":options")).rhythmAutomation).toBeUndefined();
  });
});
