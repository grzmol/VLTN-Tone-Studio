import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToneRecord } from "@shared/host/tones";
// vi.mock below is hoisted above these imports, so the store sees the fake host and device.
import { openRename, renameSlot, useTones } from "./store";

const fake = vi.hoisted(() => ({
  links: [] as { toneId: number; link: { kind: string; slot: number; slotName: string; device: string } }[],
  renames: [] as { kind: string; slot: number; name: string }[],
  renameError: null as Error | null,
}));

const linked = (toneId: number, slot: number, slotName: string): ToneRecord => ({
  tone_id: toneId,
  title: "Some Amp",
  gear: "amp",
  format: "nam",
  creator: { username: "someone", avatar_url: null },
  image_url: null,
  license: "t3k",
  url: "https://www.tone3000.com/tones/1",
  models: [],
  gp5: { verdict: "ready", snaptoneSlot: slot, slotName, device: "gp200" },
  savedAt: "2026-11-07T00:00:00.000Z",
});

vi.mock("@/host", () => ({
  host: {
    tones: {
      link: async (toneId: number, link: { kind: string; slot: number; slotName: string; device: string }) => {
        fake.links.push({ toneId, link });
        return linked(toneId, link.slot, link.slotName);
      },
      local: async () => [],
    },
  },
}));

vi.mock("@/state/device", () => {
  const state = {
    status: "connected",
    device: "gp200",
    async renameToneSlot(kind: string, slot: number, name: string) {
      if (fake.renameError) throw fake.renameError;
      fake.renames.push({ kind, slot, name });
      return name;
    },
  };
  return { useDevice: { getState: () => state } };
});

vi.mock("@/app/notify", () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }));
vi.mock("@/snaptone/convert", () => ({ convertToClone: vi.fn(), snapToneFile: vi.fn() }));

beforeEach(() => {
  fake.links = [];
  fake.renames = [];
  fake.renameError = null;
  useTones.setState({ records: { 7: linked(7, 2, "OLD NAME"), 8: linked(8, 4, "OTHER") }, renameChoice: null });
});

describe("renaming a SnapTone / User IR slot", () => {
  it("renames on the pedal and moves the slot's TONE3000 link to the new name", async () => {
    openRename({ kind: "snaptone", slot: 2 });
    expect(await renameSlot("snaptone", 2, "MY CAPTURE")).toBe("MY CAPTURE");
    expect(fake.renames).toEqual([{ kind: "snaptone", slot: 2, name: "MY CAPTURE" }]);
    // Only the tone linked to that slot is updated
    expect(fake.links).toEqual([{ toneId: 7, link: { kind: "snaptone", slot: 2, slotName: "MY CAPTURE", device: "gp200" } }]);
    expect(useTones.getState().records[7].gp5.slotName).toBe("MY CAPTURE");
    expect(useTones.getState().renameChoice).toBeNull();
  });

  it("keeps the dialog and the links when the pedal refuses", async () => {
    fake.renameError = new Error("no reply");
    openRename({ kind: "snaptone", slot: 2 });
    await expect(renameSlot("snaptone", 2, "MY CAPTURE")).rejects.toThrow("no reply");
    expect(fake.links).toEqual([]);
    expect(useTones.getState().renameChoice).toEqual({ kind: "snaptone", slot: 2 });
  });
});
