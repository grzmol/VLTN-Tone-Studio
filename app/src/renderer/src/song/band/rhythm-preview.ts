import type { NoteEvent } from "./note";
import { renderPart, RENDER_RATE } from "./render";
import { loadSampleSet } from "./samples";

/** Plays the export's exact notes with the local clean kit. Stop also cancels a preview whose samples are still loading. */
export function playRhythmPreview(notes: readonly NoteEvent[], duration: number, onDone: () => void): { ready: Promise<void>; stop(): void } {
  const context = new AudioContext();
  let stopped = false;
  let node: AudioBufferSourceNode | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      node?.stop();
    } catch {
      /* A failed preview may not have started its source yet. */
    }
    void context.close();
    onDone();
  };
  const ready = (async () => {
    await context.resume();
    const samples = await loadSampleSet();
    if (stopped) return;
    const { audio } = renderPart(notes, "drums", samples, Math.ceil(duration * RENDER_RATE));
    const buffer = context.createBuffer(2, audio.channels[0].length, RENDER_RATE);
    audio.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
    node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    node.onended = stop;
    node.start();
  })().catch((error: unknown) => {
    stop();
    throw error;
  });
  return { ready, stop };
}
