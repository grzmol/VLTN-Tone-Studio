import { describe, expect, it } from "vitest";
import { GLOBALS, readGlobal, writeGlobal } from "@/gp150/lib/protocol.mjs";
import { clampGp150Global, gp150GlobalSpec } from "./gp150-globals";

/** A 0x2030 record (USB, Bluetooth and Mic record levels, then the rest) holding `value` in the setting's bytes. */
function recordWith(name: "btRecLevel" | "micRecLevel", value: number): Uint8Array {
  return writeGlobal(new Uint8Array(12), name, value);
}

describe("GP-150 record levels", () => {
  const RECORD_LEVELS = ["btRecLevel", "micRecLevel"] as const;

  it("decodes the pedal's −21 dB raw value as −21", () => {
    expect(readGlobal(Uint8Array.from([0, 0, 0xeb, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]), "btRecLevel")).toBe(-21);
    expect(readGlobal(Uint8Array.from([0, 0, 0, 0, 0xeb, 0xff, 0, 0, 0, 0, 0, 0]), "micRecLevel")).toBe(-21);
  });

  it("encodes −21 as the same raw value, 0xFFEB, in each record level's bytes", () => {
    for (const name of RECORD_LEVELS) {
      const record = recordWith(name, -21);
      expect(readGlobal(record, name)).toBe(-21);
      expect(record[GLOBALS[name].off]).toBe(0xeb);
      expect(record[GLOBALS[name].off + 1]).toBe(0xff);
    }
  });

  it("declares −21…+20 dB for the Bluetooth and Mic record levels", () => {
    for (const name of RECORD_LEVELS) {
      const spec = gp150GlobalSpec(name);
      expect(spec.min).toBe(-21);
      expect(spec.max).toBe(20);
      expect(spec.unit).toBe("dB");
    }
  });

  it("keeps the USB record level and the other dB settings at −20…+20", () => {
    expect(gp150GlobalSpec("usbRecLevel").min).toBe(-20);
    expect(gp150GlobalSpec("inputLevel").min).toBe(-20);
    expect(gp150GlobalSpec("usbMonitorLevel").min).toBe(-20);
  });

  it("keeps −21 when clamped, and still limits values beyond the range", () => {
    for (const name of RECORD_LEVELS) {
      expect(clampGp150Global(name, -21)).toBe(-21);
      expect(clampGp150Global(name, -22)).toBe(-21);
      expect(clampGp150Global(name, 25)).toBe(20);
    }
    expect(clampGp150Global("usbRecLevel", -21)).toBe(-20);
    expect(clampGp150Global("inputLevel", -21)).toBe(-20);
  });
});
