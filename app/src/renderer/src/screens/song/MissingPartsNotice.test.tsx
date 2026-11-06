import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissingParts } from "@/song/band/detect";
import type { Section } from "@/song/performance/sections";
import { useSong } from "@/song/store";
import { useBandPanel } from "./band-panel-state";
import { MissingPartsNotice } from "./MissingPartsNotice";

vi.mock("@/song/store", async () => {
  const { create } = await import("zustand");
  return { useSong: create(() => ({ missingParts: null as MissingParts | null, tracks: {} as Record<string, unknown> })) };
});

const KEY = "vltn.performance.v1:notice-test:8:44100";
const NOTHING_LEFT: MissingParts = { drums: "absent", bass: "present", absentSections: { drums: [], bass: [] } };
const SECTIONS: Section[] = [{ id: "intro", name: "Intro", start: 0, end: 4, mode: "continue" }];

beforeEach(() => {
  localStorage.clear();
  useSong.setState({ missingParts: null, tracks: {} });
  useBandPanel.getState().show(false);
});
afterEach(cleanup);

describe("missing-part notice", () => {
  it("appears after a split that found no drums, and offers the Band panel", () => {
    const { rerender } = render(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing={false} />);
    expect(screen.queryByRole("region", { name: "Missing parts" })).toBeNull();
    // A split sets the store's result: the notice appears on the next render of the screen.
    useSong.setState({ missingParts: NOTHING_LEFT });
    rerender(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing={false} />);
    expect(screen.getByText("No drums found. Generate a drum part?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Band panel" }));
    expect(useBandPanel.getState().open).toBe(true);
    expect(screen.queryByText("No drums found. Generate a drum part?")).toBeNull();
  });

  it("stays dismissed for the song, after the panel is opened from it or after Not now", () => {
    useSong.setState({ missingParts: NOTHING_LEFT });
    const { unmount } = render(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByText("No drums found. Generate a drum part?")).toBeNull();
    unmount();
    render(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing={false} />);
    expect(screen.queryByText("No drums found. Generate a drum part?")).toBeNull();
  });

  it("is never shown during playback", () => {
    useSong.setState({ missingParts: NOTHING_LEFT });
    render(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing />);
    expect(screen.queryByRole("region", { name: "Missing parts" })).toBeNull();
  });

  it("asks for both parts, and names a section for a part that is missing only from some of it", () => {
    useSong.setState({ missingParts: { drums: "partial", bass: "absent", absentSections: { drums: ["intro"], bass: [] } } });
    render(<MissingPartsNotice songKey={KEY} sections={SECTIONS} playing={false} />);
    expect(screen.getByText("Drums missing in Intro. No bass found. Generate drum and bass parts?")).toBeTruthy();
  });
});
