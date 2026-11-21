import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RESUME_MAX_AGE_MS, RESUME_POINT_KEY, clearResumePoint, holdResumePoint, loadResumePoint, saveResumePoint, type ResumePoint } from "./resume-point";

const NOW = 1_000_000_000;
const point: ResumePoint = {
  version: 1,
  savedAt: NOW - 2000,
  playlistId: "set-1",
  queue: ["a", "b", "c"],
  position: 1,
  songId: "b",
  songTime: 134.5,
  playing: true,
  sendCues: true,
  stageMode: false,
};

beforeEach(() => clearResumePoint());
afterEach(() => clearResumePoint());

describe("resume point", () => {
  it("round-trips", () => {
    saveResumePoint(point);
    expect(loadResumePoint(NOW)).toEqual({ ...point, overrides: undefined });
  });

  it("is null when nothing is stored", () => {
    expect(loadResumePoint(NOW)).toBeNull();
  });

  it("is null for malformed JSON and for the wrong shape", () => {
    localStorage.setItem(RESUME_POINT_KEY, "{nope");
    expect(loadResumePoint(NOW)).toBeNull();
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify({ ...point, queue: "a" }));
    expect(loadResumePoint(NOW)).toBeNull();
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify({ ...point, songId: "zzz" }));
    expect(loadResumePoint(NOW)).toBeNull();
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify({ ...point, songTime: -1 }));
    expect(loadResumePoint(NOW)).toBeNull();
  });

  it("is null once it is older than 30 minutes", () => {
    saveResumePoint({ ...point, savedAt: NOW - RESUME_MAX_AGE_MS - 1 });
    expect(loadResumePoint(NOW)).toBeNull();
    saveResumePoint({ ...point, savedAt: NOW - RESUME_MAX_AGE_MS });
    expect(loadResumePoint(NOW)).not.toBeNull();
  });

  it("is null for another version", () => {
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify({ ...point, version: 2 }));
    expect(loadResumePoint(NOW)).toBeNull();
  });

  it("keeps the old point while it is held, and a clear releases the hold", () => {
    saveResumePoint(point);
    holdResumePoint(true);
    saveResumePoint({ ...point, songTime: 0, playing: false });
    expect(loadResumePoint(NOW)?.songTime).toBe(134.5);
    clearResumePoint();
    saveResumePoint(point);
    expect(loadResumePoint(NOW)).not.toBeNull();
  });

  it("drops overrides that are not well formed", () => {
    localStorage.setItem(RESUME_POINT_KEY, JSON.stringify({ ...point, overrides: [null, { autoplay: "no" }, null] }));
    expect(loadResumePoint(NOW)?.overrides).toBeUndefined();
  });
});
