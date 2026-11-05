import { create } from "zustand";
import { host } from "@/host";
import { useNav } from "@/state/nav";
import { useSong } from "./store";
import { decodeTrack, encodeTrack } from "./codec/flac-client";
import { storedBits } from "@shared/flac";
import {
  emptyLibrary,
  flacName,
  trackKey,
  trackKindOf,
  type LibraryAudio,
  type LibraryBackupPreview,
  type LibrarySong,
  type RestoreMode,
  type SongLibrary,
} from "@shared/song-library";
import { STEM_NAMES, type PcmAudio, type Stems } from "./types";

interface LibraryState {
  index: SongLibrary;
  busy: boolean;
  error: string;
  notice: string;
  /** Progress line of a backup export or restore, while one runs */
  transfer: string;
  /** The backup waiting for the user to choose how to restore it, when some of its songs are already in the library. */
  backupPreview: LibraryBackupPreview | null;
  refresh(): Promise<void>;
  /** Saves the open song, its source and its stems, under this title and artist. Saving a song that came from the library replaces it. */
  save(title: string, artist: string): Promise<void>;
  /** Opens a saved song on the Stems tab, ready to play. */
  load(id: string): Promise<void>;
  /** Moves a saved song to the Trash. */
  remove(id: string): Promise<void>;
  exportBackup(): Promise<void>;
  /** Picks a backup. Restores it at once when nothing in it is already saved; otherwise sets `backupPreview` for the dialog. */
  restoreBackup(): Promise<void>;
  /** Answers the dialog: restore with the chosen mode, or null to cancel. */
  finishRestore(mode: RestoreMode | null): Promise<void>;
}

const hex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The saved file each loaded track came from, and the song it belongs to. A track whose audio is still this object has not changed, so a
 * save keeps its file instead of encoding it again. Any edit that makes new audio makes a new object, which is encoded as usual.
 */
const storedTrack = new WeakMap<PcmAudio, { songId: string; track: LibraryAudio }>();

