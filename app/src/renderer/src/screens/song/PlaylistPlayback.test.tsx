import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyLibrary, type LibrarySong } from "@shared/song-library";
import { useSong } from "@/song/store";
import { clearSettingsCache } from "@/song/performance/settings";
import { useSongLibrary } from "@/song/library";
import { useBluetooth, type BleMidiConnection } from "@/bluetooth/connection";
import { useNav } from "@/state/nav";
import { PerformancePanel } from "./PerformancePanel";
import { SongScreen } from "./SongScreen";
import type { SchedulerConfig, ScheduledMessage } from "@/song/performance/midi-scheduler";
// jsdom has no browser Worker; exercise the production schedule through the bridge mock.
vi.mock("@/song/performance/midi-scheduler-client", async () => {
  const { MidiSchedule } = await import("@/song/performance/midi-scheduler");
  const now = () => performance.timeOrigin + performance.now();
  return {
    midiNow: now,
    prepareMidiScheduler: () => ({ worker: { terminate: vi.fn() }, ready: Promise.resolve(), cancel: vi.fn() }),
    startMidiScheduler: (config: SchedulerConfig, send: (message: ScheduledMessage) => void, fault: (message: string) => void) => {
      const schedule = new MidiSchedule(config, now(), (reply) => {
        if (reply.type === "fault") fault(reply.error);
        else if (reply.type === "batch") reply.messages.forEach(send);
      });
      schedule.tick(now());
      const timer = setInterval(() => schedule.tick(now()), 20);
      return {
        stop() {
          schedule.stop();
          clearInterval(timer);
        },
        sync(position: number) {
          schedule.sync(position, now(), now());
        },
      };
    },
  };
});

const mock = vi.hoisted(() => ({
  audioUrls: vi.fn(),
  fetch: vi.fn(),
  index: vi.fn(),
  settings: vi.fn(),
  send: vi.fn(),
  clear: vi.fn(),
  now: 0,
  players: [] as { isPlaying: boolean; position: number; duration: number; onEnded: (() => void) | null; end(): void }[],
}));
/** A player as the tests see it: its chained song, and whether it was stopped rather than played out */
type Player = { isPlaying: boolean; position: number; duration: number; onEnded: (() => void) | null; end(): void; next: Player | null; stopped: boolean };
vi.mock("@/song/audio/playback-engine", () => ({ sharedPlaybackEngine: () => ({}) }));
vi.mock("@/host", () => ({ host: { song: { library: { index: mock.index, audioUrls: mock.audioUrls, updateSettings: mock.settings } } } }));
vi.mock("@/song/stems/engine", () => ({ separateStems: vi.fn() }));
vi.mock("@/song/codec/flac-client", () => ({ decodeTrack: async () => ({ sampleRate: 10, channels: [new Float32Array(100)] }), encodeTrack: vi.fn() }));
vi.stubGlobal("fetch", mock.fetch);
const file = () => new Response(new Uint8Array(8));
vi.mock("./LyricsTrack", () => ({ LyricsTrack: () => null }));
// The other Song tabs are not under test here; the queue is edited through the library store, as its panel would.
vi.mock("./SongLibraryPanel", () => ({ SongLibraryPanel: () => null }));
vi.mock("./stems/StemsPanel", () => ({ StemsPanel: () => null }));
vi.mock("./tonematch/ToneMatchPanel", () => ({ ToneMatchPanel: () => null }));
vi.mock("@/bluetooth/BluetoothControls", () => ({ BluetoothControls: () => null }));
vi.mock("@/song/stems/player", () => ({
  yieldToMain: () => Promise.resolve(),
  StemPlayer: class {
    static async create(stems: Record<string, unknown>) {
      // As the real player does: a song with no stems cannot be played.
      if (!Object.keys(stems).length) throw new Error("There are no stems to play.");
      // A prepared player is not one of the songs the test plays, so it is not recorded as one.
      const player = new this();
      mock.players.pop();
      return player;
    }
    outputChannels = 2;
    setOutputs() {
      return Promise.resolve();
    }
    setTrackBuses() {}
    setShape() {}
    testTone() {}
    names = ["other"];
    duration = 10;
    playbackRate = 1;
    position = 0;
    start = 0;
    behaviour = "next";
    isPlaying = false;
    setEndBehaviour(behaviour: string) {
      this.behaviour = behaviour;
    }
    stopped = false;
    next: Player | null = null;
    onEnded: (() => void) | null = null;
    get audioNow() {
      return mock.now;
    }
    audioTimeOf(at: number) {
      return mock.now + (at - this.position);
    }
    // A hand-over starts the next song on this clock, as the shared engine does.
    chainNext(next: Player) {
      this.next = next;
      next.isPlaying = true;
      return true;
    }
    detachNext() {
      const next = this.next;
      this.next = null;
      return next;
    }
    cancelChain() {
      const next = this.next;
      this.next = null;
      if (next) {
        next.isPlaying = false;
        next.stopped = true;
      }
    }
    constructor() {
      mock.players.push(this);
    }
    async play() {
      this.isPlaying = true;
    }
    pause() {
      this.isPlaying = false;
    }
    async seek(value: number) {
      this.position = value;
    }
    setMix() {}
    setMetronome() {}
    async dispose() {
      this.isPlaying = false;
      this.stopped = true;
      this.onEnded = null;
    }
    end() {
      this.isPlaying = false;
      this.position = this.duration;
      this.onEnded?.();
    }
  },
}));
const song = (id: string, bpm: number, pc: number): LibrarySong => ({
  id,
  title: id,
  artist: "",
  sourceName: id + ".wav",
  duration: 10,
  audio: [{ name: "source", sampleRate: 10, frames: 100, channels: 1, file: "source.flac", codec: "flac", bytes: 8, sha256: "a".repeat(64) }],
  settings: { ":bpm": String(bpm), "": `[00:00] {midi:pc 1 ${pc}}`, ":options": JSON.stringify({ clock: bpm === 95 }) },
  updated: "",
});
const first = song("first", 95, 12),
  second = song("second", 130, 22);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearSettingsCache();
  mock.players = [];
  mock.index.mockResolvedValue({ ...emptyLibrary(), songs: [first, second] });
  mock.audioUrls.mockResolvedValue({ source: "app://library/rev/source.flac" });
  mock.fetch.mockImplementation(async () => file());
  mock.settings.mockResolvedValue(undefined);
  useSong.setState({ source: null, stems: null, status: { kind: "idle" } });
  useSongLibrary.setState({
    index: emptyLibrary(),
    busy: false,
    error: "",
    notice: "",
    queue: [],
    queueOverrides: [],
    position: -1,
    playlistPlaying: false,
    midiSession: null,
  });
  useBluetooth.setState({
    connection: { id: "bluetooth-midi", name: "GP-180 BLE", state: "connected", send: mock.send, clear: mock.clear } as unknown as BleMidiConnection,
  });
  mock.now = 0;
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  useBluetooth.setState({ connection: null });
});

