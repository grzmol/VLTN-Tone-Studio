import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEdits as gp5ApplyEdits, blankGp50Prst } from "@/gp5/lib/prst.mjs";
import { applyPatchEdits as gp200ApplyPatchEdits, buildPrst, encodePatchImage } from "@/gp200/lib/prst.mjs";
import { applyPatchEdits as gp150ApplyPatchEdits, blankPrst } from "@/gp150/lib/prst.mjs";
import type { DeviceKey } from "@shared/devices";
import type { BackupEntry } from "@/state/device-types";
import { classifySlots, normalizeForCompare } from "./compare";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../../gp5/fixtures", name)));
const entry = (slot: number, name: string, prst: Uint8Array): BackupEntry => ({ slot, name, prst });

describe("normalizeForCompare", () => {
  it("GP-5: zeroes the CRC byte and nothing else", () => {
    const prst = fixture("65-Puppy.prst");
    const other = prst.slice();
    other[0x14] ^= 0xff;
    expect(normalizeForCompare(other, "gp5")).toEqual(normalizeForCompare(prst, "gp5"));
    expect(normalizeForCompare(prst, "gp5")[0x15]).toBe(prst[0x15]);
  });

  it("GP-150: the slot number, length field and checksum are left out", () => {
    const a = blankPrst(1, "A");
    const b = blankPrst(7, "A");
    b[0x0e] = 0x12;
    expect(normalizeForCompare(a, "gp150")).toEqual(normalizeForCompare(b, "gp150"));
  });

  it("GP-200: the slot mirrors in the image are left out", () => {
    const a = buildPrst(encodePatchImage({ name: "A", slot: 1 }));
    const b = buildPrst(encodePatchImage({ name: "A", slot: 9 }));
    expect(normalizeForCompare(a, "gp200")).toEqual(normalizeForCompare(b, "gp200"));
  });
});

describe("classifySlots", () => {
  it("GP-50: a preset equal to the pedal's is same; an edited one is changed; a renamed one is different", () => {
    const pedal = fixture("gp50-US-Lead.prst");
    const edited = gp5ApplyEdits(pedal, { volume: 30 });
    const renamed = gp5ApplyEdits(pedal, { name: "Other" });
    const [same, changed, different] = classifySlots(
      [entry(0, "US Lead", pedal), entry(1, "US Lead", edited), entry(2, "Other", renamed)],
      [entry(0, "US Lead", pedal), entry(1, "US Lead", pedal), entry(2, "US Lead", pedal)],
      "gp50",
    );
    expect(same.state).toBe("same");
    expect(changed.state).toBe("changed");
    expect(different.state).toBe("different");
    expect(different.pedalName).toBe("US Lead");
  });

  it("GP-50: an empty slot on one side is empty", () => {
    const preset = fixture("gp50-US-Lead.prst");
    const blank = blankGp50Prst();
    const [row] = classifySlots([entry(3, "US Lead", preset)], [entry(3, "GP-50", blank)], "gp50");
    expect(row.state).toBe("empty");
  });

  it("GP-150: a backup taken from the same pedal state is same, whatever slot it was read from", () => {
    const bytes = blankPrst(4, "Clean");
    const pedal = gp150ApplyPatchEdits(bytes, { volume: 60 });
    const [row] = classifySlots([entry(4, "Clean", bytes)], [entry(4, "Clean", pedal)], "gp150");
    expect(row.state).toBe("changed");
    const [same] = classifySlots([entry(4, "Clean", bytes)], [entry(4, "Clean", blankPrst(9, "Clean"))], "gp150");
    expect(same.state).toBe("same");
  });

  it("GP-200: same, changed and different", () => {
    const device: DeviceKey = "gp200";
    const image = encodePatchImage({ name: "Lead", slot: 2 });
    const bytes = buildPrst(image);
    const edited = buildPrst(gp200ApplyPatchEdits(image, { volume: 60 }));
    const renamed = buildPrst(gp200ApplyPatchEdits(image, { name: "Other" }));
    const [same, changed, different] = classifySlots(
      [entry(2, "Lead", bytes), entry(2, "Lead", edited), entry(2, "Other", renamed)],
      [entry(2, "Lead", bytes), entry(2, "Lead", bytes), entry(2, "Lead", bytes)],
      device,
    );
    expect([same.state, changed.state, different.state]).toEqual(["same", "changed", "different"]);
  });

  it("a slot the pedal has no entry for is different", () => {
    const [row] = classifySlots([entry(5, "Lead", fixture("gp50-US-Lead.prst"))], [], "gp50");
    expect(row).toMatchObject({ slot: 5, state: "different", pedalName: "" });
  });
});
