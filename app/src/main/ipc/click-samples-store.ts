// The metronome's own sample files: one per slot, kept as they were loaded next to a small file with their name. Writes are atomic,
// so a crash leaves the old sample (or none), never half of a new one.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CLICK_SAMPLE_MAX_BYTES, type ClickSampleSlot, type StoredClickSample } from "@shared/host/click-samples";

const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";

/** A name fit to show and store: no path, bounded length. */
const cleanName = (name: string): string => name.replace(/[\\/\0]/g, "_").slice(0, 120) || "sample";

export class ClickSampleStore {
  constructor(readonly dir: string) {}

  #file(slot: ClickSampleSlot): string {
    return join(this.dir, `${slot}.bin`);
  }

  #meta(slot: ClickSampleSlot): string {
    return join(this.dir, `${slot}.json`);
  }

  async get(slot: ClickSampleSlot): Promise<StoredClickSample | null> {
    try {
      const [bytes, meta] = await Promise.all([readFile(this.#file(slot)), readFile(this.#meta(slot), "utf8")]);
      const name = (JSON.parse(meta) as { name?: unknown }).name;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return { name: typeof name === "string" ? name : "sample", bytes: copy.buffer };
    } catch (e) {
      // An empty slot, or one whose name file is gone or unreadable, reads as empty: the beats then click.
      if (missing(e) || e instanceof SyntaxError) return null;
      throw e;
    }
  }

  async put(slot: ClickSampleSlot, name: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength === 0 || bytes.byteLength > CLICK_SAMPLE_MAX_BYTES) throw new Error("The sample file is empty or too large.");
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `${slot}.tmp`);
    await writeFile(tmp, bytes);
    await rename(tmp, this.#file(slot));
    await writeFile(this.#meta(slot), JSON.stringify({ name: cleanName(name) }));
  }

  async clear(slot: ClickSampleSlot): Promise<void> {
    await Promise.all([rm(this.#file(slot), { force: true }), rm(this.#meta(slot), { force: true })]);
  }
}
