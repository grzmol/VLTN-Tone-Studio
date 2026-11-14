import { create } from "zustand";
import { effectiveMute, practiceSet, readCountsAs, usePracticeMute } from "./performance/practice-mute";
import { host } from "@/host";
import { selectWholeSongStems, useSong } from "./store";
import { useNav } from "@/state/nav";
import {
  emptyLibrary,
  flacName,
  trackKey,
  trackKindOf,
  type LibraryAudio,
  type LibraryBackupPreview,
  type LibraryFolder,
  type LibrarySong,
  type Playlist,
  type RestoreMode,
  type SongLibrary,
  type SongMetaPatch,
} from "@shared/song-library";
import { songsFromHistory } from "@shared/library-history";
import type { TimecodeTail } from "./performance/midi-scheduler";
import { playNext, addToQueue as queueAdd, removeFromQueue as queueRemove, moveInQueue as queueMove, setEntryOverride as queueOverride, type QueueEdit } from "./queue";
import { overridesFor, type EntryOverride } from "@shared/entry-overrides";
import { decodeTrack, encodeTrack } from "./codec/flac-client";
import { storedBits } from "@shared/flac";
import { migrateLyricsJob } from "./performance/lyrics-jobs";
import { playerShapeFromOptions } from "./performance/song-shape";
import { sharedPlaybackEngine } from "./audio/playback-engine";
import { loudnessFromOptions, normalisingGain } from "./audio/loudness";
import { applyPartChoices, defaultPartChoices, muteSilencedParts, partKeysOf, readPartChoices } from "./band/part-choice";
import { mixDefaults } from "./tracks";
import type { Mix } from "./stems/mix";
import { StemPlayer, yieldToMain } from "./stems/player";
import { playableStems } from "./stems/playable";
import { RenderQueue, isPlainSpeed } from "./audio/render-queue";
import { speedFromOptions } from "./performance/speed";
import {
  changeSavedOptions,
  flushSettings,
  forgetSettings,
  migrateLocalSettings,
  performanceKey,
  readSettings,
  seedSettings,
  writeSettings,
} from "./performance/settings";
import { armAsNext, type SongTrigger } from "./performance/song-triggers";
import type { PcmAudio, SongSource, Stems } from "./types";
import { mergeTrackDefaults, savedSettingsOf, trackInfoOf, type TrackInfo } from "./tracks";
import { mixDown } from "./import/align";
import { isSongPlaying, onSongPlayingChange } from "./performance/playing-state";
import { askLeave, leaveGuardShown } from "./leave-guard";

/**
 * A playlist song loaded ahead of time: its audio, and a player whose buffers are already built on the shared engine. The library
 * owns the player until the session takes the song over; the session then owns it.
 */
export interface PreparedSong {
  id: string;
  title: string;
  source: SongSource;
  stems: Stems;
  settings: Record<string, string>;
  /** Each track that is not the source, by key: its mixer name and its saved settings */
  tracks: Record<string, TrackInfo>;
  /** Tracks that could not be read, by name. The song plays without them. */
  skipped: string[];
  player: StemPlayer;
}

/**
 * A playlist song that is already playing on the outgoing song's clock. The library holds it from the hand-over until the session for
 * the new song takes it over, which is a new session because the view is re-created for each song. `unwire` undoes the outgoing
 * session's hook-up of the song.
 */
export interface HandedOverSong {
  id: string;
  player: StemPlayer;
  /** The count-in before the song's audio, in ms */
  countInMs: number;
  /** Clock time of the join, where this song starts on the outgoing song's clock */
  join: number;
  /** The outgoing song's quarter frames up to the join, set at the hand-over. Null when the outgoing song sent no timecode. */
  timecodeTail?: TimecodeTail | null;
  unwire: () => void;
}

/** Stops a handed-over song that no session took up, and frees its player. */
const releaseSong = (handover: HandedOverSong) => {
  handover.unwire();
  void handover.player.dispose();
};

