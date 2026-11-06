import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeFlac } from "@shared/flac";
import { assetName, flacName, type LibraryAudio, type LibrarySong } from "@shared/song-library";
import type { SongLibraryStore } from "./song-library-store";

/** Test helpers: build songs in the v2 (FLAC) format and the v1 (raw float32) format. */
export const FRAMES = 2048;

export function pcm(channels: number, seed: number, frames = FRAMES): Float32Array[] {
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: frames }, (_, i) => 0.5 * Math.sin((i + seed * 31 + c * 7) / (9 + c))));
}

const baseSong = (audio: LibraryAudio[]): LibrarySong => ({
  id: randomUUID(),
  title: "Demo song",
  artist: "Demo band",
  sourceName: "demo.wav",
  duration: FRAMES / 44100,
  audio,
  settings: {
    "": "[00:00] [C] Demo {midi:pc 1 20}",
    ":lyrics": "[00:00] Original demo words",
    ":bpm": "120",
    ":options": JSON.stringify({ songKey: "C major", mix: { guitar: { volume: 0.5, mute: false } } }),
  },
  updated: new Date().toISOString(),
});
const TRACKS: [string, number][] = [
  ["source", 1],
  ["guitar", 2],
];

export interface FixtureSong {
  song: LibrarySong;
  /** Track name → the audio the song was built from. */
  audio: Record<string, Float32Array[]>;
  /** File name → bytes, as written to a revision folder. */
  files: Record<string, Uint8Array>;
}

/** A v2 song: one FLAC file per track. */
export async function flacSong(seed = 1): Promise<FixtureSong> {
  const audio: FixtureSong["audio"] = {},
    files: FixtureSong["files"] = {},
    info: LibraryAudio[] = [];
  for (const [name, channels] of TRACKS) {
    audio[name] = pcm(channels, seed);
    const bytes = await encodeFlac({ sampleRate: 44100, channels: audio[name] });
    files[flacName(name)] = bytes;
    info.push({
      name,
      sampleRate: 44100,
      frames: FRAMES,
      channels,
      file: flacName(name),
      codec: "flac",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  return { song: baseSong(info), audio, files };
}

/** A v1 song: one raw float32 file per channel. */
export function legacySong(seed = 1): FixtureSong {
  const audio: FixtureSong["audio"] = {},
    files: FixtureSong["files"] = {},
    info: LibraryAudio[] = [];
  for (const [name, channels] of TRACKS) {
    audio[name] = pcm(channels, seed);
    audio[name].forEach((channel, c) => (files[assetName(name, c)] = new Uint8Array(channel.buffer)));
    info.push({ name, sampleRate: 44100, frames: FRAMES, channels });
  }
  return { song: baseSong(info), audio, files };
}

export async function saveFlacSong(store: SongLibraryStore, fixture: FixtureSong): Promise<void> {
  const token = await store.begin(fixture.song);
  for (const [name, bytes] of Object.entries(fixture.files)) await store.write(token, name, bytes);
  await store.commit(token);
}

/** Writes a v1 library straight to disk, as an older version of the app left it. */
export async function writeLegacyLibrary(root: string, fixtures: FixtureSong[]): Promise<void> {
  const revisions: Record<string, string> = {};
  for (const fixture of fixtures) {
    const revision = randomUUID();
    revisions[fixture.song.id] = revision;
    await mkdir(join(root, revision), { recursive: true });
    for (const [name, bytes] of Object.entries(fixture.files)) await writeFile(join(root, revision, name), bytes);
  }
  await writeFile(join(root, "library.json"), JSON.stringify({ version: 1, songs: fixtures.map((f) => f.song), playlists: [], revisions }));
}

/** Reads a saved file from the song's current revision folder. */
export async function readSaved(root: string, songId: string, file: string): Promise<Uint8Array> {
  const index = JSON.parse(await readFile(join(root, "library.json"), "utf8"));
  return new Uint8Array(await readFile(join(root, index.revisions[songId], file)));
}
