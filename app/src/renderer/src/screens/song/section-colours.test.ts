import { expect, it } from "vitest";
import { sectionKind } from "./section-colours";

it("reads the kind from the section name", () => {
  expect(sectionKind("Verse 2")).toBe("verse");
  expect(sectionKind("Pre-Chorus")).toBe("prechorus");
  expect(sectionKind("Chorus 3")).toBe("chorus");
  expect(sectionKind("Bridge 1")).toBe("bridge");
  expect(sectionKind("Guitar solo")).toBe("solo");
  expect(sectionKind("Intro")).toBe("neutral");
  expect(sectionKind("Outro")).toBe("neutral");
});