it("automatically plays the next song with its BPM and armed MIDI, then finishes the set", async () => {
  await useSongLibrary.getState().load(first.id, [first.id, second.id]);
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText("Send cues"));
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(mock.send.mock.calls.some((c) => c[0][0] === 192 && c[0][1] === 12)).toBe(true));
  expect(mock.players.at(-1)?.isPlaying).toBe(true);
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  expect((screen.getByLabelText("BPM") as HTMLInputElement).value).toBe("130");
  expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("MIDI Clock (24 PPQN)") as HTMLInputElement).checked).toBe(false);
  await waitFor(() => expect(mock.send.mock.calls.some((c) => c[0][0] === 192 && c[0][1] === 22)).toBe(true));
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSongLibrary.getState().playlistPlaying).toBe(false));
  expect(screen.getByText("Playlist finished.")).toBeTruthy();
  expect(useSongLibrary.getState().position).toBe(1);
});

it("pauses and skips without automatically starting the next song, then resumes the set", async () => {
  await useSongLibrary.getState().load(first.id, [first.id, second.id]);
  render(<PerformancePanel />);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  fireEvent.click(screen.getByText("Pause"));
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByText("Next song"));
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  expect(mock.players.at(-1)?.isPlaying).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  expect(mock.players.at(-1)?.isPlaying).toBe(true);
});

