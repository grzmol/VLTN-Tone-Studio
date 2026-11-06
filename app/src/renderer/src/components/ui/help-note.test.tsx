import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { HelpNote } from "./help-note";

afterEach(cleanup);

it("keeps the explanation closed by default but still in the page", () => {
  render(
    <HelpNote>
      <p>Explains the control.</p>
    </HelpNote>,
  );
  const details = screen.getByText("How this works").closest("details");
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(screen.getByText("Explains the control.")).toBeTruthy();
});

it("opens when its summary is clicked", () => {
  render(
    <HelpNote label="About this">
      <p>More detail.</p>
    </HelpNote>,
  );
  const summary = screen.getByText("About this");
  fireEvent.click(summary);
  expect(summary.closest("details")?.open).toBe(true);
});
