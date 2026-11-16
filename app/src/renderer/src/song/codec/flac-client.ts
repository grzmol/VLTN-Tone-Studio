import { FlacDecoderPool } from "./flac-pool";
import type { FlacBits } from "@shared/flac";
import type { PcmAudio } from "../types";
import type { FlacRequest, FlacResponse } from "./flac-worker";
import { sharePlaybackPcm } from "../audio/playback-pcm";

const playbackDecoders = new FlacDecoderPool();
/** Releases warm decoder threads and rejects pending decodes on page shutdown. */
export function disposePlaybackDecoders(): void {
  playbackDecoders.dispose();
}
if (typeof window !== "undefined") window.addEventListener("pagehide", disposePlaybackDecoders);

function run(request: FlacRequest, transfer: Transferable[]): Promise<FlacResponse & { ok: true }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./flac-worker.ts", import.meta.url), { type: "module" });
    const done = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<FlacResponse>) => {
      done();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      done();
      reject(new Error(event.message || "The audio codec failed to start."));
    };
    worker.postMessage(request, transfer);
  });
}

/** Encodes one track at the given depth (16 for stems and imports; see `storedBits`). The channels are copied into the worker, so the song in memory stays intact. */
export async function encodeTrack(audio: PcmAudio, bits: FlacBits = 16): Promise<Uint8Array> {
  const result = await run({ kind: "encode", audio: { sampleRate: audio.sampleRate, channels: audio.channels, bits } }, []);
  return result.bytes!;
}

/** Decodes one track. The file's buffer is handed to the worker instead of copied. */
export async function decodeTrack(file: ArrayBuffer, options?: { playback: { frames: number; channels: number; sampleRate: number } }): Promise<PcmAudio> {
  if (options) return decodePlaybackTrack(file, options.playback);
  const result = await run({ kind: "decode", bytes: new Uint8Array(file) }, [file]);
  return result.audio!;
}

/** Library playback decodes straight into its canonical AudioBuffer, without a full intermediate PCM track or worker backlog. */
export function decodePlaybackTrack(file: ArrayBuffer, expected: { frames: number; channels: number; sampleRate: number }): Promise<PcmAudio> {
  return new Promise((resolve, reject) => {
    let cancel: (error: unknown) => void = reject;
    playbackDecoders.run({
      reject: (error) => cancel(error),
      start(worker, release) {
        let buffer: AudioBuffer | undefined;
        let audio: PcmAudio | undefined;
        let written = 0;
        let finished = false;
        const close = (healthy: boolean) => {
          finished = true;
          worker.onmessage = null;
          worker.onerror = null;
          release(healthy);
        };
        const fail = (error: unknown) => {
          if (finished) return;
          close(false);
          buffer = undefined;
          audio = undefined;
          reject(error);
        };
        cancel = fail;
        worker.onerror = (event) => fail(new Error(event.message || "The audio codec failed to start."));
        worker.onmessage = (event: MessageEvent<FlacResponse>) => {
          if (finished) return;
          const message = event.data;
          let returned: ArrayBuffer[] = [];
          try {
            if (!message.ok) throw new Error(message.error);
            if (message.header) {
              const h = message.header;
              if (buffer || h.frames !== expected.frames || h.channels !== expected.channels || h.sampleRate !== expected.sampleRate)
                throw new Error("Saved audio does not match its library metadata.");
              buffer = new AudioBuffer({ numberOfChannels: h.channels, length: h.frames, sampleRate: h.sampleRate });
              audio = { sampleRate: h.sampleRate, bits: h.bits, channels: [] };
              sharePlaybackPcm(audio, buffer);
            } else if (message.chunk) {
              const { channels, offset } = message.chunk;
              const frames = channels[0]?.length ?? 0;
              if (
                !buffer ||
                offset !== written ||
                !frames ||
                offset + frames > buffer.length ||
                channels.length !== buffer.numberOfChannels ||
                channels.some((ch) => ch.length !== frames)
              )
                throw new Error("Invalid decoded audio chunk.");
              channels.forEach((channel, index) => buffer!.copyToChannel(channel as Float32Array<ArrayBuffer>, index, offset));
              written += frames;
              returned = channels.map((channel) => channel.buffer as ArrayBuffer);
            } else if (message.done) {
              if (!audio || written !== expected.frames) throw new Error("The FLAC stream is truncated.");
              close(true);
              resolve(audio);
              return;
            } else throw new Error("Invalid audio codec response.");
            // Return the scratch buffers after copying. The worker recycles them, so delivered chunks cannot accumulate awaiting GC.
            worker.postMessage({ kind: "continue", buffers: returned } satisfies FlacRequest, returned);
          } catch (error) {
            fail(error);
          }
        };
        try {
          worker.postMessage({ kind: "decode-playback", bytes: new Uint8Array(file) } satisfies FlacRequest, [file]);
        } catch (error) {
          fail(error);
        }
      },
    });
  });
}
