import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversionChip, conversionLine } from "./ConversionChip";
import { CONVERTED_PHASE, CONVERTING_PHASE } from "@shared/song-library";

let emit: ((p: { phase: string; completed: number; total: number }) => void) | undefined;
const unsubscribe = vi.fn();

vi.mock("@/host", () => ({
  host: {
    song: {
      library: {
        onTransferProgress: (callback: (p: { phase: string; completed: number; total: number }) => void) => {
          emit = callback;
          return unsubscribe;
        },
      },
    },
  },
}));

beforeEach(() => {
  emit = undefined;
});
afterEach(() => {
  cleanup();
  unsubscribe.mockClear();
});

it("says nothing until a conversion reports progress", () => {
  const { container } = render(<ConversionChip />);
  expect(container.textContent).toBe("");
});

it("shows how many songs are converted and clears when the conversion is done", () => {
  render(<ConversionChip />);
  act(() => emit!({ phase: CONVERTING_PHASE, completed: 2, total: 6 }));
  expect(screen.getByText("Converting library: 2 of 6 songs")).toBeTruthy();
  act(() => emit!({ phase: CONVERTED_PHASE, completed: 6, total: 6 }));
  expect(screen.queryByText(/Converting library/)).toBeNull();
});

it("ignores other transfers, such as a backup export", () => {
  const { container } = render(<ConversionChip />);
  act(() => emit!({ phase: "Exporting songs", completed: 1, total: 3 }));
  expect(container.textContent).toBe("");
});

it("uses the singular for one song", () => {
  expect(conversionLine({ completed: 0, total: 1 })).toBe("Converting library: 0 of 1 song");
});
