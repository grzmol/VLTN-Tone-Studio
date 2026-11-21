import { create } from "zustand";

/*
 * The lyrics text size, shared by the reader and the remote font actions. It is kept for the session only: a fresh start shows the
 * default, as the reader always has.
 */

export const READER_TEXT = { min: 20, max: 48, step: 4, initial: 28 } as const;

/** `size` kept between the reader's limits */
export function clampReaderSize(size: number): number {
  return Math.min(READER_TEXT.max, Math.max(READER_TEXT.min, size));
}

export const useReaderText = create<{ size: number; step(direction: -1 | 1): void }>((set) => ({
  size: READER_TEXT.initial,
  step: (direction) => set((state) => ({ size: clampReaderSize(state.size + direction * READER_TEXT.step) })),
}));
