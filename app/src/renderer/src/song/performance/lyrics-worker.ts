import { transcriptSegments } from './lyrics';
import type { LyricsOptions } from './lyrics-options';

self.onmessage = async (event: MessageEvent<{ pcm: Float32Array; options: LyricsOptions }>) => {
  const { pcm, options } = event.data;
  try {
    // Load inside the handler so module/asset failures reach the UI instead of
    // terminating worker startup with an opaque error event.
    const [{ env, pipeline }, { default: wasm }, { default: mjs }] = await Promise.all([
      import('@huggingface/transformers'),
      import('@whisper-ort/ort-wasm-simd-threaded.jsep.wasm?url'),
      import('@whisper-ort/ort-wasm-simd-threaded.jsep.mjs?url'),
    ]);
    env.allowLocalModels = false;
    env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    const transcribe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
      device: 'wasm', dtype: 'q8',
      progress_callback: p => {
        if (p.status === 'progress') self.postMessage({ status: `Downloading lyrics model: ${Math.round(p.progress)}% (${p.file})` });
      },
    });
    self.postMessage({ status: 'Transcribing vocals locally… This may take several minutes.' });
    const output = await transcribe(pcm, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, task: 'transcribe', ...(options.language !== 'auto' ? { language: options.language } : {}) });
    const result = Array.isArray(output) ? output[0] : output;
    self.postMessage({ segments: transcriptSegments(result.chunks ?? [], pcm.length / 16000) });
    await transcribe.dispose();
  } catch (e) { self.postMessage({ error: e instanceof Error ? e.message : String(e) }); }
};
