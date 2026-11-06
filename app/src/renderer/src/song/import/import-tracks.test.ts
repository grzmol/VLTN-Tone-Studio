import { describe, expect, it } from "vitest";
import type { PcmAudio } from "../types";
import { alignChannels, mixDown } from "./align";
import { freeTrackKeys, importTracks, MAX_IMPORT_BYTES, type ImportOptions } from "./import-tracks";

const RATE = 44100;

/** A stereo file of `seconds` seconds, as the decoder would return it. */
function pcm(seconds: number, value = 0.1): PcmAudio {
  const frames = Math.round(seconds * RATE);
  return { sampleRate: RATE, channels: [new Float32Array(frames).fill(value), new Float32Array(frames).fill(value)] };
}

/** An import with a decoder that reads each file's length from a table, and an aligner that runs the pure functions in place of the worker. */
function run(files: [string, number][], options: Partial<ImportOptions> = {}) {
  const table = new Map(files.map(([name, seconds]) => [name, pcm(seconds)]));
  const fileObjects = files.map(([name]) => new File([new Uint8Array(4)], name));
  return importTracks(fileObjects, {
    taken: [],
    reference: null,
    decode: async (file) => {
      const found = table.get(file.name);
      if (!found) throw new Error(`Couldn't read ${file.name}.`);
      return found;
    },
    align: async ({ frames, mix, tracks }) => {
      const aligned = tracks.map((track) => ({ key: track.key, channels: alignChannels(track.channels, frames) }));
      return {
        tracks: aligned,
        mix: mix
          ? mixDown(
              aligned.map((t) => t.channels),
              frames,
            )
          : null,
      };
    },
    ...options,
  });
}

describe("track numbers", () => {
  it("gives new tracks the first free numbers", () => {
    expect(freeTrackKeys(["track0", "drums", "track2"], 2)).toEqual(["track1", "track3"]);
  });

  it("runs out after 32 tracks", () => {
    const all = Array.from({ length: 32 }, (_, i) => `track${i}`);
    expect(freeTrackKeys(all, 1)).toEqual([]);
  });
});

describe("importing files", () => {
  it("imports each file as a track, keyed by its number, with its name and bus", async () => {
    const outcome = await run([
      ["03 Keys L.wav", 60],
      ["Bass [bus=Aux1] (color=blue).flac", 60],
    ]);
    expect(outcome.tracks.map((t) => [t.key, t.file, t.name, t.bus, t.color])).toEqual([
      ["track0", "track0.flac", "Keys L", "main", undefined],
      ["track1", "track1.flac", "Bass", "aux1", "#3b82f6"],
    ]);
    expect(outcome.notices).toEqual([]);
  });

  it("sends a click or guide to the click bus, and keeps it from following the pitch", async () => {
    const [click] = (await run([["01 Click.wav", 30]])).tracks;
    expect(click.bus).toBe("click");
    expect(click.transpose).toBe(false);
  });

  it("refuses a file in an unsupported format and imports the rest", async () => {
    const outcome = await run([
      ["notes.txt", 10],
      ["Pads.wav", 10],
    ]);
    expect(outcome.tracks.map((t) => t.name)).toEqual(["Pads"]);
    expect(outcome.notices.join(" ")).toContain("notes.txt is not a supported audio file");
  });

  it("reports a file that will not decode and imports the rest", async () => {
    const outcome = await run(
      [
        ["Broken.wav", 10],
        ["Pads.wav", 10],
      ],
      {
        decode: async (file) => {
          if (file.name === "Broken.wav") throw new Error("Couldn't read Broken.wav. Use a WAV, MP3, FLAC, M4A or OGG file.");
          return pcm(10);
        },
      },
    );
    expect(outcome.tracks).toHaveLength(1);
    expect(outcome.notices).toEqual(["Couldn't read Broken.wav. Use a WAV, MP3, FLAC, M4A or OGG file."]);
  });
});

describe("length checks", () => {
  it("imports a track within the tolerance silently, and pads one a few seconds out", async () => {
    const outcome = await run([
      ["Drums.wav", 100],
      ["Keys.wav", 100.3],
      ["Pads.wav", 103],
    ]);
    expect(outcome.tracks).toHaveLength(3);
    expect(outcome.notices).toHaveLength(1);
    expect(outcome.notices[0]).toBe("Pads is 2.7 s longer than the rest. The shorter tracks were padded with silence to match it.");
  });

  it("refuses a track far from the song's length", async () => {
    const outcome = await run([
      ["Drums.wav", 100],
      ["Keys.wav", 100],
      ["Other song.wav", 300],
    ]);
    expect(outcome.tracks.map((t) => t.name)).toEqual(["Drums", "Keys"]);
    expect(outcome.notices.join(" ")).toContain("Other song is");
  });

  it("aligns every track to the song's length when the song has one", async () => {
    const outcome = await run([["Pads.wav", 10]], { reference: 9 * RATE });
    expect(outcome.tracks[0].pcm.channels[0].length).toBe(9 * RATE);
    expect(outcome.source).toBeNull();
    expect(outcome.notices[0]).toBe("Pads is 1.0 s longer than the song. It was cut to the song's length.");
  });
});

describe("a song with no source", () => {
  it("gets the sum of its tracks as its source, aligned to the longest track", async () => {
    const outcome = await run([
      ["Drums.wav", 1],
      ["Keys.wav", 1],
    ]);
    expect(outcome.source).not.toBeNull();
    expect(outcome.source!.channels[0].length).toBe(RATE);
    expect(outcome.source!.channels[0][0]).toBeCloseTo(0.2);
  });
});

describe("limits", () => {
  it("refuses an import that would pass 32 tracks in all", async () => {
    await expect(run(Array.from({ length: 33 }, (_, i) => [`T${i}.wav`, 1] as [string, number]))).rejects.toThrow("up to 32 imported tracks");
  });

  it("refuses a track that would take the import past the memory limit, and does not align it", async () => {
    const huge = { sampleRate: RATE, channels: [{ length: MAX_IMPORT_BYTES / 8 + 1 } as Float32Array, { length: MAX_IMPORT_BYTES / 8 + 1 } as Float32Array] };
    const outcome = await run([["Huge.wav", 1]], {
      decode: async () => huge,
      align: async () => {
        throw new Error("should not align");
      },
    });
    expect(outcome.tracks).toEqual([]);
    expect(outcome.notices.join(" ")).toContain("past 1 GB");
  });
});
