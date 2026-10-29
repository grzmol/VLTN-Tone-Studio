/**
 * True for a page this app loads itself. Device permissions (MIDI, SysEx, audio capture) go only to these pages.
 * In development the main window loads the dev server, so only its origin counts. Packaged, it loads app://bundle/.
 */
export function isOwnRenderer(url: string | undefined, devUrl: string | undefined): boolean {
  if (!url) return false;
  let page: URL;
  try {
    page = new URL(url);
  } catch {
    return false;
  }
  if (devUrl) {
    try {
      return page.origin === new URL(devUrl).origin;
    } catch {
      return false;
    }
  }
  // Checked by protocol and host: a custom scheme's origin can read as "null" in some Chromium paths.
  return page.protocol === "app:" && page.host === "bundle";
}