interface LibraryState {
  index: SongLibrary;
  busy: boolean;
  error: string;
  notice: string;
  /** The playlist the Playlists panel should open next, set when a playlist is created. Null once the panel has opened it. */
  focusPlaylistId: string | null;
  transfer: string;
  exportBackup(): Promise<void>;
  /** The backup waiting for the user to choose how to restore it, when some of its songs are already in the library. */
  backupPreview: LibraryBackupPreview | null;
  /** Picks a backup. Restores it at once when nothing in it is already saved; otherwise sets `backupPreview` for the dialog. */
  restoreBackup(): Promise<void>;
  /** Answers the dialog: restore with the chosen mode, or null to cancel. */
  finishRestore(mode: RestoreMode | null): Promise<void>;
  queue: string[];
  /** Per-entry overrides of the queue, aligned with `queue`: the autoplay and end behaviour each entry asks for. */
  queueOverrides: (EntryOverride | null)[];
  position: number;
  playlistPlaying: boolean;
  /** The playlist set the playing queue was started from, or null. Recorded with each play. */
  playingSet: string | null;
  /** The chained song the session holds until it is handed over. A queue edit that changes the next song releases it first. */
  chainHold: { id: string; release(): void } | null;
  holdChain(hold: LibraryState["chainHold"]): void;
  /** Puts `id` straight after the playing song. Returns the reason when the queue did not change. */
  playNextSong(id: string): string | null;
  /** Adds songs to the end of the queue. A single song loaded on its own starts a queue that then plays on. */
  addToQueue(ids: string[], overrides?: (EntryOverride | null)[]): string | null;
  /** Removes an upcoming entry. The playing song and the songs before it cannot be removed. */
  removeFromQueue(index: number): string | null;
  /** Moves an upcoming entry. Targets before the playing song go just after it. */
  moveInQueue(from: number, to: number): string | null;
  /** Sets how an upcoming entry starts and ends: whether it starts by itself, and its end behaviour. Null clears both. */
  setQueueOverride(index: number, override: EntryOverride | null): string | null;
  /** Records a play to its halfway point. Never blocks loading: a failure is logged and the play is not counted. */
  recordPlay(songId: string, setId?: string): void;
  /** Applies one metadata patch to the songs in a single save. */
  organiseSongs(ids: string[], patch: SongMetaPatch): Promise<void>;
  /** Replaces the folder list. Only an empty folder can be removed. */
  saveFolders(folders: LibraryFolder[]): Promise<void>;
  clearHistory(): Promise<void>;
  /** Creates a playlist from the songs played since `since`, in play order. */
  playlistFromHistory(name: string, since: string): Promise<void>;
  /** Changes a playlist's name, entries, sets or smart rules. Resolves true once saved, and false when it failed; the error is then on `error`. */
  updatePlaylist(id: string, change: Partial<Pick<Playlist, "name" | "songs" | "sets" | "smart" | "overrides">>): Promise<boolean>;
  /** Adds a playlist to the end of the list, and asks the Playlists panel to open it. Writes queue, so this is never dropped. */
  addPlaylist(playlist: Playlist): Promise<boolean>;
  /** Sets which playlist the Playlists panel opens, or clears it with null. */
  focusPlaylist(id: string | null): void;
  /** Deletes a playlist. Its songs stay in the library. */
  deletePlaylist(id: string): Promise<boolean>;
  midiSession: { access: MIDIAccess | null; portId: string; inputId: string; armed: boolean; output: unknown } | null;
  playPlaylist(queue: string[], position?: number, setId?: string, overrides?: (EntryOverride | null)[]): Promise<void>;
  advancePlaylist(): Promise<void>;
  skipPlaylist(offset: number): Promise<void>;
  resumePlaylist(): void;
  pausePlaylist(): void;
  rememberMidi(session: LibraryState["midiSession"]): void;
  refresh(): Promise<void>;
  /** Saves the open song, including its audio. Saves run one at a time, in order. Resolves when this save has finished (or failed: see `error`). */
  save(title: string, artist: string): Promise<void>;
  /**
   * Saves the open library song's new audio in the background. Does nothing when the song has no unsaved audio or is not in the library.
   * It waits while a song or playlist plays, and runs one save at a time: a call while one is already queued adds nothing.
   */
  autosave(): void;
  /** The step a save is on ("Encoding Drums (generated)…", "Writing files…"), or an empty string when none is running. */
  saveStep: string;
  /** Why the last save failed, or an empty string. Cleared by the next save that works. */
  saveError: string;
  load(id: string, queue?: string[], position?: number, overrides?: (EntryOverride | null)[]): Promise<void>;
  playlists(value: Playlist[]): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** Copies the saved track settings of the open song onto the saved songs that have the same imported tracks. */
  applyTrackSettings(): Promise<void>;
  /** The playlist's next song, loaded in the background. Null until it has loaded, or when there is none. */
  prepared: PreparedSong | null;
  /** The prepared song, when it is the one after the current song */
  preparedNext(): PreparedSong | null;
  /** Makes the prepared song `id` the current one without a gap. Returns false, and changes nothing, when it is not ready. */
  advanceToPrepared(id: string): boolean;
  /** The song handed over from the outgoing session, until a session takes it over. Null when there is none. */
  handover: HandedOverSong | null;
  /** Holds a song handed over from the outgoing session. A song that is already held is released first. */
  setHandover(handover: HandedOverSong): void;
  /** Gives the held song to the session for song `id`, and returns it. A held song for any other song is released, and null returned. */
  claimHandover(id: string | undefined): HandedOverSong | null;
  /** Stops and releases the held song, when no session took it up. */
  releaseHandover(): void;
  /** Sets (or, with null, removes) the MIDI trigger a saved song loads by. The song's other options are kept. Throws for a song not in the library. */
  setSongTrigger(id: string, trigger: SongTrigger | null): void;
  /** Puts a saved song after the playing one in the playlist, for a trigger that arrives during a set. Returns a hint when it did not move. */
  armNext(id: string): string | null;
  /** The song a MIDI trigger loaded, which the next session for it starts playing. Null when none. */
  autoplayId: string | null;
  requestAutoplay(id: string): void;
  /** Takes the autoplay request when it is for song `id`. Returns true once, then false. */
  takeAutoplay(id: string | undefined): boolean;
}
/** Songs whose speed or pitch render was built in advance, by id. A song that is not here plays at its own speed until its render is ready. */
const renderedAhead = new Set<string>();

/** Whether the song's speed or pitch render was built in advance. */
export function isRenderedAhead(id: string): boolean {
  return renderedAhead.has(id);
}

/**
 * Whether a song's audio is not in the library as it is now. For a library song that means a track whose audio was not loaded from or
 * saved to this song, or a different set of tracks than the saved song has. A song that is not in the library has unsaved audio when it
 * has anything beyond its source: imported or generated tracks, or a stem split.
 */
export function audioUnsaved(source: SongSource | null, stems: Stems | null, saved: LibrarySong | undefined): boolean {
  if (!source) return false;
  const held = Object.entries(stems ?? {}).filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined && entry[0] !== "source");
  if (!source.libraryId) return held.length > 0;
  const unread = unreadTracks.get(source.libraryId) ?? [];
  const unreadSource = unread.some((track) => trackKindOf(track) === "source");
  const current: [string, PcmAudio][] = [...(unreadSource ? [] : [["source", source.audio] as [string, PcmAudio]]), ...held];
  if (current.some(([, audio]) => storedTrack.get(audio)?.songId !== source.libraryId)) return true;
  if (!saved) return false;
  const wanted = new Set([...current.map(([key]) => key), ...unread.map(trackKey)]);
  const stored = saved.audio.map(trackKey);
  return wanted.size !== stored.length || stored.some((key) => !wanted.has(key));
}

