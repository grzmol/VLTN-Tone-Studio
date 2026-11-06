import { findLyricsQuality, hasWebGpuAdapter, wasmThreads, type LyricsOptions, type LyricsRuntime } from "./lyrics-options";
import { findLyricsModel } from "./lyrics-models";
import { diagnosticOf, preferredRuntime, SKIP_GRAPHICS_STATUS, transcribeAll, type LoadRecogniser } from "./lyrics-passes";
import type { Region } from "./vocal-activity";

// `pieces` are the singing windows (16 kHz mono), `starts` their song times in seconds, and `spans` the song time each window
// is responsible for (windows overlap, so each word is kept by one of them). The passes and their retry rules are in
// lyrics-passes.ts. The worker returns every word with a song time, and a diagnostic; the lines are built on the main thread.
self.onmessage = async (
  event: MessageEvent<{ pieces: Float32Array[]; starts: number[]; spans: Region[]; options: LyricsOptions; graphicsHeardNothing: boolean }>,
) => {
  const { pieces, starts, spans, options, graphicsHeardNothing } = event.data;
  try {
    // Load inside the handler so module/asset failures reach the UI instead of
    // terminating worker startup with an opaque error event.
    const [{ env, pipeline }, { default: wasm }, { default: mjs }] = await Promise.all([
      import("@huggingface/transformers"),
      import("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url"),
      import("onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url"),
    ]);
    const model = findLyricsModel(options.model);
    if (!model) throw new Error(`Unknown lyrics model: ${String(options.model)}`);
    env.allowLocalModels = false;
    env.backends.onnx.wasm!.wasmPaths = { wasm, mjs };
    env.backends.onnx.wasm!.numThreads = wasmThreads(self.crossOriginIsolated, navigator.hardwareConcurrency);
    env.backends.onnx.wasm!.proxy = false;

    // A pipeline per pass, disposed when the pass ends, so a retry starts clean.
    const load: LoadRecogniser = async (runtime: LyricsRuntime) => {
      const transcribe = await pipeline("automatic-speech-recognition", model.repo, {
        device: runtime.device,
        dtype: runtime.dtype,
        progress_callback: (p) => {
          if (p.status === "progress") self.postMessage({ status: `Downloading lyrics model: ${Math.round(p.progress)}% (${p.file})` });
        },
      });
      return {
        run: async (piece) => {
          const output = await transcribe(piece, {
            return_timestamps: "word",
            chunk_length_s: 30,
            stride_length_s: 5,
            task: "transcribe",
            num_beams: findLyricsQuality(options.quality)?.beams ?? 1,
            ...(options.language !== "auto" ? { language: options.language } : {}),
          });
          return Array.isArray(output) ? output[0] : output;
        },
        dispose: () => transcribe.dispose(),
      };
    };

    // WebGPU is tried when an adapter exists. See transcribeAll for when a pass is run again on the CPU.
    // Graphics acceleration that heard nothing for this model in this app version is skipped (the caller remembers that).
    const webgpu = await hasWebGpuAdapter(navigator.gpu);
    const preferred = preferredRuntime(webgpu, graphicsHeardNothing);
    if (webgpu && graphicsHeardNothing) self.postMessage({ status: SKIP_GRAPHICS_STATUS });
    const pass = await transcribeAll(load, { pieces, starts, spans }, preferred, {
      onStatus: (status) => self.postMessage({ status }),
      onPiece: (i) => {
        const partStatus = `Transcribing vocals locally, part ${i + 1} of ${pieces.length}…`;
        self.postMessage({ status: pieces.length > 1 ? partStatus : "Transcribing vocals locally… This may take several minutes." });
      },
    });
    self.postMessage({ words: pass.words, diagnostic: diagnosticOf(pass, pieces.length) });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