/** Fetches a saved track straight from the app protocol and decodes it in a worker; nothing is copied through IPC. */
async function loadTrack(url: string, track: LibraryAudio, songId: string): Promise<PcmAudio> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Missing or damaged ${track.name} audio.`);
  const file = await response.arrayBuffer();
  if (track.bytes !== undefined && file.byteLength !== track.bytes) throw new Error(`Missing or damaged ${track.name} audio.`);
  const audio = await decodeTrack(file);
  if (audio.channels.length !== track.channels || audio.channels[0].length !== track.frames || audio.sampleRate !== track.sampleRate)
    throw new Error(`Missing or damaged ${track.name} audio.`);
  storedTrack.set(audio, { songId, track });
  return audio;
}

/** The sum of the stems, as long as the longest. Stems are stereo, and the sum is not scaled: it only stands in for a source that was lost. */
function sumStems(stems: PcmAudio[]): PcmAudio {
  const frames = Math.max(...stems.map((stem) => stem.channels[0].length));
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  for (const stem of stems)
    for (let c = 0; c < 2; c++) {
      const from = stem.channels[Math.min(c, stem.channels.length - 1)];
      for (let i = 0; i < from.length; i++) channels[c][i] += from[i];
    }
  return { sampleRate: stems[0].sampleRate, channels };
}

const isStemName = (key: string): key is keyof Stems => (STEM_NAMES as readonly string[]).includes(key);

interface FetchedSong {
  source: PcmAudio;
  /** The source's bit depth when it was stored deeper than 16 bits */
  bits?: number;
  stems: Stems;
  /** Tracks that could not be read, or that this version does not play, by name. The song opens without them. */
  skipped: string[];
}

/**
 * Loads a song's audio from the library. A track that cannot be read is left out and named in `skipped`, so the song still opens. When the
 * source is the track that cannot be read, it is rebuilt from the stems that can.
 */
async function fetchSong(index: SongLibrary, id: string): Promise<FetchedSong> {
  const song = index.songs.find((s) => s.id === id);
  if (!song) throw new Error("Song is missing from the library.");
  const urls = await api().audioUrls(id);
  const skipped: string[] = [];
  const loaded = await Promise.all(
    song.audio.map(async (track) => {
      const key = trackKey(track);
      if (trackKindOf(track) !== "source" && !isStemName(key)) {
        skipped.push(track.name);
        return null;
      }
      try {
        return [track, await loadTrack(urls[key], track, id)] as const;
      } catch (e) {
        // The song still opens without this track, so the reason is kept for the console rather than shown in the notice.
        console.error(`Could not read the ${track.name} audio of ${song.title}`, e);
        skipped.push(track.name);
        return null;
      }
    }),
  );
  const found = loaded.filter((entry) => entry !== null);
  const sourceEntry = found.find(([track]) => trackKindOf(track) === "source");
  const playable = found.filter(([track]) => trackKindOf(track) !== "source");
  if (!sourceEntry && !playable.length) throw new Error("Missing or damaged audio: none of this song's tracks can be read.");
  const source = sourceEntry ? sourceEntry[1] : sumStems(playable.map(([, pcm]) => pcm));
  const stems: Stems = {};
  for (const [track, pcm] of playable) stems[trackKey(track) as keyof Stems] = pcm;
  return { source, bits: sourceEntry?.[1].bits, stems, skipped };
}

/** The notice after a song is ready. Tracks that could not be read are named, so the song's gaps are not a mystery. */
function readyNotice(title: string, skipped: string[]): string {
  if (!skipped.length) return `${title} ready.`;
  return `${title} ready. Skipped ${skipped.join(", ")}: missing, damaged or not supported yet.`;
}

const api = () => {
  if (!host.song.library) throw new Error("Saved songs are available in the desktop app.");
  return host.song.library;
};

export const useSongLibrary = create<LibraryState>((set, get) => {
  const run = async (task: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: "", notice: "" });
    try {
      await task();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ busy: false });
    }
  };
  const restore = async (mode: RestoreMode) => {
    const service = api();
    set({ transfer: "Checking library backup…" });
    const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
    try {
      const result = await service.restoreBackup(mode);
      set({
        index: await service.index(),
        notice:
          mode === "skip"
            ? `Restored ${result.songs} songs. Skipped ${result.skipped ?? 0} songs already in the library.`
            : `Restored ${result.songs} songs as new copies. Existing songs were kept.`,
      });
    } finally {
      unsubscribe();
      set({ transfer: "" });
    }
  };
  return {
    index: emptyLibrary(),
    busy: false,
    error: "",
    notice: "",
    transfer: "",
    backupPreview: null,
    refresh: () =>
      run(async () => {
        set({ index: await api().index() });
      }),
    save: (title, artist) =>
      run(async () => {
        const state = useSong.getState(),
          source = state.source;
        if (!source || ["decoding", "model", "splitting"].includes(state.status.kind)) throw new Error("Wait for the song to finish loading or splitting.");
        const id = source.libraryId ?? crypto.randomUUID();
        const tracks: [string, PcmAudio][] = [
          ["source", source.audio],
          ...Object.entries(state.stems ?? {}).filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined),
        ];
        // One track at a time keeps the encoder's copy of the audio to a single track.
        // A track still holding the audio it was loaded with keeps its saved file: nothing is sent, and the store carries the file over.
        const assets: { name: string; bytes: Uint8Array }[] = [],
          audioInfo: LibraryAudio[] = [],
          audioObjects: [PcmAudio, LibraryAudio][] = [];
        for (const [key, audio] of tracks) {
          const kind = key === "source" ? "source" : "stem";
          const kept = storedTrack.get(audio);
          let file: string, bytes: number, sha256: string;
          if (kept && kept.songId === id && kept.track.file && kept.track.bytes !== undefined && kept.track.sha256) {
            ({ file, bytes, sha256 } = { file: kept.track.file, bytes: kept.track.bytes, sha256: kept.track.sha256 });
          } else {
            // Stems are 16-bit; the source keeps 24 bits only when its original file was deeper (see `storedBits`).
            const encoded = await encodeTrack(audio, storedBits(kind, source.bits));
            file = flacName(key);
            bytes = encoded.length;
            sha256 = hex(await crypto.subtle.digest("SHA-256", encoded as Uint8Array<ArrayBuffer>));
            assets.push({ name: file, bytes: encoded });
          }
          const entry: LibraryAudio = {
            name: key,
            sampleRate: audio.sampleRate,
            frames: audio.channels[0].length,
            channels: audio.channels.length,
            file,
            codec: "flac",
            bytes,
            sha256,
            kind,
          };
          audioInfo.push(entry);
          audioObjects.push([audio, entry]);
        }
        const saved = get().index.songs.find((s) => s.id === id);
        const song: LibrarySong = {
          id,
          title: title.trim() || source.name,
          artist: artist.trim(),
          sourceName: source.name,
          duration: source.audio.channels[0].length / source.audio.sampleRate,
          audio: audioInfo,
          // What the song saved before stays: this version has nothing of its own to put here.
          settings: saved?.settings ?? {},
          updated: new Date().toISOString(),
        };
        await api().save(song, assets);
        // The saved files are now this song's stored files, so the next save keeps them too.
        for (const [audio, entry] of audioObjects) storedTrack.set(audio, { songId: id, track: entry });
        if (useSong.getState().source === source && !source.libraryId) useSong.setState({ source: { ...source, libraryId: id } });
        set({ index: await api().index(), notice: `Saved ${song.title}, including audio and stems.` });
      }),
    load: (id) =>
      run(async () => {
        const index = await api().index(),
          song = index.songs.find((s) => s.id === id);
        if (!song) throw new Error("Song is missing from the library.");
        useSong.getState().cancel();
        const next = await fetchSong(index, id);
        useSong.setState({
          source: { name: song.sourceName, libraryId: song.id, audio: next.source, bits: next.bits },
          stems: Object.keys(next.stems).length ? next.stems : null,
          range: null,
          lastSplit: null,
          status: Object.keys(next.stems).length ? { kind: "done" } : { kind: "idle" },
        });
        set({ index, notice: readyNotice(song.title, next.skipped) });
        useNav.getState().go("song", "stems");
      }),
    remove: (id) =>
      run(async () => {
        const source = useSong.getState().source;
        await api().remove(id);
        // A song that is still open stays open, now as an unsaved song.
        if (source?.libraryId === id) useSong.setState({ source: { ...source, libraryId: undefined } });
        set({ index: await api().index(), notice: "Song moved to the Trash." });
      }),
    exportBackup: () =>
      run(async () => {
        const service = api();
        set({ transfer: "Preparing library backup…" });
        const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
        try {
          const result = await service.exportBackup();
          set({ notice: result ? `Exported ${result.songs} songs to ${result.fileName}.` : "Backup export cancelled." });
        } finally {
          unsubscribe();
          set({ transfer: "" });
        }
      }),
    restoreBackup: () =>
      run(async () => {
        const preview = await api().inspectBackup();
        if (!preview) {
          set({ notice: "Backup restore cancelled." });
          return;
        }
        if (preview.duplicates) {
          set({ backupPreview: preview });
          return;
        }
        await restore("copy");
      }),
    finishRestore: (mode) =>
      run(async () => {
        set({ backupPreview: null });
        if (!mode) {
          set({ notice: "Backup restore cancelled." });
          return;
        }
        await restore(mode);
      }),
  };
});
