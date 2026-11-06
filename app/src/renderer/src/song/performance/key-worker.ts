import { readKey, type KeyInput } from "./key";
self.onmessage = (event: MessageEvent<KeyInput>) => {
  try {
    self.postMessage(readKey(event.data));
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
