import { detectSongSections, type SectionsInput } from "./sections-measure";

self.onmessage = (event: MessageEvent<SectionsInput>) => {
  try {
    self.postMessage({ sections: detectSongSections(event.data) });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
