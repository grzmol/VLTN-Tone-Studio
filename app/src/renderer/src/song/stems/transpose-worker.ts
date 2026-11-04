/// <reference lib="webworker" />
// Web Worker: pitch-shifts the stems off the UI thread (a few seconds per stem). Rubber Band's WebAssembly is
// compiled once per worker, from the app's own bundle (the CSP allows 'self' and wasm).
import { RubberBandInterface } from "rubberband-wasm";
import wasmUrl from "rubberband-wasm/dist/rubberband.wasm?url";
import type { ShiftReply, ShiftRequest } from "./transpose";
import { shiftChannels } from "./transpose-core";

let engine: Promise<RubberBandInterface> | null = null;
const load = () =>
  (engine ??= fetch(wasmUrl).then(async (r) => {
    if (!r.ok) throw new Error(`The pitch shifter couldn't be loaded (${r.status})`);
    return RubberBandInterface.initialize(await WebAssembly.compile(await r.arrayBuffer()));
  }));

self.onmessage = async (e: MessageEvent<ShiftRequest>) => {
  const post = (msg: ShiftReply, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
  try {
    const rb = await load();
    const { stems, sampleRate, semitones } = e.data;
    const out = stems.map((s, i) => ({ name: s.name, channels: shiftChannels(rb, s.channels, sampleRate, semitones, (f) => post({ type: "progress", fraction: (i + f) / stems.length })) }));
    post({ type: "done", stems: out }, out.flatMap((s) => s.channels.map((c) => c.buffer)));
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
