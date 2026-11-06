import { detectChords, type ChordsInput } from "./chords";

self.onmessage = (event: MessageEvent<ChordsInput>) => {
  try {
    self.postMessage({ chords: detectChords(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
