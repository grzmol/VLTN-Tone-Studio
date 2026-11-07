import { expect, it, vi } from "vitest";
import type { ClickSampleSlot, StoredClickSample } from "@shared/host/click-samples";
import type { PcmAudio } from "../types";

vi.mock("@/host", () => ({ host: { clickSamples: {} } }));
const { createClickSampleStore, trimClickSample } = await import("./click-samples");

const hit = (seconds: number, rate = 1000): PcmAudio => ({ sampleRate: rate, channels: [new Float32Array(Math.round(seconds * rate)).fill(1)] });

/** A host that keeps files in memory, and a decoder that reads the file's name as its length in seconds ("1.5.wav"). */
function fakes() {
  const kept = new Map<ClickSampleSlot, StoredClickSample>();
  const api = {
    get: async (slot: ClickSampleSlot) => kept.get(slot) ?? null,
    put: async (slot: ClickSampleSlot, sample: StoredClickSample) => void kept.set(slot, sample),
    clear: async (slot: ClickSampleSlot) => void kept.delete(slot),
  };
  const decode = vi.fn(async (file: File) => {
    if (file.name.startsWith("bad")) throw new Error(`Couldn't read ${file.name}.`);
    return hit(parseFloat(file.name));
  });
  return { kept, api, decode };
}

const file = (name: string, size = 8) => new File([new Uint8Array(size)], name);

it("cuts a sample longer than two seconds, fades the cut, and leaves a short one alone", () => {
  const short = hit(0.5);
  expect(trimClickSample(short)).toEqual({ audio: short, trimmed: false });
  const long = trimClickSample(hit(3));
  expect(long.trimmed).toBe(true);
  expect(long.audio.channels[0]).toHaveLength(2000);
  expect(long.audio.channels[0][1999]).toBe(0);
  expect(long.audio.channels[0][0]).toBe(1);
});

it("keeps a loaded sample in its slot and finds it again after a restart", async () => {
  const { api, decode } = fakes();
  const first = createClickSampleStore({ api, decode });
  await first.getState().set("down", file("0.4.wav"));
  expect(first.getState().down?.name).toBe("0.4.wav");
  expect(first.getState().other).toBeNull();
  // A new store is a restarted app: it reads what the host kept.
  const second = createClickSampleStore({ api, decode });
  await second.getState().load();
  expect(second.getState().down?.audio.channels[0]).toHaveLength(400);
  expect(second.getState().other).toBeNull();
});

it("trims a file over two seconds and says so", async () => {
  const { api, decode } = fakes();
  const store = createClickSampleStore({ api, decode });
  await store.getState().set("other", file("3.wav"));
  expect(store.getState().other?.audio.channels[0]).toHaveLength(2000);
  expect(store.getState().notice).toMatch(/Other beats: 3\.wav is longer than 2 seconds/);
});

it("refuses a file that does not decode and keeps the sample that was there", async () => {
  const { api, decode, kept } = fakes();
  const store = createClickSampleStore({ api, decode });
  await store.getState().set("down", file("0.2.wav"));
  await store.getState().set("down", file("bad.wav"));
  expect(store.getState().down?.name).toBe("0.2.wav");
  expect(kept.get("down")?.name).toBe("0.2.wav");
  expect(store.getState().notice).toMatch(/Couldn't read bad\.wav/);
});

it("empties a slot, and leaves a saved file that no longer decodes empty with a notice", async () => {
  const { api, decode, kept } = fakes();
  const store = createClickSampleStore({ api, decode });
  await store.getState().set("down", file("0.2.wav"));
  await store.getState().clear("down");
  expect(store.getState().down).toBeNull();
  expect(kept.has("down")).toBe(false);
  kept.set("other", { name: "bad.wav", bytes: new ArrayBuffer(4) });
  const restarted = createClickSampleStore({ api, decode });
  await restarted.getState().load();
  expect(restarted.getState().other).toBeNull();
  expect(restarted.getState().notice).toMatch(/Other beats/);
});
