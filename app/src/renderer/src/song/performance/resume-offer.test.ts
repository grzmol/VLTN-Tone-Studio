import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSongLibrary } from "@/song/library";
import { clearResumePoint, loadResumePoint, saveResumePoint, type ResumePoint } from "./resume-point";
import { dismissResume, resetResumeOffer, shouldOffer, startResumeOffer, useResumeOffer } from "./resume-offer";

const point: ResumePoint = {
  version: 1,
  savedAt: Date.now(),
  playlistId: "set-1",
  queue: ["a", "b", "c"],
  position: 1,
  songId: "b",
  songTime: 40,
  playing: true,
  sendCues: true,
  stageMode: false,
};

const playPlaylist = vi.fn(async (queue: string[], position?: number) => {
  useSongLibrary.setState({ queue, position: position ?? 0 });
});
const load = vi.fn(async () => {});

beforeEach(() => {
  clearResumePoint();
  resetResumeOffer();
  playPlaylist.mockClear();
  load.mockClear();
  useSongLibrary.setState({ queue: [], position: 0, playPlaylist, load } as never);
});
afterEach(() => {
  clearResumePoint();
  resetResumeOffer();
});

describe("resume offer", () => {
  it("offers a crash point and loads the entry set to wait for Play, never playing it", async () => {
    saveResumePoint({ ...point, overrides: [null, null, { endBehaviour: "stop" }] });
    await startResumeOffer(true);
    expect(playPlaylist).toHaveBeenCalledWith(["a", "b", "c"], 1, "set-1", [null, { autoplay: false }, { endBehaviour: "stop" }]);
    expect(useResumeOffer.getState().point?.songId).toBe("b");
  });

  it("holds the point while the offer is open", async () => {
    saveResumePoint(point);
    await startResumeOffer(true);
    saveResumePoint({ ...point, songTime: 0, playing: false });
    expect(loadResumePoint(Date.now())?.songTime).toBe(40);
  });

  it("without a crash, offers only a point that was playing", async () => {
    saveResumePoint({ ...point, playing: false });
    await startResumeOffer(false);
    expect(playPlaylist).not.toHaveBeenCalled();
    expect(shouldOffer({ ...point, playing: true }, false)).toBe(true);
    expect(shouldOffer({ ...point, playing: false }, true)).toBe(true);
  });

  it("ignores an old point", async () => {
    saveResumePoint({ ...point, savedAt: Date.now() - 31 * 60 * 1000 });
    await startResumeOffer(true);
    expect(playPlaylist).not.toHaveBeenCalled();
    expect(useResumeOffer.getState().point).toBeNull();
  });

  it("loads a single song on its own", async () => {
    saveResumePoint({ ...point, playlistId: null, queue: ["b"], position: 0 });
    await startResumeOffer(true);
    expect(load).toHaveBeenCalledWith("b", ["b"], 0, [{ autoplay: false }]);
    expect(playPlaylist).not.toHaveBeenCalled();
  });

  it("drops the offer when the song could not be loaded", async () => {
    saveResumePoint(point);
    playPlaylist.mockImplementationOnce(async () => {});
    await startResumeOffer(true);
    expect(useResumeOffer.getState().point).toBeNull();
    expect(loadResumePoint(Date.now())).toBeNull();
  });

  it("dismissing forgets the point", async () => {
    saveResumePoint(point);
    await startResumeOffer(true);
    dismissResume();
    expect(loadResumePoint(Date.now())).toBeNull();
  });
});
