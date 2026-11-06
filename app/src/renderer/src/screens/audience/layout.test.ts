import { describe, expect, it } from "vitest";
import { rotationStyle } from "./layout";

describe("rotationStyle", () => {
  it("fills the screen when upright", () => {
    expect(rotationStyle(0)).toMatchObject({ position: "absolute", inset: 0 });
    expect(rotationStyle(0).transform).toBeUndefined();
  });

  it("turns the picture a half turn in place", () => {
    expect(rotationStyle(180)).toMatchObject({ inset: 0, transform: "rotate(180deg)" });
  });

  it("swaps the width and height for a quarter turn, moved back on to the screen", () => {
    expect(rotationStyle(90)).toMatchObject({ width: "100vh", height: "100vw", transform: "translateX(100vw) rotate(90deg)", transformOrigin: "top left" });
    expect(rotationStyle(270)).toMatchObject({ width: "100vh", height: "100vw", transform: "translateY(100vh) rotate(270deg)", transformOrigin: "top left" });
  });
});
