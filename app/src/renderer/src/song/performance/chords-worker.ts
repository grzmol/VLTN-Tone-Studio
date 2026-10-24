import { detectChords } from './chords';
import type { PcmAudio } from '../types';
self.onmessage = (event: MessageEvent<PcmAudio>) => {
  try { self.postMessage({ chords: detectChords(event.data) }); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
