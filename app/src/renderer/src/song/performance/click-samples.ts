import { create, type StoreApi, type UseBoundStore } from "zustand";
import { CLICK_SAMPLE_MAX_BYTES, CLICK_SAMPLE_SLOTS, type ClickSampleSlot, type ClickSamplesApi } from "@shared/host/click-samples";
import { host } from "@/host";
import { decodeAudioFile } from "../decode";
import type { PcmAudio } from "../types";

// Your own metronome sounds (spec 103): "My samples" has a slot for the downbeat and one for the other beats. A hit bounced from a
// drum plugin is loaded once, copied into the app's data folder by the host, and decoded when the app starts or the file is chosen,
// never at Play. A slot with nothing in it, or a file that no longer decodes, leaves those beats with the click.

/** A sample is at most this long; more is cut off, with a notice. */
export const MAX_CLICK_SAMPLE_SECONDS = 2;

/** The longest file that is decoded before it is cut. A longer one is probably not a drum hit, and is refused. */
const MAX_DECODE_SECONDS = 60;

/** The sample cut to MAX_CLICK_SAMPLE_SECONDS, and whether anything was cut off. */
export function trimClickSample(audio: PcmAudio): { audio: PcmAudio; trimmed: boolean } {
  const limit = Math.round(audio.sampleRate * MAX_CLICK_SAMPLE_SECONDS);
  if (!audio.channels.length || audio.channels[0].length <= limit) return { audio, trimmed: false };
  // The cut ends in a short fade, so it does not click.
  const fade = Math.min(limit, Math.round(audio.sampleRate * 0.01));
  const channels = audio.channels.map((channel) => {
    const kept = channel.slice(0, limit);
    for (let i = 0; i < fade; i++) kept[limit - 1 - i] *= i / fade;
    return kept;
  });
  return { audio: { ...audio, channels }, trimmed: true };
}

export interface ClickSampleSlotState {
  name: string;
  audio: PcmAudio;
}

export interface ClickSampleState {
  down: ClickSampleSlotState | null;
  other: ClickSampleSlotState | null;
  /** A message about the last load: a trimmed file, or one that could not be read. Empty when all is well. */
  notice: string;
  loaded: boolean;
  /** Reads the slots the host kept, once. A slot that cannot be decoded stays empty. */
  load(): Promise<void>;
  /** Copies a file the user picked into a slot. */
  set(slot: ClickSampleSlot, file: File): Promise<void>;
  clear(slot: ClickSampleSlot): Promise<void>;
}

export interface ClickSampleDeps {
  api: ClickSamplesApi;
  /** Decodes an audio file; `maxSeconds` is the longest that is accepted. */
  decode(file: File, maxSeconds: number): Promise<PcmAudio>;
}

const SLOT_LABEL: Record<ClickSampleSlot, string> = { down: "Downbeat", other: "Other beats" };

export function createClickSampleStore(deps: ClickSampleDeps): UseBoundStore<StoreApi<ClickSampleState>> {
  /** Decodes and trims one slot's file; the notice is set when it was cut. */
  const read = async (slot: ClickSampleSlot, name: string, bytes: ArrayBuffer): Promise<{ state: ClickSampleSlotState; notice: string }> => {
    const audio = await deps.decode(new File([bytes], name), MAX_DECODE_SECONDS);
    const result = trimClickSample(audio);
    return {
      state: { name, audio: result.audio },
      notice: result.trimmed
        ? `${SLOT_LABEL[slot]}: ${name} is longer than ${MAX_CLICK_SAMPLE_SECONDS} seconds, so only the first ${MAX_CLICK_SAMPLE_SECONDS} seconds are used.`
        : "",
    };
  };

  return create<ClickSampleState>()((set, get) => ({
    down: null,
    other: null,
    notice: "",
    loaded: false,
    async load() {
      if (get().loaded) return;
      set({ loaded: true });
      const notices: string[] = [];
      for (const slot of CLICK_SAMPLE_SLOTS) {
        try {
          const stored = await deps.api.get(slot);
          if (!stored) continue;
          const { state, notice } = await read(slot, stored.name, stored.bytes);
          set({ [slot]: state });
          if (notice) notices.push(notice);
        } catch {
          notices.push(`${SLOT_LABEL[slot]}: the saved sample could not be read, so those beats use the click.`);
        }
      }
      if (notices.length) set({ notice: notices.join(" ") });
    },
    async set(slot, file) {
      try {
        if (file.size > CLICK_SAMPLE_MAX_BYTES)
          throw new Error(`${file.name} is larger than ${CLICK_SAMPLE_MAX_BYTES / (1024 * 1024)} MB. Use a short drum hit.`);
        const bytes = await file.arrayBuffer();
        const { state, notice } = await read(slot, file.name, bytes);
        // Kept only once it has decoded, so a bad file never replaces a good sample.
        await deps.api.put(slot, { name: file.name, bytes });
        set({ [slot]: state, notice });
      } catch (e) {
        set({ notice: e instanceof Error ? e.message : String(e) });
      }
    },
    async clear(slot) {
      try {
        await deps.api.clear(slot);
        set({ [slot]: null, notice: "" });
      } catch (e) {
        set({ notice: e instanceof Error ? e.message : String(e) });
      }
    },
  }));
}

export const useClickSamples = createClickSampleStore({
  api: { get: (s) => host.clickSamples.get(s), put: (s, v) => host.clickSamples.put(s, v), clear: (s) => host.clickSamples.clear(s) },
  decode: decodeAudioFile,
});