/** `audioUnsaved` for the open song and the library as they are now. */
function libraryAudioUnsaved(): boolean {
  const state = useSong.getState(),
    { source } = state,
    stems = selectWholeSongStems(state);
  return audioUnsaved(source, stems, useSongLibrary.getState().index.songs.find((song) => song.id === source?.libraryId));
}

/**
 * Asks before the open song is replaced while it has unsaved audio. Resolves true when the caller may go on: nothing was unsaved, the user
 * chose Don't save, or Save and continue worked. A playlist that is playing never asks: it saves in the background (see `autosave`).
 */
export async function confirmLeave(): Promise<boolean> {
  const library = useSongLibrary.getState();
  if (library.playlistPlaying || !libraryAudioUnsaved() || !leaveGuardShown()) return true;
  const { source } = useSong.getState();
  const saved = library.index.songs.find((song) => song.id === source?.libraryId);
  const title = saved?.title ?? source?.name.replace(/\.[^.]+$/, "") ?? "this song";
  const choice = await askLeave(`Save ${title} first?`, "The audio changes for this song, such as generated drums and bass or imported tracks, aren't saved yet.");
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  await library.save(title, saved?.artist ?? "");
  return useSongLibrary.getState().saveError === "";
}

/** The result line after a save the user asked for: what was written, and what was already saved and kept. */
export function savedNotice(title: string, written: number, kept: number): string {
  const plural = (n: number) => `${n} track${n === 1 ? "" : "s"}`;
  return `Saved ${title} (${plural(written)} written, ${kept} kept).`;
}

const hex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
/** The notice after a song is ready. Tracks that could not be read are named, so the song's gaps are not a mystery. */
function readyNotice(title: string, skipped: string[]): string {
  if (!skipped.length) return `${title} ready.`;
  return `${title} ready. Skipped ${skipped.join(", ")}: missing or damaged audio.`;
}

/**
 * The saved file each loaded track came from, and the song it belongs to. A track whose audio is still this object has not changed, so a
 * save keeps its file instead of encoding it again. Any edit that makes new audio makes a new object, which is encoded as usual.
 */
const storedTrack = new WeakMap<PcmAudio, { songId: string; track: LibraryAudio }>();

/**
 * The saved tracks of a song that could not be read when it was loaded, by song id. The session does not hold their audio, so a re-save
 * carries their stored entries and files over as they are, instead of dropping them. Replaced on every load of the song.
 */
const unreadTracks = new Map<string, LibraryAudio[]>();

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
/**
 * Loads a song's audio from the library, without changing anything in the app. A track that cannot be read is left out and named in
 * `skipped`, so the song still plays. When the source is the track that cannot be read, the source is rebuilt from the tracks that can.
 */
async function fetchSong(index: SongLibrary, id: string): Promise<Omit<PreparedSong, "player">> {
  const song = index.songs.find((s) => s.id === id);
  if (!song) throw new Error("Song is missing from the library.");
  const urls = await api().audioUrls(id);
  const skipped: string[] = [];
  const loaded = await Promise.all(
    song.audio.map(async (track) => {
      try {
        return [track, await loadTrack(urls[trackKey(track)], track, id)] as const;
      } catch (e) {
        // The song still plays without this track, so the reason is kept for the console rather than shown in the notice.
        console.error(`Could not read the ${track.name} audio of ${song.title}`, e);
        skipped.push(track.name);
        return null;
      }
    }),
  );
  const found = loaded.filter((entry) => entry !== null);
  unreadTracks.set(id, song.audio.filter((track) => !found.some(([read]) => read === track)));
  const sourceEntry = found.find(([track]) => trackKindOf(track) === "source");
  const playable = found.filter(([track]) => trackKindOf(track) !== "source");
  if (!sourceEntry && !playable.length) throw new Error("Missing or damaged audio: none of this song's tracks can be read.");
  let source: PcmAudio;
  if (sourceEntry) source = sourceEntry[1];
  else {
    const frames = Math.max(...playable.map(([, pcm]) => pcm.channels[0].length));
    source = { sampleRate: playable[0][1].sampleRate, channels: mixDown(playable.map(([, pcm]) => pcm.channels), frames) };
  }
  const stems: Record<string, PcmAudio> = {};
  const tracks: Record<string, TrackInfo> = {};
  for (const [track, pcm] of playable) {
    stems[trackKey(track)] = pcm;
    tracks[trackKey(track)] = trackInfoOf(track);
  }
  // A song with imported tracks and no split plays its source as a track too, as addTracks leaves it (see store.ts).
  if (sourceEntry && playable.length && !playable.some(([track]) => trackKindOf(track) === "stem")) {
    stems.source = sourceEntry[1];
    tracks.source = { kind: "source", name: "Song" };
  }
  // A track's saved pitch choice is a default: the song's own choice, if it has one, wins.
  const options = song.settings[":options"] ?? "";
  const merged = mergeTrackDefaults(options, tracks);
  return {
    id,
    title: song.title,
    source: { name: song.sourceName, libraryId: song.id, audio: source, bits: sourceEntry?.[1].bits },
    stems: stems as Stems,
    settings: merged === options ? song.settings : { ...song.settings, ":options": merged },
    tracks,
    skipped,
  };
}
/**
 * Loads a saved song's mix and stems for an analysis, without opening the song. The open song, its panel and the song store are not
 * changed, and nothing is played. The caller holds one song's audio at a time, and drops it before it loads the next.
 */
