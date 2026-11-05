import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEdits, detectDevice, readName, rebuildPrst } from "@/gp5/lib/prst.mjs";
import { PRST_MODELS, profileFor } from "@shared/devices";
import { alreadyMatchesCopy, describeSlots, restoreEntries } from "./restore";

const fixture = (name: string): Uint8Array => rebuildPrst(name.replace(/^\d+-|\.prst$/g, ""), new Uint8Array(466), "gp5");
const load = (name: string) => new Uint8Array(readFileSync(join(__dirname, "../../gp5/fixtures", name)));
const puppy = load("65-Puppy.prst");
// "US Lead" with PRE switched to a GP-50-only model (PRE C-Wah), so converting it to the GP-5 drops that block.
const usLeadWah = applyEdits(load("gp50-US-Lead.prst"), { blocks: { PRE: { fxid: 0x05000008 } } });

describe("restoreEntries", () => {
  it("keeps presets by slot (from the record or the NN- prefix), sorted", () => {
    const stub = fixture("65-Puppy.prst");
    const { entries, skipped, converted } = restoreEntries(
      [
        { fileName: "65-Puppy.prst", bytes: stub },
        { fileName: "whatever.prst", slot: 3, bytes: stub },
      ],
      "gp5",
    );
    expect(entries.map((e) => e.slot)).toEqual([3, 65]);
    expect(entries[1].name).toBe("Puppy");
    expect(entries[1].prst).toBe(stub);
    expect(converted).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("explains what it skips", () => {
    const stub = fixture("65-Puppy.prst");
    const { entries, skipped } = restoreEntries(
      [
        { fileName: "Puppy.prst", bytes: stub },
        { fileName: "07-Broken.prst", bytes: new Uint8Array(12) },
        { fileName: "08-Gone.prst", bytes: null, error: "too big" },
        { fileName: "65-Puppy.prst", bytes: stub },
        { fileName: "65-Again.prst", bytes: stub },
      ],
      "gp5",
    );
    expect(entries).toHaveLength(1);
    expect(skipped).toEqual([
      "Puppy.prst: no slot number in the file name",
      `07-Broken.prst: not a ${PRST_MODELS} preset`,
      "08-Gone.prst: too big",
      "65-Again.prst: slot 65 appears twice",
    ]);
  });

  it("converts a GP-5 backup for a GP-50 losslessly", () => {
    const { entries, converted, skipped } = restoreEntries([{ fileName: "65-Puppy.prst", bytes: puppy }], "gp50");
    expect(skipped).toEqual([]);
    expect(entries[0].prst).toHaveLength(552);
    expect(detectDevice(entries[0].prst).key).toBe("gp50");
    expect(converted).toEqual([{ slot: 65, name: "Puppy", from: "gp5", dropped: [] }]);
  });

  it("converts a GP-50 preset for a GP-5 and names the blocks it drops", () => {
    const { entries, converted } = restoreEntries([{ fileName: "00-US Lead.prst", bytes: usLeadWah }], "gp5");
    expect(entries[0].prst).toHaveLength(507);
    expect(converted).toEqual([{ slot: 0, name: readName(usLeadWah).trim(), from: "gp50", dropped: ["PRE (PRE C-Wah)"] }]);
  });

  it("keeps GP-50 presets as they are for a GP-50", () => {
    const { entries, converted } = restoreEntries([{ fileName: "00-US Lead.prst", bytes: usLeadWah }], "gp50");
    expect(entries[0].prst).toBe(usLeadWah);
    expect(converted).toEqual([]);
  });

  it("renames an empty slot of the other model to the pedal's empty name", () => {
    const empty = applyEdits(puppy, { name: "GP-5" });
    const { entries, converted } = restoreEntries([{ fileName: "12-GP-5.prst", bytes: empty }], "gp50");
    expect(entries[0].name).toBe("GP-50");
    expect(readName(entries[0].prst).trim()).toBe("GP-50");
    expect(converted).toEqual([]);
  });

  it("leaves presets unconverted when the pedal model is unknown", () => {
    const { entries, converted } = restoreEntries([{ fileName: "00-US Lead.prst", bytes: usLeadWah }], null);
    expect(entries[0].prst).toBe(usLeadWah);
    expect(converted).toEqual([]);
  });

  it("skips a GP-200 preset for a GP-5 with the plain refusal", () => {
    const gp200 = new Uint8Array(1224);
    gp200.set([..."TSRP"].map((c) => c.charCodeAt(0)), 0);
    gp200.set([..."2-PG"].map((c) => c.charCodeAt(0)), 0x10);
    const { entries, skipped } = restoreEntries([{ fileName: "01-A-Lead.prst", bytes: gp200 }], "gp5");
    expect(entries).toEqual([]);
    expect(skipped).toEqual(["01-A-Lead.prst: This preset is for a GP-200; Tone Studio can't convert it for a GP-5."]);
  });
});

describe("describeSlots", () => {
  it("collapses runs", () => {
    const gp5 = profileFor("gp5").slotLabel;
    expect(describeSlots(Array.from({ length: 100 }, (_, i) => i), gp5)).toBe("Slots 00–99");
    expect(describeSlots([7, 0, 1, 2, 3, 4], gp5)).toBe("Slots 00–04 and 07");
    expect(describeSlots([12], gp5)).toBe("Slot 12");
  });

  it("uses the pedal's slot labels", () => {
    const gp200 = profileFor("gp200").slotLabel;
    expect(describeSlots([0, 1, 2, 3, 9], gp200)).toBe("Slots 01-A–01-D and 03-B");
  });
});

describe("alreadyMatchesCopy", () => {
  it("says the pedal already matches the backup, with no loss warning", () => {
    const copy = alreadyMatchesCopy("GP-180");
    expect(copy.title).toBe("The GP-180 already matches this backup");
    expect(copy.description).not.toMatch(/lost/);
    expect(copy.description).toMatch(/nothing/);
  });
});
