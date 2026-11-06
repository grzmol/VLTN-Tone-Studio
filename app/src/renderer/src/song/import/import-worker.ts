import { alignChannels, mixDown } from "./align";

// Lengths the imported tracks of a song, and their sum, off the main thread. The buffers are transferred in and out, so the import
// keeps one copy of each track while this runs.

export interface AlignedTrack {
  key: string;
  channels: Float32Array[];
}

export interface AlignRequest {
  id: number;
  /** The frame count every track is aligned to */
  frames: number;
  /** Whether to sum the tracks into a source as well */
  mix: boolean;
  tracks: AlignedTrack[];
}

export type AlignReply = { id: number; tracks: AlignedTrack[]; mix: Float32Array[] | null } | { id: number; error: string };

self.onmessage = (event: MessageEvent<AlignRequest>) => {
  const { id, frames, mix, tracks } = event.data;
  try {
    const aligned = tracks.map((track) => ({ key: track.key, channels: alignChannels(track.channels, frames) }));
    const sum = mix
      ? mixDown(
          aligned.map((track) => track.channels),
          frames,
        )
      : null;
    const transfer = [...aligned.flatMap((track) => track.channels.map((channel) => channel.buffer)), ...(sum ?? []).map((channel) => channel.buffer)];
    self.postMessage({ id, tracks: aligned, mix: sum } satisfies AlignReply, transfer);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies AlignReply);
  }
};
