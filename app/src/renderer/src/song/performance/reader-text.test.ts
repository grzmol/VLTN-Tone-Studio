import { beforeEach, describe, expect, it } from "vitest";
import { READER_TEXT, clampReaderSize, useReaderText } from "./reader-text";

describe("the lyrics text size", () => {
  beforeEach(() => useReaderText.setState({ size: READER_TEXT.initial }));

  it("steps by the reader's step, and stops at its limits", () => {
    useReaderText.getState().step(1);
    expect(useReaderText.getState().size).toBe(READER_TEXT.initial + READER_TEXT.step);
    for (let i = 0; i < 20; i++) useReaderText.getState().step(1);
    expect(useReaderText.getState().size).toBe(READER_TEXT.max);
    for (let i = 0; i < 20; i++) useReaderText.getState().step(-1);
    expect(useReaderText.getState().size).toBe(READER_TEXT.min);
  });

  it("keeps any size between the limits", () => {
    expect(clampReaderSize(5)).toBe(READER_TEXT.min);
    expect(clampReaderSize(100)).toBe(READER_TEXT.max);
    expect(clampReaderSize(30)).toBe(30);
  });
});
