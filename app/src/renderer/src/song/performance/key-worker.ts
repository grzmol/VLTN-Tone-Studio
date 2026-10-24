import { detectKey } from './key';
import type { PcmAudio } from '../types';
self.onmessage = (event: MessageEvent<PcmAudio>) => {
  try { self.postMessage({ estimate: detectKey(event.data) }); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
