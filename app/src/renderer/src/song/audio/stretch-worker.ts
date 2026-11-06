import { stretchPcm, type StretchSettings } from "./stretch";
import type { PcmAudio } from "../types";

// Renders one stem's stretch and pitch shift off the main thread. The stem's buffers are transferred in and out, so a long song is
// copied once by the client and never blocks the renderer while it is processed.

export interface StretchRequest {
  id: number;
  pcm: PcmAudio;
  settings: StretchSettings;
}

export type StretchReply = { id: number; pcm: PcmAudio } | { id: number; error: string };

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  const { id, pcm, settings } = event.data;
  try {
    const out = stretchPcm(pcm, settings);
    self.postMessage({ id, pcm: out } satisfies StretchReply, out.channels.map((channel) => channel.buffer));
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies StretchReply);
  }
};