it("does not carry MIDI arming onto a replacement Bluetooth connection", async () => {
  await useSongLibrary.getState().load(first.id, [first.id, second.id]);
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText("Send cues"));
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await act(async () => {
    useBluetooth.setState({
      connection: { id: "bluetooth-midi", name: "Replacement BLE", state: "connected", send: mock.send, clear: mock.clear } as unknown as BleMidiConnection,
    });
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(false);
});

it("pauses the playlist when leaving Performance", async () => {
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  const view = render(<PerformancePanel />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  useNav.getState().go("rig");
  view.unmount();
  await waitFor(() => expect(useSongLibrary.getState().playlistPlaying).toBe(false));
  expect(mock.players.at(-1)?.isPlaying).toBe(false);
});

it("resumes the next song after stopping a transition instead of replaying the finished song", async () => {
  // The first song loads at once. The next one is still loading in the background, so the join to it is a gap, and that
  // gap's load is the one the test stops.
  let resolve!: (value: Response) => void;
  mock.fetch.mockImplementationOnce(async () => file());
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  mock.fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  render(<PerformancePanel />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  fireEvent.click(screen.getByText("Stop playlist"));
  await act(async () => {
    resolve(file());
  });
  await waitFor(() => expect(useSongLibrary.getState().busy).toBe(false));
  expect(useSong.getState().source?.libraryId).toBe(first.id);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
});

it("starts the next song once, still armed on the same output, when it was not prepared before the join", async () => {
  // B's background load never finishes before A ends, so the join is not chained: the view is re-created for B and B is loaded then.
  mock.fetch.mockImplementationOnce(async () => file());
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText("Send cues"));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(true);
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(mock.send.mock.calls.some((c) => c[0][0] === 252)).toBe(false);
});

it("resumes a set loaded paused when Play is pressed in Performance, and the set then runs on by itself", async () => {
  // The documented route: Load set paused, arm the output, then Play in the Performance transport.
  await useSongLibrary.getState().load(first.id, [first.id, second.id]);
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText("Send cues"));
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().playlistPlaying).toBe(true));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(true);
  expect(mock.send.mock.calls.some((c) => c[0][0] === 252)).toBe(false);
});

it("resumes a one-song set as the set after Pause and a seek, so a play counted afterwards records the set", async () => {
  const recordPlayBefore = useSongLibrary.getState().recordPlay;
  const recordPlay = vi.fn();
  useSongLibrary.setState({ recordPlay });
  try {
    await useSongLibrary.getState().playPlaylist([first.id], 0, "set-1");
    render(<PerformancePanel />);
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Play playlist")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText("Rewind"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Play playlist"));
    });
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    expect(useSongLibrary.getState().playlistPlaying).toBe(true);
    mock.players.at(-1)!.position = 6;
    await waitFor(() => expect(recordPlay).toHaveBeenCalledWith(first.id, "set-1"), { timeout: 3000 });
  } finally {
    useSongLibrary.setState({ recordPlay: recordPlayBefore });
  }
});

it("says the set is waiting for Play when an entry asks to wait, and plays once Play starts it", async () => {
  await useSongLibrary.getState().playPlaylist([first.id, second.id], 0, undefined, [{ autoplay: false }, null]);
  render(<PerformancePanel />);
  await waitFor(() => expect(screen.getByText(/Playlist waiting for Play/)).toBeTruthy());
  expect(mock.players.at(-1)?.isPlaying).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  expect(screen.getByText(/Playlist playing/)).toBeTruthy();
});

it("keeps a USB output armed and selected across an unprepared join, with clock on and no MIDI Stop", async () => {
  mock.fetch.mockImplementationOnce(async () => file());
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const gp180Send = vi.fn();
  const access = Object.assign(new EventTarget(), {
    outputs: new Map([["gp180", { id: "gp180", name: "GP-180", state: "connected", send: gp180Send, clear: vi.fn() }]]),
    inputs: new Map(),
  });
  const realNavigator = navigator;
  vi.stubGlobal("navigator", { requestMIDIAccess: async () => access });
  try {
    await useSongLibrary.getState().load(first.id, [first.id, second.id]);
    render(<PerformancePanel />);
    await act(async () => {
      fireEvent.click(screen.getByText("Enable USB / system MIDI"));
    });
    fireEvent.change(screen.getByLabelText("MIDI output"), { target: { value: "gp180" } });
    fireEvent.click(screen.getByLabelText("Send cues"));
    // Song A's own options turn the clock on, so the set runs with clock on.
    expect((screen.getByLabelText("MIDI Clock (24 PPQN)") as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText("Play playlist"));
    });
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    gp180Send.mockClear();
    await act(async () => {
      mock.players.at(-1)!.end();
    });
    await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    expect(gp180Send.mock.calls.some((c) => c[0][0] === 252)).toBe(false);
    expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("MIDI output") as HTMLSelectElement).value).toBe("gp180");
    expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  } finally {
    vi.stubGlobal("navigator", realNavigator);
  }
});

