import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** An A2 Lite .nam file (from the public capture fixtures) as bytes, for upload tests (run from `app/`). */
export function a2LiteNamFile(): Uint8Array {
  const vectors = JSON.parse(readFileSync(resolve(process.cwd(), "src/renderer/src/gp150/tests/fixtures/nam-upload-vectors.json"), "utf8"));
  return new TextEncoder().encode(JSON.stringify(vectors.uploads[0].nam));
}
