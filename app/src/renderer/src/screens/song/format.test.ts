import { expect, it } from "vitest";
import { clock, parseSeconds, seconds, tempo } from "./format";

it("shows a clock as m:ss", () => {
  expect(clock(0)).toBe("0:00");
  expect(clock(330)).toBe("5:30");
  expect(clock(329.99)).toBe("5:29");
  expect(clock(-3)).toBe("0:00");
  expect(clock(Number.NaN)).toBe("0:00");
});

it("shows a whole tempo without a decimal and any other with one", () => {
  expect(tempo(150)).toBe("150 BPM");
  expect(tempo(149.9)).toBe("149.9 BPM");
  expect(tempo(149.96)).toBe("150 BPM");
});

it("shows seconds with at most two decimals and no trailing zeros", () => {
  expect(seconds(0)).toBe("0");
  expect(seconds(12.5)).toBe("12.5");
  expect(seconds(329.99)).toBe("329.99");
  expect(seconds(329.99997732426306)).toBe("330");
  expect(seconds(0.0000226757369614)).toBe("0");
  expect(seconds(0.004)).toBe("0");
  expect(seconds(0.006)).toBe("0.01");
});

it("reads seconds with a dot or a comma and gives null for the rest", () => {
  expect(parseSeconds("329,99")).toBe(329.99);
  expect(parseSeconds("329.99")).toBe(329.99);
  expect(parseSeconds(" 12 ")).toBe(12);
  expect(parseSeconds("12.")).toBe(12);
  expect(parseSeconds(".5")).toBe(0.5);
  expect(parseSeconds("")).toBeNull();
  expect(parseSeconds("abc")).toBeNull();
  expect(parseSeconds("1.2.3")).toBeNull();
  expect(parseSeconds("-3")).toBeNull();
});
