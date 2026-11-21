import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricsBatchSettings } from "./LyricsBatchSettings";

afterEach(cleanup);

it("shows the download size and a rough time for the songs chosen", () => {
  const noop = vi.fn();
  render(
    <LyricsBatchSettings
      choice={{ model: "small", quality: "fast" }}
      onChoice={noop}
      which="empty"
      onWhich={noop}
      retime
      onRetime={noop}
      unknown={false}
      onUnknown={noop}
      plan="Lyrics: 3 of 3 songs will get new lyrics."
      disabled={false}
      songs={3}
    />,
  );
  expect(screen.getAllByText(/Downloads about 249 MB once/).length).toBeGreaterThan(0);
  expect(screen.getByText(/About 10 min for 3 songs/)).toBeTruthy();
  expect(screen.getByText("Songs with no lyrics")).toBeTruthy();
  expect(screen.getByText("Lyrics made with a different model than this one")).toBeTruthy();
});

it("shows the plan, and reports the box for lyrics from before 0.9.2", () => {
  const onUnknown = vi.fn();
  render(
    <LyricsBatchSettings
      choice={{ model: "small", quality: "fast" }}
      onChoice={vi.fn()}
      which="transcribed"
      onWhich={vi.fn()}
      retime
      onRetime={vi.fn()}
      unknown={false}
      onUnknown={onUnknown}
      plan="Lyrics: 1 of 2 songs will get new lyrics. Skipped: 1 from before 0.9.2. Tick the box above to include them."
      disabled={false}
      songs={1}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("Skipped: 1 from before 0.9.2.");
  fireEvent.click(screen.getByLabelText("Include lyrics from before version 0.9.2"));
  expect(onUnknown).toHaveBeenCalledWith(true);
});