it("keeps a set playing across a join under StrictMode, which re-runs each teardown once", async () => {
  mock.fetch.mockImplementationOnce(async () => file());
  mock.fetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
  const gp180Send = vi.fn();
  const access = Object.assign(new EventTarget(), {
    outputs: new Map([["gp180", { id: "gp180", name: "GP-180", state: "connected", send: gp180Send, clear: vi.fn() }]]),
    inputs: new Map(),
  });
  const realNavigator = navigator;
  vi.stubGlobal("navigator", { requestMIDIAccess: async () => access });
  try {
    await useSongLibrary.getState().load(first.id, [first.id, second.id]);
    render(
      <StrictMode>
        <PerformancePanel />
      </StrictMode>,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Enable USB / system MIDI"));
    });
    fireEvent.change(screen.getByLabelText("MIDI output"), { target: { value: "gp180" } });
    fireEvent.click(screen.getByLabelText("Send cues"));
    await act(async () => {
      fireEvent.click(screen.getByText("Play playlist"));
    });
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    await act(async () => {
      mock.players.at(-1)!.end();
    });
    await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
    await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
    // Give any deferred teardown a turn to run: the set must still be playing and armed.
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(useSongLibrary.getState().playlistPlaying).toBe(true);
    expect((screen.getByLabelText("Send cues") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("MIDI output") as HTMLSelectElement).value).toBe("gp180");
  } finally {
    vi.stubGlobal("navigator", realNavigator);
  }
});

it("does not pause a held hand-over when the panel is torn down on the same screen", async () => {
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  const view = render(<PerformancePanel />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  const dispose = vi.fn(async () => {});
  const unwire = vi.fn();
  useSongLibrary.getState().setHandover({ id: second.id, player: { dispose } as never, countInMs: 0, join: 0, unwire });
  // Still on Performance: a remount is not leaving, so the held song is not stopped and the set is not paused.
  view.unmount();
  await act(() => new Promise((r) => setTimeout(r, 20)));
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);
  expect(dispose).not.toHaveBeenCalled();
});

