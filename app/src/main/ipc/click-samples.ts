import { app } from "electron";
import { join } from "node:path";
import { CLICK_SAMPLE_MAX_BYTES, isClickSampleSlot } from "@shared/host/click-samples";
import { HostError } from "@shared/ipc";
import { handle } from "./handle";
import { ClickSampleStore } from "./click-samples-store";

/** The IPC for the metronome's own samples (spec 103). The renderer picks the file; main only keeps a copy in userData/click-sounds. */
export function registerClickSamplesIpc(): void {
  const store = new ClickSampleStore(join(app.getPath("userData"), "click-sounds"));
  const slotOf = (slot: unknown) => {
    if (!isClickSampleSlot(slot)) throw new HostError("invalid", "Unknown sample slot");
    return slot;
  };

  handle("click-samples:get", (_e, slot: unknown) => store.get(slotOf(slot)));

  handle("click-samples:put", (_e, slot: unknown, name: unknown, bytes: unknown) => {
    if (typeof name !== "string") throw new HostError("invalid", "Bad sample name");
    const data =
      bytes instanceof ArrayBuffer
        ? new Uint8Array(bytes)
        : ArrayBuffer.isView(bytes)
          ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
          : null;
    if (!data || data.byteLength === 0 || data.byteLength > CLICK_SAMPLE_MAX_BYTES) throw new HostError("invalid", "Sample files must be under 8 MB");
    return store.put(slotOf(slot), name, data);
  });

  handle("click-samples:clear", (_e, slot: unknown) => store.clear(slotOf(slot)));
}
