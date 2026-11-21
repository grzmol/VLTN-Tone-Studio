// @vitest-environment node
import { expect, it } from "vitest";
import { devUserDataPath } from "./user-data";

const INSTALLED = "/Users/me/Library/Application Support/VLTN Tone Studio";

it("gives a development run its own folder next to the installed app's", () => {
  expect(devUserDataPath(INSTALLED, false, false)).toBe(INSTALLED + " (dev)");
});

it("leaves the packaged app's folder alone", () => {
  expect(devUserDataPath(INSTALLED, true, false)).toBeNull();
});

it("keeps a folder chosen with --user-data-dir", () => {
  expect(devUserDataPath("/tmp/scratch", false, true)).toBeNull();
});