export async function loadSongAudio(id: string): Promise<{ source: PcmAudio; stems: Stems }> {
  const loaded = await fetchSong(await api().index(), id);
  return { source: loaded.source.audio, stems: loaded.stems };
}
/** Reads the index after moving any settings an earlier version left in localStorage into the library. */
async function readIndex(): Promise<SongLibrary> {
  const index = await api().index();
  // A failed move leaves the localStorage copies for the next start; it must not hide the library.
  await migrateLocalSettings(index.songs).catch((e) => console.error("Could not move song settings into the library", e));
  return index;
}
/**
 * Gives a song that is prepared ahead its saved mix: the volumes and mutes, the drums and bass choice, the practice mute and the loudness
 * gain. The player of a playlist join starts before its screen exists, so it must have the mix before the hand-over, or the join would
 * play every track at once (the original drums under the generated ones, say) until the screen applied the mix.
 */
export function applyPracticeMute(song: PreparedSong): void {
  const options = song.settings[":options"] ?? "";
  let saved: { mix?: Mix; partChoice?: unknown } | null = null;
  try {
    saved = JSON.parse(options || "null");
  } catch {
    /* unreadable options: every track plays at the default */
  }
  const keys = partKeysOf(song.tracks, song.stems);
  const choices = readPartChoices(saved?.partChoice, defaultPartChoices(null, keys));
  const base = { ...mixDefaults(song.tracks), ...(saved?.mix && typeof saved.mix === "object" ? saved.mix : {}) };
  const mix = muteSilencedParts(saved?.partChoice === undefined ? applyPartChoices(base, choices, keys) : base, choices, keys);
  const tracks = { keys: song.player.names, info: song.tracks, split: Object.keys(song.stems).length > 0, countsAs: readCountsAs(saved) };
  const loudness = loudnessFromOptions(options);
  const gain = loudness.normalise && loudness.lufs !== null ? normalisingGain(loudness.lufs, loudness.peakDb) : 1;
  song.player.setMix(effectiveMute(mix, practiceSet(usePracticeMute.getState().kinds), tracks), gain);
}
const api = () => {
  if (!host.song.library) throw new Error("Saved songs are available in the desktop app.");
  return host.song.library;
};
export const useSongLibrary = create<LibraryState>((set, get) => {
  let loadGeneration = 0;
  let prefetchGeneration = 0;
  /** The id of the song being loaded in the background, if any */
  let prefetching: string | null = null;
  /** The next song whose background load failed, with the warning shown for it. Cleared when the next song changes or it loads. */
  let preloadWarned: { id: string; message: string } | null = null;
  const clearPreloadWarning = () => {
    if (!preloadWarned) return;
    // Only this warning's text is cleared, so an error from another action stays on the screen.
    if (get().error === preloadWarned.message) set({ error: "" });
    preloadWarned = null;
  };
  const run = async (task: () => Promise<void>) => {
    if (get().busy) return;
    set({ busy: true, error: "", notice: "" });
    try {
      await task();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), playlistPlaying: false, autoplayId: null });
    } finally {
      set({ busy: false });
    }
  };
  /**
   * Playlist writes wait in line, so a write that starts while another is still saving is not dropped. Each change is applied to the
   * playlists as they are when its turn comes, so two quick edits both land, in order. A failed write shows its error; later writes still run.
   */
  let playlistWrites: Promise<boolean> = Promise.resolve(true);
  const writePlaylists = (change: (playlists: Playlist[]) => Playlist[], notice = "Playlist saved."): Promise<boolean> => {
    const write = playlistWrites
      .then(async () => {
        await api().playlists(change(get().index.playlists));
        set({ index: await api().index(), notice });
        return true;
      })
      .catch((e) => {
        set({ error: e instanceof Error ? e.message : String(e) });
        return false;
      });
    playlistWrites = write;
    return write;
  };
  const restore = async (mode: RestoreMode) => {
    const service = api();
    set({ transfer: "Checking library backup…" });
    const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
    try {
      const result = await service.restoreBackup(mode);
      set({
        index: await service.index(),
        queue: [],
        position: -1,
        playlistPlaying: false,
        midiSession: null,
        notice:
          mode === "skip"
            ? `Restored ${result.songs} songs and ${result.playlists} playlists. Skipped ${result.skipped ?? 0} songs already in the library.`
            : `Restored ${result.songs} songs and ${result.playlists} playlists as new copies. Existing songs were kept.`,
      });
      prefetchNext();
    } finally {
      unsubscribe();
      set({ transfer: "" });
    }
  };
  /**
   * Loads the playlist's next song in the background, so that it can start on the same clock as the current one. Only one is held
   * besides the current song. A failure is shown at once as an error naming the song, and the join still stops the set.
   */
  /** Releases the prepared song that is held, if any. Once a song has been taken over, the library no longer holds it. */
  const dropPrepared = () => {
    const { prepared, chainHold } = get();
    if (!prepared) return;
    // A song chained onto the outgoing one is undone first, so its player is not disposed while it is still wired in.
    if (chainHold?.id === prepared.id) {
      set({ chainHold: null });
      chainHold.release();
    }
    set({ prepared: null });
    void prepared.player.dispose();
  };
  const prefetchNext = () => {
    const { index, queue, position, playlistPlaying, prepared } = get();
    const id = playlistPlaying ? queue[position + 1] : undefined;
    // A warning stays until the queue's next song changes, so pausing the set does not clear it.
    if (preloadWarned && preloadWarned.id !== queue[position + 1]) clearPreloadWarning();
    if (!id) {
      if (import.meta.env.DEV && prefetching) console.debug(`[prefetch] ${prefetching} dropped: the set has no next song`);
      prefetchGeneration++;
      prefetching = null;
      dropPrepared();
      return;
    }
    if (prepared?.id === id || prefetching === id) return;
    dropPrepared();
    const generation = ++prefetchGeneration;
    prefetching = id;
    if (import.meta.env.DEV) console.debug(`[prefetch] ${id} started`);
    fetchSong(index, id)
      .then(async (next) => {
        // The buffers are built here, well before the join, a channel at a time. The join then only starts them.
        // A song saved at another speed or pitch is rendered here too, so the join plays it without waiting for a render.
        const options = next.settings[":options"] ?? "";
        const speed = speedFromOptions(options);
        // A song saved without a stem split plays its whole source, as the session does when it loads the song.
        const playable = playableStems(next.stems, next.source.audio);
        let stems = playable;
        if (!isPlainSpeed(speed)) {
          stems = (await new RenderQueue().render(playable, speed)) ?? playable;
          renderedAhead.add(next.id);
        }
        const player = await StemPlayer.create(stems, sharedPlaybackEngine(), playerShapeFromOptions(options), yieldToMain, speed.rate);
        if (generation !== prefetchGeneration) {
          if (import.meta.env.DEV) console.debug(`[prefetch] ${id} dropped: superseded while loading`);
          await player.dispose();
          return;
        }
        if (import.meta.env.DEV) console.debug(`[prefetch] ${id} ready`);
        if (preloadWarned?.id === id) clearPreloadWarning();
        applyPracticeMute({ ...next, player });
        set({ prepared: { ...next, player } });
      })
      .catch((e) => {
        // The reason also goes to the console. The next play or resume prefetches again.
        const reason = e instanceof Error ? e.message : String(e);
        console.error(`Could not prefetch the next set song ${id}`, e);
        // A cancelled or superseded load is silent: the load that replaced it reports its own result.
        if (generation !== prefetchGeneration) return;
        // Shown while the current song plays, so the performer knows before the join. The join itself still stops the set.
        const title = index.songs.find((s) => s.id === id)?.title ?? id;
        const message = `"${title}" cannot be loaded: ${reason.replace(/\.$/, "")}. The set will stop after this song.`;
        preloadWarned = { id, message };
        set({ error: message });
      })
      .finally(() => {
        if (generation === prefetchGeneration) prefetching = null;
      });
  };
  /** The queue as the pure queue functions take it. */
  const queueState = () => ({ queue: get().queue, position: get().position, overrides: get().queueOverrides });
  /** Applies a queue edit: the playing song is untouched, and the next song is prepared again when it has changed. */
  const queueEdit = (edit: QueueEdit, extra: Partial<LibraryState> = {}): string | null => {
    if (!edit.ok) return edit.reason;
    set({ queue: edit.queue, position: edit.position, queueOverrides: edit.overrides, ...extra });
    prefetchNext();
    return null;
  };
  /**
   * `keepSet` is true only when the load continues the set that is playing (Next, Previous, a skip or the advance to the next song).
   * Any other load takes `setId` as its set, or none.
   */
  const load = async (
    id: string,
    queue: string[],
    position: number,
    playlist: boolean,
    overrides: (EntryOverride | null)[] | undefined,
    keepSet: boolean,
    setId: string | null = null,
  ) => {
    // Loading a song replaces the set, so a song held for the next one of the old set is released.
    get().releaseHandover();
    const generation = ++loadGeneration;
    // A song loaded by hand keeps the MIDI remembered by the last one; its session takes the access, ports and input, not the arming.
    if (!playlist) set({ playlistPlaying: false });
    // Switching songs mid-set must not wait on a failed write; the edits stay queued and are retried.
    await flushSettings().catch((e) => console.error("Could not save song settings", e));
    const index = await readIndex(),
      song = index.songs.find((s) => s.id === id);
    if (!song) throw new Error("Song is missing from the library.");
    // Keep the performance controls visible while advancing; Stop can cancel an in-flight load.
    if (!playlist) useNav.getState().go("song", "songs");
    useSong.getState().cancel();
    const next = await fetchSong(index, id);
    if (generation !== loadGeneration) return;
    seedSettings(song.id, song.settings);
    set({
      index,
      queue: [...queue],
      queueOverrides: overridesFor(queue.length, overrides),
      position,
      playlistPlaying: playlist,
      // Walking a set by hand (Next or Previous while paused) keeps its id; any other load takes the set it was given.
      playingSet: keepSet ? get().playingSet : setId,
      notice: readyNotice(song.title, next.skipped),
    });
    useSong.setState({
      source: next.source,
      stems: Object.keys(next.stems).length ? next.stems : null,
      tracks: next.tracks,
      lastSplit: null,
      missingParts: null,
      status: { kind: "idle" },
    });
    useNav.getState().go("song", "performance");
    prefetchNext();
  };
  /**
   * Saves the open song. `manual` is a save the user asked for: it reports its result as a notice. Both kinds report the step they are on,
   * and a failure is kept in `saveError` for the Song header.
   */
  /**
   * Saves wait in line, so two never run at once: they would encode the same tracks twice and write the same song at the same time.
   * A failed save does not stop the ones behind it.
   */
  let saveLine: Promise<unknown> = Promise.resolve();
  const enqueueSave = (task: () => Promise<void>): Promise<void> => {
    const result = saveLine.then(task);
    saveLine = result.catch(() => undefined);
    return result;
  };
  /** Whether an autosave is queued and has not started. */
  let autosaveQueued = false;
  /** Resolves once no song or playlist is playing. Encoding stalls the audio, so a save never starts over the music. */
  const untilStopped = (): Promise<void> =>
    new Promise((resolve) => {
      const playing = () => isSongPlaying() || get().playlistPlaying;
      if (!playing()) return resolve();
      const stops: (() => void)[] = [];
      const check = () => {
        if (playing()) return;
        for (const stop of stops) stop();
        resolve();
      };
      stops.push(onSongPlayingChange(check), useSongLibrary.subscribe(check));
    });
  const writeSong = async (title: string, artist: string, manual: boolean): Promise<void> => {
    set({ saveStep: "Preparing…", saveError: "" });
    try {
      const state = useSong.getState(),
        source = state.source;
      if (!source || ["decoding", "model", "splitting"].includes(state.status.kind)) throw new Error("Wait for the song to finish loading or splitting.");
      const id = source.libraryId ?? crypto.randomUUID();
      // Tracks the session never read are kept as saved. A source that could not be read is only a mix made for playing, never saved.
      const unread = unreadTracks.get(id) ?? [];
      const unreadSource = unread.find((track) => trackKindOf(track) === "source");
      const tracks: [string, PcmAudio][] = [
        ...(unreadSource ? [] : [["source", source.audio] as [string, PcmAudio]]),
        ...Object.entries(selectWholeSongStems(state) ?? {}).filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined && entry[0] !== "source"),
      ];
      // One track at a time keeps the encoder's copy of the audio to a single track.
      // A track still holding the audio it was loaded with keeps its saved file: nothing is sent, and the store carries the file over.
      const assets: { name: string; bytes: Uint8Array }[] = [],
        audioInfo: LibraryAudio[] = [],
        audioObjects: [PcmAudio, LibraryAudio][] = [];
      for (const [key, audio] of tracks) {
        const info = key === "source" ? undefined : state.tracks[key],
          kind = key === "source" ? "source" : (info?.kind ?? "stem");
        const kept = storedTrack.get(audio);
        let file: string, bytes: number, sha256: string;
        if (kept && kept.songId === id && kept.track.file && kept.track.bytes !== undefined && kept.track.sha256) {
          ({ file, bytes, sha256 } = { file: kept.track.file, bytes: kept.track.bytes, sha256: kept.track.sha256 });
        } else {
          set({ saveStep: `Encoding ${info?.name ?? (key === "source" ? "the song" : key)}…` });
          // Stems and imports are 16-bit; the source keeps 24 bits only when its original file was deeper (see `storedBits`).
          const encoded = await encodeTrack(audio, storedBits(kind, source.bits));
          file = flacName(key);
          bytes = encoded.length;
          sha256 = hex(await crypto.subtle.digest("SHA-256", encoded as Uint8Array<ArrayBuffer>));
          assets.push({ name: file, bytes: encoded });
        }
        const entry: LibraryAudio = {
          name: info?.name ?? key,
          sampleRate: audio.sampleRate,
          frames: audio.channels[0].length,
          channels: audio.channels.length,
          file,
          codec: "flac",
          bytes,
          sha256,
          kind,
          ...savedSettingsOf(info),
        };
        audioInfo.push(entry);
        audioObjects.push([audio, entry]);
      }
      const heldKeys = new Set(audioInfo.map(trackKey));
      const carried = unread.filter((track) => !heldKeys.has(trackKey(track)));
      audioInfo.unshift(...carried.filter((track) => trackKindOf(track) === "source"));
      audioInfo.push(...carried.filter((track) => trackKindOf(track) !== "source"));
      const song: LibrarySong = {
        id,
        title: title.trim() || source.name,
        artist: artist.trim(),
        sourceName: source.name,
        duration: unreadSource ? unreadSource.frames / unreadSource.sampleRate : source.audio.channels[0].length / source.audio.sampleRate,
        audio: audioInfo,
        settings: readSettings(performanceKey(source)),
        updated: new Date().toISOString(),
      };
      set({ saveStep: "Writing files…" });
      await api().save(song, assets);
      // The saved files are now this song's stored files, so the next save keeps them too.
      for (const [audio, entry] of audioObjects) storedTrack.set(audio, { songId: id, track: entry });
      if (useSong.getState().source === source) {
        const saved = { ...source, libraryId: id };
        // Background transcription/key analysis can finish while audio is being copied.
        // Promote the latest settings, not the snapshot taken before the async save.
        const latest = readSettings(performanceKey(source));
        seedSettings(id, song.settings);
        writeSettings(performanceKey(saved), latest);
        migrateLyricsJob(performanceKey(source), performanceKey(saved));
        if (!source.libraryId) useSong.setState({ source: saved });
        await flushSettings();
      }
      const index = await api().index();
      if (manual) set({ index, notice: savedNotice(song.title, assets.length, tracks.length - assets.length) });
      else set({ index });
    } catch (e) {
      set({ saveError: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      set({ saveStep: "" });
    }
  };
  return {
    index: emptyLibrary(),
    busy: false,
    error: "",
    notice: "",
    focusPlaylistId: null,
    transfer: "",
    queue: [],
    queueOverrides: [],
    position: -1,
    playlistPlaying: false,
    playingSet: null,
    chainHold: null,
    midiSession: null,
    prepared: null,
    handover: null,
    autoplayId: null,
    requestAutoplay: (id) => set({ autoplayId: id }),
    takeAutoplay: (id) => {
      if (!id || get().autoplayId !== id) return false;
      set({ autoplayId: null });
      return true;
    },
    setSongTrigger: (id, trigger) => {
      const { index } = get();
      const song = index.songs.find((s) => s.id === id);
      if (!song) throw new Error("Song is missing from the library.");
      const options = changeSavedOptions(id, song.settings[":options"], (current) => ({ ...current, midiTrigger: trigger ?? undefined }));
      set({ index: { ...index, songs: index.songs.map((s) => (s.id === id ? { ...s, settings: { ...s.settings, ":options": options } } : s)) } });
    },
    armNext: (id) => {
      const { index, queue, position, playlistPlaying, queueOverrides } = get();
      if (!playlistPlaying) return "Arming a song as next needs a playlist that is playing.";
      const title = index.songs.find((s) => s.id === id)?.title ?? "That song";
      const result = armAsNext(queue, position, id);
      if (!result.ok) {
        return {
          current: `${title} is playing.`,
          played: `${title} has already played in this set.`,
          next: `${title} is already next.`,
        }[result.reason];
      }
      // The armed song takes its override with it, and the songs in between keep theirs.
      const overrides = overridesFor(queue.length, queueOverrides);
      const from = queue.indexOf(id);
      const moved = overrides[from];
      const rest = overrides.filter((_, i) => i !== from);
      set({ queue: result.queue, queueOverrides: [...rest.slice(0, position + 1), moved, ...rest.slice(position + 1)], notice: `${title} plays next.` });
      prefetchNext();
      return null;
    },
    setHandover: (handover) => {
      get().releaseHandover();
      set({ handover });
    },
    claimHandover: (id) => {
      const { handover } = get();
      if (!handover) return null;
      set({ handover: null });
      if (handover.id === id) return handover;
      releaseSong(handover);
      return null;
    },
    releaseHandover: () => {
      const { handover } = get();
      if (!handover) return;
      set({ handover: null });
      releaseSong(handover);
    },
    preparedNext: () => {
      const { prepared, queue, position, playlistPlaying } = get();
      return playlistPlaying && prepared && queue[position + 1] === prepared.id ? prepared : null;
    },
    advanceToPrepared: (id) => {
      const { prepared, queue, position, playlistPlaying } = get();
      if (!prepared || prepared.id !== id || !playlistPlaying || queue[position + 1] !== id) return false;
      loadGeneration++;
      seedSettings(prepared.id, prepared.settings);
      useSong.getState().cancel();
      set({ position: position + 1, prepared: null, notice: readyNotice(prepared.title, prepared.skipped) });
      useSong.setState({
        source: prepared.source,
        stems: Object.keys(prepared.stems).length ? prepared.stems : null,
        tracks: prepared.tracks,
        lastSplit: null,
        missingParts: null,
        status: { kind: "idle" },
      });
      prefetchNext();
      return true;
    },
    exportBackup: () =>
      run(async () => {
        const service = api();
        set({ transfer: "Preparing library backup…" });
        const unsubscribe = service.onTransferProgress((p) => set({ transfer: `${p.phase} · ${p.completed} / ${p.total} files` }));
        try {
          await flushSettings();
          const result = await service.exportBackup();
          set({ notice: result ? `Exported ${result.songs} songs and ${result.playlists} playlists to ${result.fileName}.` : "Backup export cancelled." });
        } finally {
          unsubscribe();
          set({ transfer: "" });
        }
      }),
    backupPreview: null,
    restoreBackup: () =>
      run(async () => {
        const service = api();
        const preview = await service.inspectBackup();
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
    holdChain: (chainHold) => set({ chainHold }),
    playNextSong: (id) => {
      if (get().position < 0) return "Load a song first.";
      return queueEdit(playNext(queueState(), id));
    },
    addToQueue: (ids, overrides) => {
      const { queue, position, playlistPlaying } = get();
      if (position < 0) return "Load a song first.";
      // One song loaded on its own starts the queue: the songs added after it play on when it ends.
      const starts = !playlistPlaying && queue.length === 1 && position === 0 && ids.length > 0;
      return queueEdit(queueAdd(queueState(), ids, overrides), starts ? { playlistPlaying: true } : {});
    },
    removeFromQueue: (index) => {
      return queueEdit(queueRemove(queueState(), index));
    },
    moveInQueue: (from, to) => {
      return queueEdit(queueMove(queueState(), from, to));
    },
    setQueueOverride: (index, override) => {
      const edit = queueOverride(queueState(), index, override);
      if (!edit.ok) return edit.reason;
      set({ queueOverrides: edit.overrides });
      // The next song's autoplay decides whether it may be chained onto the playing one, so a change to it undoes a chain already made.
      const { chainHold, position } = get();
      if (index === position + 1 && chainHold) {
        set({ chainHold: null });
        chainHold.release();
      }
      return null;
    },
    recordPlay: (songId, setId) => {
      // The count is written in the background, so a play never waits on the disk or blocks loading.
      void Promise.resolve()
        .then(() => api().organise({ kind: "played", id: songId, at: new Date().toISOString(), ...(setId ? { setId } : {}) }))
        .then(async () => set({ index: await api().index() }))
        .catch((e) => console.error("Could not record the play", e));
    },
    organiseSongs: (ids, patch) =>
      run(async () => {
        await api().organise({ kind: "songs", ids, patch });
        set({ index: await api().index(), notice: `Updated ${ids.length} song${ids.length === 1 ? "" : "s"}.` });
      }),
    saveFolders: (folders) =>
      run(async () => {
        await api().organise({ kind: "folders", folders });
        set({ index: await api().index(), notice: "Folders saved." });
      }),
    clearHistory: () =>
      run(async () => {
        await api().organise({ kind: "history", history: [] });
        set({ index: await api().index(), notice: "Play history cleared." });
      }),
    playlistFromHistory: (name, since) =>
      run(async () => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error("Name the playlist first.");
        const { index } = get();
        const songs = songsFromHistory(index.songs, index.history, since);
        if (!songs.length) throw new Error("No songs were played since that date.");
        await api().playlists([...index.playlists, { id: crypto.randomUUID(), name: trimmed, songs, sets: [] }]);
        set({ index: await api().index(), notice: `Created ${trimmed} with ${songs.length} songs from the history.` });
      }),
    updatePlaylist: (id, change) =>
      writePlaylists(
        (playlists) => playlists.map((p) => (p.id === id ? { ...p, ...change } : p)),
        `Saved ${change.name ?? get().index.playlists.find((p) => p.id === id)?.name ?? "the playlist"}.`,
      ),
    addPlaylist: (playlist) =>
      writePlaylists((playlists) => [...playlists, playlist], `Created ${playlist.name}.`).then((ok) => {
        if (ok) set({ focusPlaylistId: playlist.id });
        return ok;
      }),
    focusPlaylist: (focusPlaylistId) => set({ focusPlaylistId }),
    deletePlaylist: (id) => writePlaylists((playlists) => playlists.filter((p) => p.id !== id)),
    rememberMidi: (midiSession) => set({ midiSession }),
    pausePlaylist: () => {
      loadGeneration++;
      get().releaseHandover();
      set({ playlistPlaying: false });
      prefetchNext();
    },
    resumePlaylist: () => {
      if (!get().busy && get().queue.length) set({ playlistPlaying: true, error: "", notice: "" });
      prefetchNext();
    },
    playPlaylist: async (queue, position = 0, setId, overrides) => {
      if (!(await confirmLeave())) return;
      await run(async () => {
        if (!queue.length || !queue[position]) throw new Error("This playlist is empty.");
        set({ playlistPlaying: true, midiSession: null });
        await load(queue[position], queue, position, true, overrides, false, setId ?? null);
      });
    },
    advancePlaylist: () =>
      run(async () => {
        const { queue, position, playlistPlaying } = get();
        if (!playlistPlaying) return;
        if (position + 1 >= queue.length) {
          set({ playlistPlaying: false, notice: "Playlist finished." });
          return;
        }
        const nextId = queue[position + 1];
        if (get().advanceToPrepared(nextId)) return;
        const loading = prefetching === nextId;
        await load(nextId, queue, position + 1, true, get().queueOverrides, true);
        if (loading) set({ notice: "The next song was still loading, so it started after a gap." });
      }),
    skipPlaylist: async (offset) => {
      // Walking a set by hand asks first. Next and Previous in a set that is playing never do.
      const { queue, position } = get();
      if (position + offset < 0 || position + offset >= queue.length) return;
      if (!(await confirmLeave())) return;
      await run(async () => {
        const { queue, position, playlistPlaying } = get(),
          next = position + offset;
        if (next < 0 || next >= queue.length) return;
        await load(queue[next], queue, next, playlistPlaying, get().queueOverrides, true);
      });
    },
    refresh: () =>
      run(async () => {
        set({ index: await readIndex() });
      }),
    save: (title, artist) => run(() => enqueueSave(() => writeSong(title, artist, true))),
    autosave: () => {
      // One queued autosave covers every change made before it starts, so a burst of changes makes one save.
      if (autosaveQueued || !libraryAudioUnsaved()) return;
      autosaveQueued = true;
      void untilStopped()
        .then(() =>
          enqueueSave(async () => {
            autosaveQueued = false;
            // The song may have been saved, replaced or left since this was queued.
            const { source } = useSong.getState();
            const saved = get().index.songs.find((song) => song.id === source?.libraryId);
            if (!saved || !libraryAudioUnsaved()) return;
            await writeSong(saved.title, saved.artist, false);
          }),
        )
        .catch(() => undefined)
        .finally(() => {
          autosaveQueued = false;
        });
    },
    saveStep: "",
    saveError: "",
    load: async (id, queue = [id], position = 0, overrides) => {
      if (!(await confirmLeave())) return;
      await run(() => load(id, queue, position, false, overrides, false));
    },
    playlists: (playlists) => writePlaylists(() => playlists),
    applyTrackSettings: () =>
      run(async () => {
        const id = useSong.getState().source?.libraryId;
        if (!id) throw new Error("Save the song before applying its track settings.");
        const changed = await api().applyTrackSettings(id);
        set({
          index: await api().index(),
          notice: changed ? `Applied the track settings to ${changed} similar song${changed === 1 ? "" : "s"}.` : "No other saved song has the same imported tracks.",
        });
      }),
    remove: (id) =>
      run(async () => {
        const source = useSong.getState().source;
        // A song that is still open keeps its settings, now as an unsaved song.
        const kept = source?.libraryId === id ? readSettings(performanceKey(source)) : null;
        await api().remove(id);
        forgetSettings(id);
        if (source && kept) {
          const detached = { ...source, libraryId: undefined };
          writeSettings(performanceKey(detached), kept);
          useSong.setState({ source: detached });
        }
        const { queue, position, queueOverrides } = get();
        // Removing the song that is playing ends its queue, as before. Removing a song that is only queued drops it from the queue, and the
        // song that is playing, and the set, carry on.
        if (queue[position] === id || position < 0) {
          set({
            index: await api().index(),
            queue: [],
            queueOverrides: [],
            position: -1,
            playlistPlaying: false,
            playingSet: null,
            midiSession: null,
            notice: "Song removed from the library and playlists.",
          });
        } else {
          const keep = queue.map((entry, i) => i <= position || entry !== id);
          set({
            index: await api().index(),
            queue: queue.filter((_, i) => keep[i]),
            queueOverrides: overridesFor(queue.length, queueOverrides).filter((_, i) => keep[i]),
            notice: "Song removed from the library and playlists.",
          });
        }
        prefetchNext();
      }),
  };
});

// The song prepared for the next join follows the practice mute while it waits, so a change made during the current song is in place at the join.
usePracticeMute.subscribe((state, previous) => {
  if (state.kinds === previous.kinds) return;
  const prepared = useSongLibrary.getState().prepared;
  if (prepared) applyPracticeMute(prepared);
});

// Audio that changes in a library song saves itself. Loading a song sets audio that is already saved, so it never starts a save.
useSong.subscribe((state, previous) => {
  if (state.stems === previous.stems && state.source === previous.source) return;
  if (!state.source?.libraryId || ["decoding", "model", "splitting"].includes(state.status.kind)) return;
  useSongLibrary.getState().autosave();
});