it("hands the chained song over to the session for the next song, which adopts it instead of starting it again", async () => {
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  render(<PerformancePanel />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  const outgoing = mock.players.at(-1)! as unknown as Player;
  // The next song is prepared before the join. Near the outgoing song's end, the session chains it onto the same clock.
  await waitFor(() => expect(useSongLibrary.getState().prepared).not.toBeNull());
  const incoming = useSongLibrary.getState().prepared!.player as unknown as Player;
  outgoing.position = 8;
  await waitFor(() => expect(outgoing.next).toBe(incoming));
  const players = mock.players.length;
  await act(async () => {
    outgoing.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  // The change re-renders the view, which creates a new session. That session takes the chained song over: no second player
  // is built, and the song that was already playing is not stopped.
  expect(mock.players).toHaveLength(players);
  expect(incoming.stopped).toBe(false);
  expect(incoming.isPlaying).toBe(true);
  expect((screen.getByLabelText("BPM") as HTMLInputElement).value).toBe("130");
});

it("stops a handed-over song that nothing took up, and pauses the set, when Performance is left", async () => {
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  const view = render(<PerformancePanel />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  const dispose = vi.fn(async () => {});
  const unwire = vi.fn();
  useSongLibrary.getState().setHandover({ id: second.id, player: { dispose } as never, countInMs: 0, join: 0, unwire });
  useNav.getState().go("rig");
  view.unmount();
  await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
  expect(unwire).toHaveBeenCalledTimes(1);
  expect(useSongLibrary.getState().handover).toBeNull();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
});

it("keeps the next set song prepared through a paused load, a seek, and Play under StrictMode", async () => {
  // The device flow: Load set paused, then seek song A while paused, then Play. Song B must be prepared before the join.
  await useSongLibrary.getState().load(first.id, [first.id, second.id], 0);
  render(
    <StrictMode>
      <PerformancePanel />
    </StrictMode>,
  );
  fireEvent.click(screen.getByLabelText("Send cues"));
  fireEvent.change(screen.getByLabelText("Song position"), { target: { value: "6.5" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
  await act(() => new Promise((r) => setTimeout(r, 20)));
  expect(useSongLibrary.getState().prepared?.id).toBe(second.id);
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  expect(useSongLibrary.getState().position).toBe(1);
});

it("prefetches the next set song again after a short pause and resume during playback", async () => {
  await useSongLibrary.getState().load(first.id, [first.id, second.id], 0);
  render(<PerformancePanel />);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
  fireEvent.click(screen.getByText("Pause"));
  expect(useSongLibrary.getState().prepared).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
});

it("prefetches the next set song again after a seek during playback", async () => {
  await useSongLibrary.getState().load(first.id, [first.id, second.id], 0);
  render(<PerformancePanel />);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
  fireEvent.change(screen.getByLabelText("Song position"), { target: { value: "6.5" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
});

it("logs why the next set song could not be prefetched, and prefetches it again on the next Play", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await useSongLibrary.getState().load(first.id, [first.id, second.id], 0);
    mock.fetch.mockImplementationOnce(() => Promise.reject(new Error("FLAC fetch failed")));
    render(<PerformancePanel />);
    await act(async () => {
      fireEvent.click(screen.getByText("Play playlist"));
    });
    await waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining(second.id), expect.any(Error)));
    // The track's own reason reaches the console, not just the generic message that the notice shows.
    expect(error.mock.calls.some(([, reason]) => reason instanceof Error && reason.message === "FLAC fetch failed")).toBe(true);
    expect(useSongLibrary.getState().prepared).toBeNull();
    fireEvent.click(screen.getByText("Pause"));
    await act(async () => {
      fireEvent.click(screen.getByText("Play playlist"));
    });
    await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
  } finally {
    error.mockRestore();
  }
});

it("prepares a next set song that was saved without a stem split, and the join takes that player over", async () => {
  // Both test songs have only their source audio, so neither has stems. The preload must play the source, as the session does.
  await useSongLibrary.getState().load(first.id, [first.id, second.id], 0);
  render(<PerformancePanel />);
  await act(async () => {
    fireEvent.click(screen.getByText("Play playlist"));
  });
  await waitFor(() => expect(useSongLibrary.getState().prepared?.id).toBe(second.id));
  await act(async () => {
    mock.players.at(-1)!.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(second.id));
  // The join took the prepared song over: it was not fetched again, and the song store holds no split stems for it.
  expect(mock.audioUrls.mock.calls.filter(([id]) => id === second.id)).toHaveLength(1);
  expect(useSong.getState().stems).toBeNull();
  expect(useSongLibrary.getState().prepared).toBeNull();
  expect(useSongLibrary.getState().position).toBe(1);
});

it("keeps a set playing when another Song tab is shown, and plays the queue as edited while hidden", async () => {
  const third = song("third", 110, 33);
  mock.index.mockResolvedValue({ ...emptyLibrary(), songs: [first, second, third] });
  await useSongLibrary.getState().playPlaylist([first.id, second.id]);
  useNav.getState().go("song", "performance");
  render(<SongScreen />);
  await waitFor(() => expect(mock.players.at(-1)?.isPlaying).toBe(true));
  const player = mock.players.at(-1)! as unknown as Player;
  const panel = document.querySelector<HTMLElement>("[role='tabpanel'][aria-labelledby$='trigger-performance']")!;
  const position = () => (screen.getByLabelText("Song position") as HTMLInputElement).value;
  const before = position();

  act(() => useNav.getState().go("song", "songs"));
  expect(panel.hidden).toBe(true);
  expect(player.isPlaying).toBe(true);
  expect(player.stopped).toBe(false);
  expect(useSongLibrary.getState().playlistPlaying).toBe(true);

  act(() => {
    useSongLibrary.getState().addToQueue([third.id]);
    useSongLibrary.getState().moveInQueue(2, 1);
  });
  const queued = useSongLibrary.getState();
  expect(queued.queue[queued.position + 1]).toBe(third.id);
  expect(player.isPlaying).toBe(true);

  act(() => useNav.getState().go("song", "performance"));
  expect(panel.hidden).toBe(false);
  expect(position()).toBe(before);
  expect(player.isPlaying).toBe(true);

  await act(async () => {
    player.end();
  });
  await waitFor(() => expect(useSong.getState().source?.libraryId).toBe(third.id));
});
