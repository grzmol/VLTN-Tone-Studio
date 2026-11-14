import { describe, expect, it, vi } from "vitest";
import type { LibraryPreflightSong, LibrarySong } from "@shared/song-library";
import { DEFAULT_BAND_SETTINGS, type PartTone } from "../band/arrangement";
import type { PartToneFiles } from "../band/part-tone";
import type { PlaylistCheck } from "./playlist-preflight";
import { withToneWarnings } from "./tone-preflight";

const cabTone: PartTone = {
  kind: "chain",
  blocks: [{ type: "ir", role: "cab", file: { source: "tone3000", toneId: 9, modelId: 90, name: "Ampeg 6x10" }, inputDb: 0, outputDb: 0, mix: 1, on: true }],
  dryWet: 1,
  fast: false,
};

function saved(id: string, band: unknown): LibraryPreflightSong {
  const song = { id, title: id, settings: { ":options": JSON.stringify({ band }) } } as unknown as LibrarySong;
  return { id, song, errors: [] };
}
const check = (entry: number, id: string): PlaylistCheck => ({ entry, id, title: id, errors: [], warnings: ["earlier"], advice: [], notes: [] });

function files(present: boolean): PartToneFiles {
  const read = async () => {
    if (!present) throw new Error("not-found");
    return "text";
  };
  const bytes = async () => {
    await read();
    return new Uint8Array(1);
  };
  return { readNam: read, readIr: bytes, readLocalNam: read, readLocalIr: bytes };
}

describe("withToneWarnings", () => {
  const snapshot = [saved("a", { ...DEFAULT_BAND_SETTINGS, bassTone: cabTone }), saved("b", DEFAULT_BAND_SETTINGS), saved("c", undefined)];
  const report = [check(1, "a"), check(2, "b"), check(3, "c")];

  it("lists a song with a missing IR, keeps the file for a download, and leaves the other songs alone", async () => {
    const out = await withToneWarnings(report, ["a", "b", "c"], snapshot, files(false));
    expect(out[0].warnings).toHaveLength(2);
    expect(out[0].warnings[0]).toBe("earlier");
    expect(out[0].warnings[1]).toContain("cab IR (Ampeg 6x10) is not on this computer");
    expect(out[0].missingTones?.map((missing) => missing.file.toneId)).toEqual([9]);
    expect(out[1]).toBe(report[1]);
    expect(out[2]).toBe(report[2]);
  });

  it("adds nothing when the files are there", async () => {
    const out = await withToneWarnings(report, ["a", "b", "c"], snapshot, files(true));
    expect(out).toEqual(report);
  });

  it("copes with options that cannot be read", async () => {
    const broken = { id: "a", song: { id: "a", title: "a", settings: { ":options": "{" } } as unknown as LibrarySong, errors: [] };
    const out = await withToneWarnings([check(1, "a")], ["a"], [broken], { readNam: vi.fn(), readIr: vi.fn(), readLocalNam: vi.fn(), readLocalIr: vi.fn() });
    expect(out[0].warnings).toEqual(["earlier"]);
  });
});
