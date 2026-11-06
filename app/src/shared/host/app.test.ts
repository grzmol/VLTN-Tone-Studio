import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, readSettingsFile, sanitizeSettingsPatch } from "./app";

describe("sanitizeSettingsPatch", () => {
  it("drops unknown keys", () => {
    expect(sanitizeSettingsPatch({ showValues: true, retiredKey: 1, toString: 2 })).toEqual({ showValues: true });
  });

  it("drops values of the wrong type", () => {
    expect(sanitizeSettingsPatch({ showValues: "yes", gp50Extras: 1, portPattern: "GP" })).toEqual({ portPattern: "GP" });
  });

  it("accepts only the backup retention choices", () => {
    expect(sanitizeSettingsPatch({ backupRetention: "30" })).toEqual({ backupRetention: "30" });
    expect(sanitizeSettingsPatch({ backupRetention: "90d" })).toEqual({ backupRetention: "90d" });
    expect(sanitizeSettingsPatch({ backupRetention: "5" })).toEqual({});
    expect(sanitizeSettingsPatch({ backupRetention: 10 })).toEqual({});
  });

  it("defaults backup retention to keeping every backup", () => {
    expect(DEFAULT_SETTINGS.backupRetention).toBe("all");
  });

  it("accepts null for the nullable settings", () => {
    expect(sanitizeSettingsPatch({ portPattern: null, valetonSuitePath: null })).toEqual({ portPattern: null });
  });

  it("drops the Suite path, which only the file dialog sets", () => {
    expect(sanitizeSettingsPatch({ valetonSuitePath: "/Applications/Suite.app", suitePathPicked: true, showValues: true })).toEqual({ showValues: true });
  });

  it("ignores anything that is not an object", () => {
    expect(sanitizeSettingsPatch(null)).toEqual({});
    expect(sanitizeSettingsPatch(["showValues"])).toEqual({});
    expect(sanitizeSettingsPatch("showValues")).toEqual({});
  });
});

describe("readSettingsFile", () => {
  it("keeps the Suite path that an earlier save stored", () => {
    expect(readSettingsFile({ valetonSuitePath: "/Applications/Suite.app", suitePathPicked: true })).toEqual({
      valetonSuitePath: "/Applications/Suite.app",
      suitePathPicked: true,
    });
  });

  it("loads a file from an earlier version: keys it no longer has go, the rest stay", () => {
    expect({ ...DEFAULT_SETTINGS, ...readSettingsFile({ showValues: true, retiredKey: 3 }) }).toEqual({ ...DEFAULT_SETTINGS, showValues: true });
  });
});
