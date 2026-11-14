import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StemPlayer } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import type { MidiSchedule } from "./midi-scheduler";
import { PerformanceSession, carriedInto, selectArmed, type SessionInputs } from "./session";
import { SONG_TRIGGER_DEFAULTS, type SongTriggerSettings } from "./song-triggers";
import { usePracticeMute } from "./practice-mute";
import { defaultBindings, startLearn, stopLearn, useRemoteLearn, type Binding } from "./bindings";
import { useMidiConfiguration } from "./midi-configuration";
import { parseChart } from "./chart";
import type { Section } from "./sections";
import { useMidiDiagnostics } from "./midi-diagnostics";
import { useOutputSettings } from "@/song/audio/output-settings";
import { DEFAULT_OUTPUTS } from "@/song/audio/outputs";
import { useNav } from "@/state/nav";
import { registerBandRefresh } from "@/song/band/refresh";
import { clearSettingsCache, performanceKey } from "./settings";

const mocks = vi.hoisted(() => ({
  warm: [] as { cancel: () => void }[],
  song: { source: null as unknown },
  position: 0,
  audioNow: 0,
  jumps: [] as { to: number; at: number }[],
  cancelOk: true,
  plans: [] as { cap: number | null; jump: { at: number; position: number } | null }[],
  outputs: [] as { player: unknown; config: unknown }[],
  toasts: [] as unknown[],
  players: [] as { onOutputWarning: ((message: string) => void) | null; isPlaying: boolean }[],
  lead: undefined as unknown,
  rate: 1,
  swaps: [] as unknown[],
  applied: [] as unknown[],
  configs: [] as {
    prepared?: { position: number; messages: number[][] };
    bpm?: number;
    rate?: number;
    clock?: boolean;
    tempo: number[][] | null;
    playTriggers?: number[][];
    timecode?: { fps: number; offset: number };
  }[],
  swapAt: 2.5,
  swapWhen: 2.6,
  faults: [] as ((message: string) => void)[],
  /** Runs the real MidiSchedule instead of a stub, and collects the messages it drops as late. */
  realSchedule: false,
  schedules: [] as MidiSchedule[],
  dropped: [] as { bytes: number[]; label: string }[],
  /** With `realTime`, the player's position runs on the clock from the start of the audio, as the real player's does. */
  realTime: false,
  segment: null as null | { songStart: number; ctxStart: number },
  sends: [] as ((message: { bytes: number[]; due: number; label: string }) => void)[],
  /** The callback the session gave the host for system resume */
  resume: null as null | (() => void),
  library: {
    playlistPlaying: false,
    queue: [] as string[],
    position: 0,
    pausePlaylist: vi.fn(),
    rememberMidi: vi.fn((session: unknown) => {
      mocks.library.midiSession = session as never;
    }),
    midiSession: null as null | { access: MIDIAccess | null; portId: string; inputId: string; armed: boolean; output: unknown },
    holdChain: vi.fn(),
    recordPlay: vi.fn(),
    playingSet: null as string | null,
    queueOverrides: [] as ({ autoplay?: boolean; endBehaviour?: string } | null)[],
    advancePlaylist: vi.fn(),
    skipPlaylist: vi.fn(async () => {}),
    busy: false,
    notice: "",
    index: { songs: [] as { id: string; title: string; settings: Record<string, string> }[] },
    load: vi.fn(async () => {}),
    armNext: vi.fn((): string | null => null),
    autoplayId: null as string | null,
    requestAutoplay(id: string) {
      this.autoplayId = id;
    },
    takeAutoplay(id: string | undefined) {
      if (!id || this.autoplayId !== id) return false;
      this.autoplayId = null;
      return true;
    },
    // Keeps the index in step, as the library does, so a learned trigger is seen by the next message.
    setSongTrigger: vi.fn((id: string, trigger: unknown) => {
      const song = mocks.library.index.songs.find((s) => s.id === id);
      if (song) song.settings[":options"] = JSON.stringify(trigger ? { midiTrigger: trigger } : {});
    }),
    preparedNext: (): unknown => null,
    advanceToPrepared: vi.fn((): boolean => false),
    resumePlaylist: vi.fn(),
    // The held song is released by the library: stopped and unwired, as in the app.
    handover: null as null | { id: string; player: { dispose: () => Promise<void> }; countInMs: number; unwire: () => void },
    setHandover(handover: { id: string; player: { dispose: () => Promise<void> }; countInMs: number; unwire: () => void }) {
      this.releaseHandover();
      this.handover = handover;
    },
    claimHandover(id: string | undefined) {
      const held = this.handover;
      if (!held) return null;
      this.handover = null;
      if (held.id === id) return held;
      held.unwire();
      void held.player.dispose();
      return null;
    },
    releaseHandover() {
      const held = this.handover;
      if (!held) return;
      this.handover = null;
      held.unwire();
      void held.player.dispose();
    },
  },
}));
vi.mock("@/app/notify", () => ({ showToast: (spec: unknown) => mocks.toasts.push(spec) }));
vi.mock("@/host", () => ({
  host: {
    song: {
      onSystemResume: (cb: () => void) => {
        mocks.resume = cb;
        return () => {};
      },
    },
  },
}));
vi.mock("@/song/audio/playback-engine", () => ({ sharedPlaybackEngine: () => ({}) }));
vi.mock("@/song/stems/player", () => ({
  StemPlayer: class {
    duration = 60;
    start = 0;
    behaviour = "next";
    disposed = false;
    isPlaying = false;
    onEnded?: () => void;
    onLoopScheduled: ((loop: { to: number; at: number; when: number }) => void) | null = null;
    onOutputWarning: ((message: string) => void) | null = null;
    constructor() {
      mocks.players.push(this);
    }
    setEndBehaviour(behaviour: string) {
      this.behaviour = behaviour;
    }
    setOutputs(config: unknown) {
      mocks.outputs.push({ player: this, config });
      return Promise.resolve();
    }
    get position() {
      if (mocks.realTime && mocks.segment) return mocks.segment.songStart + (performance.now() - mocks.segment.ctxStart) / 1000;
      return mocks.position;
    }
    get playbackRate() {
      return mocks.rate;
    }
    renderBuffers(_stems: unknown, rate: number) {
      return Promise.resolve({ rate, buffers: {} });
    }
    applyRender(render: unknown) {
      mocks.applied.push(render);
    }
    swapRender(render: unknown) {
      mocks.swaps.push(render);
      return { at: mocks.swapAt, when: mocks.swapWhen };
    }
    async play(lead?: { bpm?: number; countInBeats?: number; startDelay?: number }) {
      mocks.lead = lead;
      this.isPlaying = true;
      if (mocks.realTime) {
        const countIn = ((lead?.countInBeats ?? 0) * 60) / (lead?.bpm ?? 120);
        mocks.segment = { songStart: mocks.position, ctxStart: performance.now() + ((lead?.startDelay ?? 0) + countIn) * 1000 };
      }
    }
    pause() {
      if (mocks.realTime && mocks.segment) mocks.position = this.position;
      mocks.segment = null;
      this.isPlaying = false;
    }
    async seek(value: number) {
      mocks.position = value;
    }
    get audioNow() {
      return mocks.audioNow;
    }
    audioTimeOf(at: number) {
      return mocks.audioNow + (at - mocks.position);
    }
    prepareJump(to: number, at: number) {
      mocks.jumps.push({ to, at });
      return this.audioTimeOf(at);
    }
    cancelJump() {
      return mocks.cancelOk;
    }
    chainNext() {
      return true;
    }
    detachNext() {
      return null;
    }
    cancelChain() {}
    async dispose() {
      this.disposed = true;
    }
  },
}));
vi.mock("@/song/store", () => ({ useSong: { getState: () => mocks.song } }));
// Renders are built on the same thread here: the worker is tested in render-queue.test.ts
vi.mock("@/song/audio/render-queue", () => ({
  RenderQueue: class {
    render(base: unknown) {
      return Promise.resolve(base);
    }
    clear() {}
  },
  isPlainSpeed: (speed: { rate: number; semitones: number; cents: number }) => speed.rate === 1 && speed.semitones === 0 && speed.cents === 0,
}));
vi.mock("@/song/library", () => ({
  useSongLibrary: { getState: () => mocks.library, setState: (patch: object) => Object.assign(mocks.library, patch) },
}));
vi.mock("@/song/performance/midi-scheduler-client", async () => {
  const { MidiSchedule, lateAction, STALE_MS } = await vi.importActual<typeof import("./midi-scheduler")>("./midi-scheduler");
  const midiNow = () => performance.timeOrigin + performance.now();
  return {
    midiNow,
    prepareMidiScheduler: () => {
      const warm = { worker: { terminate: vi.fn() }, ready: Promise.resolve(), cancel: vi.fn() };
      mocks.warm.push(warm);
      return warm;
    },
    startMidiScheduler: (config: (typeof mocks.configs)[number], send: (typeof mocks.sends)[number], fault: (message: string) => void) => {
      mocks.configs.push(config);
      mocks.sends.push(send);
      mocks.faults.push(fault);
      if (mocks.realSchedule) {
        // As the client does: a message that is late and not one that must go out anyway is dropped, not sent.
        const schedule = new MidiSchedule(config as never, midiNow(), (reply) => {
          if (reply.type !== "batch") return;
          mocks.dropped.push(...(reply.dropped ?? []));
          for (const message of reply.messages) {
            if (midiNow() - message.due > STALE_MS && lateAction(message.bytes) !== "send") mocks.dropped.push(message);
            else send(message);
          }
        });
        mocks.schedules.push(schedule);
        schedule.tick(midiNow());
        return {
          stop: () => schedule.stop(),
          sync: (position: number) => schedule.sync(position, midiNow(), midiNow()),
          plan: (cap: number | null, jump: unknown) => schedule.plan(cap, jump as never, midiNow()),
          endTimecode: (at: number | null) => schedule.endTimecode(at),
          timecodeStream: () => schedule.timecodeStream(),
        };
      }
      return {
        stop: vi.fn(),
        sync: vi.fn(),
        plan: (cap: number | null, jump: { at: number; position: number } | null) => mocks.plans.push({ cap, jump }),
        endTimecode: vi.fn(),
        timecodeStream: vi.fn(() => null),
      };
    },
  };
});

const source = { name: "song.wav", libraryId: "a" as string | undefined, audio: { sampleRate: 44100, channels: [new Float32Array(10)] } };
const output = () => ({ id: "usb", name: "USB", state: "connected", send: vi.fn(), clear: vi.fn() });
const inputs = (patch: Partial<SessionInputs> = {}): SessionInputs => ({
  bluetooth: null,
  tempoOnStart: false,
  tempoChannel: 1,
  savedOutput: null,
  savedInput: null,
  queued: false,
  playlistPlaying: false,
  busy: false,
  cues: [],
  parseError: "",
  bpm: 120,
  ...patch,
});
/** The session for the next playlist song, after the view was re-created on the hand-over. It is armed as the previous session was. */
function joinedSession(out: ReturnType<typeof output>, access: MIDIAccess, patch: Partial<SessionInputs> = {}) {
  const session = new PerformanceSession({
    initial: inputs({ queued: true, playlistPlaying: true, ...patch }),
    carried: { access, portId: "usb", inputId: "", armed: true, output: out },
    initialClock: false,
  });
  const unload = session.loadSong({ ...source, libraryId: "b", name: "b.wav" }, null);
  session.bind();
  return { session, unload };
}

function armedSession(out = output(), patch: Partial<SessionInputs> = {}) {
  const access = Object.assign(new EventTarget(), { outputs: new Map([["usb", out]]), inputs: new Map() }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(patch),
    carried: { access, portId: "usb", inputId: "", armed: true, output: out },
    initialClock: false,
  });
  const unload = session.loadSong(source, null);
  session.bind();
  return { session, out, access, unload };
}

beforeEach(() => {
  mocks.position = 0;
  mocks.audioNow = 0;
  mocks.jumps.length = 0;
  mocks.plans.length = 0;
  mocks.warm.length = 0;
  mocks.cancelOk = true;
  mocks.outputs.length = 0;
  mocks.toasts.length = 0;
  mocks.players.length = 0;
  mocks.faults.length = 0;
  mocks.sends.length = 0;
  mocks.resume = null;
  mocks.library.playlistPlaying = false;
  mocks.library.queue = [];
  mocks.rate = 1;
  mocks.swaps.length = 0;
  mocks.applied.length = 0;
  mocks.configs.length = 0;
  useMidiDiagnostics.getState().reset();
  mocks.realSchedule = false;
  mocks.realTime = false;
  mocks.segment = null;
  mocks.schedules.length = 0;
  mocks.dropped.length = 0;
  useMidiConfiguration.setState({ sendCues: { on: false, outputId: "" } });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("separates RC-10R cue releases and preserves them across pause cleanup", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const cues = parseChart("[00:01] {nochase} {midi:cc 2 80 127} {midi:cc 2 80 0}").map((cue) => ({ ...cue, managed: "rhythm" as const }));
  const { session, out, unload } = armedSession(output(), { cues });
  const now = performance.now();
  session.sendPerformance([0xb1, 80, 127], now);
  session.sendPerformance([0xb1, 80, 0], now);
  expect(out.send.mock.calls.slice(-2)).toEqual([
    [[0xb1, 80, 127], now],
    [[0xb1, 80, 0], now + 100],
  ]);
  out.send.mockClear();
  session.panic();
  expect(out.clear).toHaveBeenCalled();
  expect(out.send).toHaveBeenCalledWith([0xb1, 80, 0], now + 100);
  unload();
  session.dispose();
  clock.mockRestore();
});

it("holds an automatic RC-10R stop trigger through the transport's pause cleanup", async () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const cues = parseChart("{midi@stop:cc 2 83 127}\n{midi@stop:cc 2 83 0}").map((cue) => ({ ...cue, managed: "rhythm" as const }));
  const { session, out, unload } = armedSession(output(), { cues });
  try {
    await session.play();
    out.send.mockClear();
    session.pause();
    const stop = out.send.mock.calls.filter(([bytes]) => bytes[0] === 0xb1 && bytes[1] === 83);
    expect(stop).toEqual([
      [[0xb1, 83, 127], undefined],
      [[0xb1, 83, 0], 1100],
    ]);
  } finally {
    unload();
    session.dispose();
    clock.mockRestore();
  }
});

it("does not delay unrelated pedal controls or unassigned CCs", () => {
  const { session, out, unload } = armedSession();
  const now = performance.now();
  session.sendPerformance([0xb0, 102, 127], now);
  session.sendPerformance([0xb0, 102, 0], now);
  expect(out.send.mock.calls.slice(-2)).toEqual([
    [[0xb0, 102, 127], now],
    [[0xb0, 102, 0], now],
  ]);
  unload();
  session.dispose();
});

it("restores arming handed over by the previous song only for the same output object", () => {
  const { session, out } = armedSession();
  expect(selectArmed(session.state)).toBe(true);
  const other = output();
  const replaced = new PerformanceSession({
    initial: inputs(),
    carried: { access: session.state.access, portId: "usb", inputId: "", armed: true, output: other },
    initialClock: false,
  });
  expect(selectArmed(replaced.state)).toBe(false);
  expect(out.send).not.toHaveBeenCalled();
});
it("keeps the Play request through an automatic band buffer replacement, while Pause cancels a waiting Play", async () => {
  const { session, unload } = armedSession();
  let finish: () => void = () => {};
  const unregister = registerBandRefresh(
    performanceKey(source),
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const playing = session.play();
  await Promise.resolve();
  const old = session.state.player;
  unload();
  const unloadNew = session.loadSong(source, null);
  finish();
  await playing;
  expect(session.state.player).not.toBe(old);
  expect(session.state.player?.isPlaying).toBe(true);
  session.pause();
  const cancelled = session.play();
  await Promise.resolve();
  session.pause();
  finish();
  await cancelled;
  expect(session.state.player?.isPlaying).toBe(false);
  unregister();
  unloadNew();
  session.dispose();
});

it("releases only the channels that played notes and sends Stop once when paused with clock on", async () => {
  const { session, out } = armedSession();
  session.setClock(true);
  await session.play();
  out.send.mockClear();
  session.sendPerformance([0x90 | 2, 60, 100]);
  session.pause();
  const sent = out.send.mock.calls.map((c) => c[0]);
  expect(sent).toContainEqual([178, 64, 0]);
  expect(sent).toContainEqual([178, 123, 0]);
  expect(sent).toContainEqual([252]);
  expect(sent.filter((m) => m[0] === 252)).toHaveLength(1);
  expect(out.clear).toHaveBeenCalledTimes(1);
  session.pause();
  expect(out.send.mock.calls.filter((c) => c[0][0] === 252)).toHaveLength(1);
});

it("disarms and panics when the scheduler reports a fault", async () => {
  const { session, out } = armedSession();
  await session.play();
  expect(mocks.faults).toHaveLength(1);
  mocks.faults[0]("MIDI timing interrupted");
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.error).toBe("MIDI timing interrupted");
  expect(useMidiDiagnostics.getState().failures).toBe(1);
  expect(out.clear).toHaveBeenCalled();
});

it("disarms without a fault when the same port id is re-enumerated as a new object", () => {
  const { session, access } = armedSession();
  const reenumerated = output();
  (access.outputs as unknown as Map<string, unknown>).set("usb", reenumerated);
  access.dispatchEvent(new Event("statechange"));
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.midiStatus).toBe("MIDI output reconnected after sleep. Send cues to arm again.");
  expect(useMidiDiagnostics.getState().failures).toBe(0);
  expect(reenumerated.send).not.toHaveBeenCalled();
});

it("disarms with a fault when the armed output disconnects", () => {
  const { session, access, out } = armedSession();
  out.state = "disconnected";
  access.dispatchEvent(new Event("statechange"));
  expect(selectArmed(session.state)).toBe(false);
  expect(useMidiDiagnostics.getState().lastFailure).toBe("System MIDI output disconnected. Cues disarmed.");
});

it("disarms with a fault when a message is sent to a port that is no longer connected", async () => {
  const { session, out } = armedSession();
  await session.play();
  out.send.mockClear();
  out.state = "disconnected";
  mocks.sends[0]({ bytes: [192, 1], due: performance.timeOrigin + performance.now(), label: "Patch" });
  expect(out.send).not.toHaveBeenCalled();
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.error).toContain("no longer connected");
  expect(useMidiDiagnostics.getState().lastFailure).toContain("no longer connected");
});

it("arms and sends to a port that is connected but not yet opened", () => {
  // A Web MIDI output starts with connection "closed"; sending to it opens it, so it is not a dead port.
  const unopened = Object.assign(output(), { connection: "closed" });
  const access = Object.assign(new EventTarget(), { outputs: new Map([["usb", unopened]]), inputs: new Map() }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(),
    carried: { access, portId: "usb", inputId: "", armed: true, output: unopened },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  expect(selectArmed(session.state)).toBe(true);
  session.sendPerformance([192, 1]);
  expect(unopened.send).toHaveBeenCalledWith([192, 1], undefined);
  expect(selectArmed(session.state)).toBe(true);
  expect(useMidiDiagnostics.getState().failures).toBe(0);
});

it("disarms with a fault when a send throws", () => {
  const { session, out } = armedSession();
  out.send.mockImplementation(() => {
    throw new Error("port closed");
  });
  session.sendPerformance([192, 1]);
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.error).toBe("MIDI send failed: port closed. Cues disarmed.");
  expect(useMidiDiagnostics.getState().lastFailure).toBe("MIDI send failed: port closed. Cues disarmed.");
});

it("Enable requests fresh access and keeps the remembered port by its id", async () => {
  const { session } = armedSession();
  const fresh = Object.assign(new EventTarget(), { outputs: new Map([["usb", output()]]), inputs: new Map() }) as unknown as MIDIAccess;
  const requestMIDIAccess = vi.fn(async () => fresh);
  vi.stubGlobal("navigator", { requestMIDIAccess });
  await session.connectMidi();
  expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: true });
  expect(session.state.access).toBe(fresh);
  expect(session.state.portId).toBe("usb");
  expect(selectArmed(session.state)).toBe(false);
  expect(session.state.midiStatus).toBe("MIDI output reconnected after sleep. Send cues to arm again.");
});

it("a system resume drops the warm scheduler worker, so Play builds one from the resumed clock", () => {
  armedSession();
  const warm = mocks.warm.at(-1)!;
  expect(warm).toBeDefined();
  mocks.resume?.();
  expect(warm.cancel).toHaveBeenCalledTimes(1);
});

it("a system resume requests MIDI access again", async () => {
  const { session } = armedSession();
  const fresh = Object.assign(new EventTarget(), { outputs: new Map([["usb", output()]]), inputs: new Map() }) as unknown as MIDIAccess;
  const requestMIDIAccess = vi.fn(async () => fresh);
  vi.stubGlobal("navigator", { requestMIDIAccess });
  expect(mocks.resume).toBeTypeOf("function");
  mocks.resume?.();
  await vi.waitFor(() => expect(session.state.access).toBe(fresh));
  expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
});

it("takes up a lost remembered port again when it connects", async () => {
  const { session, access, out } = armedSession();
  const outputs = access.outputs as unknown as Map<string, unknown>;
  outputs.delete("usb");
  access.dispatchEvent(new Event("statechange"));
  expect(selectArmed(session.state)).toBe(false);
  const back = output();
  const fresh = Object.assign(new EventTarget(), { outputs: new Map([["usb", back]]), inputs: new Map() }) as unknown as MIDIAccess;
  vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => fresh) });
  outputs.set("usb", back);
  access.dispatchEvent(new Event("statechange"));
  await vi.waitFor(() => expect(session.state.access).toBe(fresh));
  expect(out.send).not.toHaveBeenCalled();
});

it("toggles playback from a CC80 remote message on the selected input", async () => {
  const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
  const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(),
    carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
  input.dispatchEvent(message([176, 80, 127]));
  await vi.waitFor(() => expect(session.state.playing).toBe(true));
  // A repeat within the bounce window is the same press; the next press comes after it.
  input.dispatchEvent(message([176, 80, 127]));
  expect(session.state.playing).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  input.dispatchEvent(message([176, 80, 127]));
  expect(session.state.playing).toBe(false);
  session.dispose();
});

it("does not send a scheduled message to a replacement output that was never armed", async () => {
  const { session, access, out } = armedSession();
  await session.play();
  const replacement = output();
  (access.outputs as unknown as Map<string, unknown>).set("usb", replacement);
  mocks.sends[0]({ bytes: [192, 1], due: performance.timeOrigin + performance.now(), label: "Patch" });
  expect(replacement.send).not.toHaveBeenCalled();
  expect(out.send.mock.calls.some((c) => c[0][0] === 192)).toBe(false);
});

it("stops once and restarts the transport when the clock is toggled during playback", async () => {
  const { session, out } = armedSession();
  session.setClock(true);
  await session.play();
  expect(out.send.mock.calls.some((c) => c[0][0] === 250)).toBe(true);
  out.send.mockClear();
  out.clear.mockClear();
  session.setClock(false);
  expect(out.send.mock.calls.filter((c) => c[0][0] === 252)).toHaveLength(1);
  expect(out.clear).toHaveBeenCalledTimes(1);
  expect(mocks.faults).toHaveLength(2);
});

it("disarms a replaced Bluetooth connection and never arms its replacement", () => {
  const first = { ...output(), id: "bluetooth-midi", subscribe: vi.fn() };
  const session = new PerformanceSession({
    initial: inputs({ bluetooth: first as never }),
    carried: { access: null, portId: "bluetooth-midi", inputId: "", armed: true, output: first },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  expect(selectArmed(session.state)).toBe(true);
  session.update({ bluetooth: null });
  expect(selectArmed(session.state)).toBe(false);
  session.update({ bluetooth: { ...first } as never });
  expect(selectArmed(session.state)).toBe(false);
  expect(useMidiDiagnostics.getState().lastFailure).toContain("Bluetooth output disconnected or replaced");
});

it("starts on remote Start and Stop, and stops on Stop", async () => {
  const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
  const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
  const session = new PerformanceSession({
    initial: inputs(),
    carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
    initialClock: false,
  });
  session.loadSong(source, null);
  session.bind();
  const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
  input.dispatchEvent(message([250]));
  await vi.waitFor(() => expect(session.state.playing).toBe(true));
  input.dispatchEvent(message([252]));
  expect(session.state.playing).toBe(false);
});

it("survives dispose and bind, as under StrictMode, and stops the old scheduler", async () => {
  const { session } = armedSession();
  await session.play();
  session.dispose();
  session.bind();
  expect(session.state.playing).toBe(true);
  expect(mocks.faults.length).toBeGreaterThanOrEqual(2);
});

it("refuses to seek while locked", async () => {
  const { session } = armedSession();
  session.locked = true;
  await session.seek(30);
  expect(mocks.position).toBe(0);
  session.locked = false;
  await session.seek(30);
  expect(mocks.position).toBe(30);
});

it("chains the next playlist song near the end, takes it over at its join, and does not send Stop", async () => {
  vi.useFakeTimers();
  // The next song was prepared before the join, so its player already exists and is the one the session chains.
  const incoming = new StemPlayer({} as Stems);
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  mocks.library.advanceToPrepared = vi.fn(() => true);
  const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  // The queued song starts itself; let that start settle.
  await vi.advanceTimersByTimeAsync(10);
  expect(session.state.playing).toBe(true);
  // The outgoing song has four seconds left, which is inside the chaining window.
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(250);
  expect(session.state.player).not.toBe(incoming);
  // The hand-over is taken half a second before the join, which is at the outgoing song's end.
  vi.advanceTimersByTime(3500);
  expect(mocks.library.advanceToPrepared).toHaveBeenCalledWith("b");
  // The library's change re-creates the view: the outgoing session is let go, and the new session takes the chained song up.
  const outgoing = session.state.player!;
  unload();
  session.dispose();
  expect((outgoing as unknown as { disposed: boolean }).disposed).toBe(true);
  const joined = joinedSession(out, access);
  expect(joined.session.state.player).toBe(incoming);
  expect(joined.session.state.playing).toBe(true);
  expect(mocks.library.handover).toBeNull();
  expect(mocks.players).toHaveLength(2);
  expect(out.send.mock.calls.some(([bytes]) => bytes?.[0] === 252)).toBe(false);
  joined.unload();
  joined.session.dispose();
  vi.useRealTimers();
});

/** Plays a queued song near its end with `settings` on the prepared next song, and returns the lead it is chained with. */
async function chainLeadFor(settings: Record<string, string>, outgoingCountIn = 0) {
  vi.useFakeTimers();
  const incoming = new StemPlayer({} as Stems);
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings, player: incoming };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  mocks.library.advanceToPrepared = vi.fn(() => true);
  const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  session.update({ timing: { countInBars: outgoingCountIn, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 } });
  const outgoing = session.state.player!;
  const chain = vi.spyOn(outgoing, "chainNext");
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(250);
  expect(chain).toHaveBeenCalledTimes(1);
  const [, join] = chain.mock.calls[0] as unknown as [unknown, { lead: unknown }];
  unload();
  session.dispose();
  vi.useRealTimers();
  return join.lead;
}

it("joins a playlist song whose own count-in is one bar with a count-in at its own BPM, when the outgoing song has none", async () => {
  const lead = await chainLeadFor({ ":bpm": "90", ":options": JSON.stringify({ countInBars: 1 }) });
  expect(lead).toEqual({ bpm: 90, countInBeats: 4, preRollBeats: 0 });
});

it("joins a playlist song with no count-in gaplessly, even when the outgoing song has one", async () => {
  const lead = await chainLeadFor({ ":bpm": "90" }, 1);
  expect(lead).toEqual({ bpm: 90, countInBeats: 0, preRollBeats: 0 });
});

it("pauses on one press after a join, when the view is re-created on the hand-over", async () => {
  vi.useFakeTimers();
  // The chained song is already playing on the clock when it is handed over, as the real player launches it.
  const incoming = new StemPlayer({} as Stems);
  (incoming as unknown as { isPlaying: boolean }).isPlaying = true;
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  mocks.library.advanceToPrepared = vi.fn(() => true);
  const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(3750);
  expect(mocks.library.advanceToPrepared).toHaveBeenCalledWith("b");
  unload();
  session.dispose();
  const joined = joinedSession(out, access);
  expect(joined.session.state.playing).toBe(true);
  // One press pauses the song that joined.
  joined.session.pause();
  expect(joined.session.state.playing).toBe(false);
  expect(incoming.isPlaying).toBe(false);
  joined.unload();
  joined.session.dispose();
  vi.useRealTimers();
});

it("does not chain a song that is set to stop the playlist", async () => {
  vi.useFakeTimers();
  const next = {
    id: "b",
    title: "B",
    source: { name: "b.wav", libraryId: "b", audio: source.audio },
    stems: {},
    settings: {},
    player: new StemPlayer({} as Stems),
  };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  (mocks.players.at(-1) as unknown as { behaviour: string }).behaviour = "stop";
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(1000);
  expect(mocks.library.advanceToPrepared).not.toHaveBeenCalled();
  expect(mocks.players).toHaveLength(2);
  vi.useRealTimers();
});

it("keeps the next playlist song waiting when none is ready, so the join is a gap", async () => {
  vi.useFakeTimers();
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => null;
  armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(1000);
  expect(mocks.players).toHaveLength(1);
  vi.useRealTimers();
});

it("hands a set on to a next song that was not chained without a MIDI Stop, and keeps the output armed", async () => {
  vi.useFakeTimers();
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => null;
  const { session, out } = armedSession(output(), { queued: true, playlistPlaying: true });
  session.setClock(true);
  await vi.advanceTimersByTimeAsync(10);
  expect(session.state.playing).toBe(true);
  out.send.mockClear();
  mocks.position = 75;
  mocks.audioNow = 75;
  session.state.player!.onEnded!();
  await vi.advanceTimersByTimeAsync(10);
  expect(mocks.library.advancePlaylist).toHaveBeenCalled();
  expect(out.send.mock.calls.some(([bytes]) => bytes?.[0] === 252)).toBe(false);
  expect(session.armed).toBe(true);
  vi.useRealTimers();
});

it("carries the armed output into the next song's session after an unchained join", async () => {
  vi.useFakeTimers();
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => null;
  mocks.library.midiSession = null;
  const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  session.state.player!.onEnded!();
  await vi.advanceTimersByTimeAsync(10);
  // The view is re-created for the next song: the outgoing session is let go, and the new one takes the carried output.
  unload();
  session.dispose();
  expect(mocks.library.midiSession).toMatchObject({ portId: "usb", armed: true, output: out });
  const next = new PerformanceSession({
    initial: inputs({ queued: true, playlistPlaying: true }),
    carried: { access, portId: "usb", inputId: "", armed: true, output: out },
    initialClock: false,
  });
  const unloadNext = next.loadSong({ ...source, libraryId: "b", name: "b.wav" }, null);
  next.bind();
  expect(next.state.portId).toBe("usb");
  expect(next.armed).toBe(true);
  unloadNext();
  next.dispose();
  vi.useRealTimers();
});

it("carries the access, output and input into a song loaded by hand, but not the arming", () => {
  mocks.library.midiSession = null;
  const { session, out, access, unload } = armedSession(output());
  session.setInputId("in");
  unload();
  session.dispose();
  expect(mocks.library.midiSession).toMatchObject({ portId: "usb", inputId: "in", armed: false, output: out });
  const next = new PerformanceSession({
    initial: inputs(),
    carried: carriedInto(mocks.library.midiSession, { queued: false, playlistPlaying: false }),
    initialClock: false,
  });
  const unloadNext = next.loadSong(source, null);
  next.bind();
  expect(next.state.access).toBe(access);
  expect(next.state.portId).toBe("usb");
  expect(next.state.inputId).toBe("in");
  expect(next.armed).toBe(false);
  unloadNext();
  next.dispose();
});

it("remembers the access, output and input of a song loaded from the library, and the next hand-loaded song starts with them, disarmed", () => {
  // A library load makes a queue of one: queued is true while no playlist plays.
  mocks.library.midiSession = null;
  const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: false });
  session.setInputId("in");
  unload();
  session.dispose();
  expect(mocks.library.midiSession).toMatchObject({ portId: "usb", inputId: "in", armed: false, output: out, access });
  const next = new PerformanceSession({
    initial: inputs({ queued: false, playlistPlaying: false }),
    carried: carriedInto(mocks.library.midiSession, { queued: false, playlistPlaying: false }),
    initialClock: false,
  });
  const unloadNext = next.loadSong(source, null);
  next.bind();
  expect(next.state.access).toBe(access);
  expect(next.state.portId).toBe("usb");
  expect(next.state.inputId).toBe("in");
  expect(next.armed).toBe(false);
  unloadNext();
  next.dispose();
});

it("disarms a song loaded by hand but keeps the arming for a playlist join", () => {
  const midi = { access: null, portId: "usb", inputId: "", armed: true, output: undefined };
  expect(carriedInto(midi, { queued: false, playlistPlaying: false })).toMatchObject({ portId: "usb", armed: false });
  expect(carriedInto(midi, { queued: true, playlistPlaying: false })).toMatchObject({ armed: false });
  expect(carriedInto(midi, { queued: true, playlistPlaying: true })).toMatchObject({ portId: "usb", armed: true });
  expect(carriedInto(null, { queued: true, playlistPlaying: true })).toBeNull();
});

it("does not pause the set when the outgoing song tears down at a join, because the playlist position has already moved", () => {
  vi.useFakeTimers();
  useNav.getState().go("song", "performance");
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.position = 0;
  const { unload, session } = armedSession(output(), { queued: true, playlistPlaying: true });
  // The advance moves the playlist position first; the song store still holds the outgoing song until the next one loads.
  mocks.library.position = 1;
  mocks.song.source = source;
  unload();
  vi.runOnlyPendingTimers();
  expect(mocks.library.pausePlaylist).not.toHaveBeenCalled();
  expect(session.armed).toBe(true);
  mocks.library.position = 0;
  mocks.song.source = null;
  session.dispose();
  vi.useRealTimers();
});

it("does not pause the set when the song's teardown runs on the same screen, as a StrictMode re-run does", () => {
  vi.useFakeTimers();
  useNav.getState().go("song", "performance");
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.position = 0;
  const { unload, session } = armedSession(output(), { queued: true, playlistPlaying: true });
  unload();
  vi.runOnlyPendingTimers();
  expect(mocks.library.pausePlaylist).not.toHaveBeenCalled();
  session.dispose();
  vi.useRealTimers();
});

it("pauses the set when the song is left while the set is playing at its own position", () => {
  vi.useFakeTimers();
  useNav.getState().go("rig");
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.position = 0;
  mocks.song.source = source;
  const { unload, session } = armedSession(output(), { queued: true, playlistPlaying: true });
  unload();
  vi.runOnlyPendingTimers();
  expect(mocks.library.pausePlaylist).toHaveBeenCalledTimes(1);
  mocks.song.source = null;
  session.dispose();
  vi.useRealTimers();
});

it("keeps the carry reset when panic and disarm runs inside a playing queued set", () => {
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a"];
  const { session } = armedSession(output(), { queued: true, playlistPlaying: true });
  session.panicAndDisarm();
  expect(mocks.library.rememberMidi).toHaveBeenLastCalledWith(null);
});

it("advances the playlist when a queued song ends, and skips by offset", async () => {
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  const { session } = armedSession(output(), { queued: true, playlistPlaying: true });
  session.state.player?.onEnded?.();
  expect(mocks.library.advancePlaylist).toHaveBeenCalled();
  expect(session.state.playing).toBe(false);
  session.skip(1);
  expect(mocks.library.skipPlaylist).toHaveBeenCalledWith(1);
});

it("waits out the start delay, cancels it with a second Play press, and starts with the count-in and pre-roll on the next press", async () => {
  vi.useFakeTimers();
  mocks.lead = undefined;
  const session = new PerformanceSession({ initial: inputs({ bpm: 120 }), carried: null, initialClock: false });
  const unload = session.loadSong(source, null);
  session.update({ timing: { countInBars: 1, beatsPerBar: 4, preRollBeats: 2, startDelay: 3 } });
  const cancelled = session.play();
  await vi.advanceTimersByTimeAsync(2000);
  expect(session.state.playing).toBe(false);
  session.cancelStart();
  await cancelled;
  expect(mocks.lead).toBeUndefined();
  expect(session.state.playing).toBe(false);
  const started = session.play();
  await vi.advanceTimersByTimeAsync(3000);
  await started;
  expect(mocks.lead).toEqual({ bpm: 120, countInBeats: 4, preRollBeats: 2 });
  expect(session.state.playing).toBe(true);
  session.pause();
  unload();
  vi.useRealTimers();
});

it("applies the saved outputs to a new player, again when they change, and shows a warning as a toast", () => {
  const session = new PerformanceSession({ initial: inputs(), carried: null, initialClock: false });
  const unload = session.loadSong(source, null);
  const player = mocks.players.at(-1);
  // Earlier tests leave their sessions bound, so only this player's calls count.
  const applied = () => mocks.outputs.filter((call) => call.player === player).map((call) => call.config);
  expect(applied()).toEqual([DEFAULT_OUTPUTS]);
  useOutputSettings.getState().update({ ...DEFAULT_OUTPUTS, deviceId: "usb-4", label: "Interface" });
  expect(applied()).toHaveLength(2);
  expect(applied()[1]).toMatchObject({ deviceId: "usb-4" });

  mocks.players.at(-1)!.onOutputWarning?.("The interface is not available.");
  expect(mocks.toasts).toEqual([expect.objectContaining({ tone: "fault", body: "The interface is not available." })]);

  unload();
  useOutputSettings.getState().update(DEFAULT_OUTPUTS);
  expect(applied()).toHaveLength(2);
});

describe("sections", () => {
  const verse = (mode: Section["mode"]): Section => ({ id: "verse", name: "Verse", start: 8, end: 16, mode });
  /** Plays the song from `position` with the sections. */
  function playing(sections: Section[], position = 0) {
    const armed = armedSession(output(), { sections });
    mocks.position = position;
    mocks.audioNow = position;
    armed.session.store.setState({ playing: true });
    return armed;
  }
  /** Moves the song and the audio clock to `position`, then runs one 50 ms section tick. */
  function at(position: number) {
    mocks.position = position;
    mocks.audioNow = position;
    vi.advanceTimersByTime(50);
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("decides a loop two seconds ahead, holds the schedule up to its boundary, and jumps the audio back", () => {
    const { session } = playing([verse("loop")]);
    at(13.5);
    expect(mocks.jumps).toHaveLength(0);
    at(14.1);
    expect(mocks.jumps).toEqual([{ to: 8, at: 16 }]);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16, jump: { position: 8 } });
    // The jump is taken at the boundary. Nothing pauses: a loop keeps the song playing.
    at(16.1);
    expect(session.state.playing).toBe(true);
    expect(mocks.jumps).toHaveLength(1);
  });

  it("tells the scheduler when the player wraps a song set to loop: a planned jump at the loop point", () => {
    const { session } = playing([], 55);
    const player = session.state.player as unknown as { onLoopScheduled: (loop: { to: number; at: number; when: number }) => void };
    player.onLoopScheduled({ to: 2, at: 60, when: 60 });
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 60, jump: { position: 2 } });
    // The decision clears once the audio passes the wrap, as for a section jump.
    at(60.1);
    expect(session.state.sectionNext).toBeNull();
  });

  it("cancels an armed jump: the decision is undone and the hold is lifted", () => {
    const { session } = playing([verse("continue")]);
    session.tapSection("verse");
    expect(session.state.sectionLive.jump).toBe("verse");
    at(14.1);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16 });
    session.cancelSectionJump();
    expect(session.state.sectionLive.jump).toBeNull();
    expect(mocks.plans.at(-1)).toEqual({ cap: null, jump: null });
  });

  it("refuses to cancel a jump that is too close, and the jump then stands", () => {
    const { session } = playing([verse("continue")]);
    session.tapSection("verse");
    at(14.1);
    mocks.cancelOk = false;
    session.cancelSectionJump();
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 16 });
  });

  it("pauses at the boundary of a section whose mode is pause", () => {
    const { session } = playing([verse("pause")]);
    at(14.1);
    expect(session.state.playing).toBe(true);
    at(16.05);
    expect(session.state.playing).toBe(false);
  });

  it("stopped, a tap moves the playhead to the section start instead of arming a jump", () => {
    const { session } = armedSession(output(), { sections: [verse("continue")] });
    session.tapSection("verse");
    expect(mocks.position).toBe(8);
    expect(session.state.sectionLive.jump).toBeNull();
  });

  it("a second tap jumps now, after the MIDI lookahead, so the cues already queued still belong to the passage being left", () => {
    const { session } = playing([verse("continue")], 5);
    session.jumpSectionNow("verse");
    // USB lookahead is 0.2 s: the jump is at song 5.2, and the cap holds the schedule there.
    expect(mocks.jumps).toEqual([{ to: 8, at: 5.2 }]);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 5.2, jump: { position: 8 } });
  });

  it("starts a live loop, then releases it: the performer's release is kept for the rest of the pass", () => {
    const { session } = playing([verse("continue")], 10);
    session.toggleSectionLoop("verse");
    expect(session.state.sectionLive.loop).toBe("verse");
    session.releaseSectionLoop();
    expect(session.state.sectionLive.loop).toBeNull();
    expect(session.state.sectionLive.released).toEqual(["verse"]);
  });
});

describe("speed", () => {
  /** Lets the render promises settle, which the fake timers would not do. */
  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("swaps a speed change in at the next beat while the song plays, and the MIDI plan carries the new rate", async () => {
    const { session } = armedSession();
    mocks.position = 2;
    mocks.audioNow = 2;
    session.store.setState({ playing: true });
    mocks.players.at(-1)!.isPlaying = true;
    session.setSpeed({ rate: 0.5 });
    await flush();
    // The render is ready, but the swap waits for the tick that carries it out
    expect(mocks.swaps).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(mocks.swaps).toHaveLength(1);
    expect(mocks.plans.at(-1)).toMatchObject({ cap: 2.5, jump: { position: 2.5, rate: 0.5 } });
    expect(session.state.speed.rate).toBe(0.5);
    // When the swap takes effect the plan is cleared, and the song keeps playing
    mocks.audioNow = 2.6;
    mocks.position = 2.5;
    vi.advanceTimersByTime(50);
    expect(mocks.plans.at(-1)).toEqual({ cap: null, jump: null });
    expect(session.state.playing).toBe(true);
  });

  it("applies a speed change at once while the song is stopped", async () => {
    const { session } = armedSession();
    session.setSpeed({ semitones: 2 });
    await flush();
    expect(mocks.applied).toHaveLength(1);
    expect(mocks.swaps).toHaveLength(0);
    expect(session.state.speed.semitones).toBe(2);
  });

  it("sends the effective BPM as the start tempo and gives the scheduler the rate", async () => {
    mocks.rate = 0.5;
    const { session } = armedSession(output(), { tempoOnStart: true, bpm: 120 });
    await session.play();
    await vi.advanceTimersByTimeAsync(100);
    const config = mocks.configs.at(-1)!;
    expect(config.rate).toBe(0.5);
    // 120 BPM at 50% is 60 BPM: the tempo message carries 60
    expect(config.tempo).toEqual([
      [176, 73, 0],
      [176, 74, 60],
    ]);
    session.pause();
  });
});

describe("MIDI triggers", () => {
  const sent = (out: { send: { mock: { calls: unknown[][] } } }) => out.send.mock.calls.map(([bytes]) => bytes as number[]);
  const chartA = "{midi@load: pc 1 1}\n{midi@play: cc 1 80 127}\n{midi@stop: cc 1 81 127}\n{midi@end: pc 1 9}";
  const chartB = "{midi@load: pc 2 5}\n{midi@play: cc 2 80 127}\n{midi@stop: cc 2 81 127}\n{midi@end: pc 2 6}";
  const playTriggersOf = () => mocks.configs.filter((config) => config.playTriggers?.length).map((config) => config.playTriggers);

  it("sends load once on arm, and sends play with each start and stop on pause", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    expect(sent(out)).toEqual([[192, 1]]);
    session.update({ cues: parseChart(chartA) });
    expect(sent(out)).toEqual([[192, 1]]);
    await session.play();
    expect(playTriggersOf()).toEqual([[[176, 80, 127]]]);
    session.pause();
    expect(sent(out)).toEqual([
      [192, 1],
      [176, 81, 127],
    ]);
    await session.play();
    expect(playTriggersOf()).toHaveLength(2);
  });

  it("sends one transport Stop per pause, and Panic adds none after it", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.setClock(true);
    await session.play();
    session.pause();
    expect(sent(out).filter((bytes) => bytes[0] === 252)).toHaveLength(1);
    session.panicAndDisarm();
    expect(sent(out).filter((bytes) => bytes[0] === 252)).toHaveLength(1);
  });
  it("sends one transport Stop when Panic is pressed during playback", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.setClock(true);
    await session.play();
    session.panicAndDisarm();
    expect(sent(out).filter((bytes) => bytes[0] === 252)).toHaveLength(1);
  });
  it("sends one transport Stop when a playlist is stopped mid-song", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA), playlistPlaying: true, queued: true });
    session.setClock(true);
    await session.play();
    session.pause();
    expect(sent(out).filter((bytes) => bytes[0] === 252)).toHaveLength(1);
    expect(mocks.library.pausePlaylist).toHaveBeenCalled();
  });
  // A Bluetooth-like output: writes wait in a buffer, and clear() drops what is buffered but not yet written, as the BLE sender does.
  const buffered = () => {
    let queued: number[][] = [];
    const written: number[][] = [];
    return {
      id: "ble",
      name: "BLE",
      state: "connected",
      send: vi.fn((bytes: number[]) => {
        queued.push(bytes);
      }),
      clear: vi.fn(() => {
        queued = [];
      }),
      write: () => written.push(...queued.splice(0)),
      written,
    };
  };
  it("delivers a stop trigger once on pause, after the buffered output is cleared", async () => {
    const out = buffered();
    const { session } = armedSession(out as never, { cues: parseChart("{midi@stop: pc 1 1}") });
    await session.play();
    session.pause();
    out.write();
    expect(out.clear).toHaveBeenCalled();
    expect(out.written).toEqual([[192, 1]]);
  });
  it("delivers an end trigger once, then the stop trigger, after the buffered output is cleared", async () => {
    const out = buffered();
    const { session } = armedSession(out as never, { cues: parseChart("{midi@stop: cc 1 81 127}\n{midi@end: pc 16 69}") });
    await session.play();
    session.state.player?.onEnded?.();
    out.write();
    expect(out.written).toEqual([
      [207, 69],
      [176, 81, 127],
    ]);
  });
  it("sends the play trigger once per press on a resume, after a Continue", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.setClock(true);
    await session.play();
    mocks.position = 30;
    session.pause();
    await session.play();
    expect(playTriggersOf()).toHaveLength(2);
    expect(sent(out).filter((bytes) => bytes[0] === 251)).toHaveLength(1);
  });
  it("sends no play trigger when the song restarts from its start after missing its loop pass", async () => {
    const { session } = armedSession(output(), { cues: parseChart(chartA) });
    await session.play();
    expect(playTriggersOf()).toHaveLength(1);
    const player = mocks.players.at(-1)! as unknown as { setEndBehaviour: (behaviour: string) => void; isPlaying: boolean; onEnded?: () => void };
    player.setEndBehaviour("loop");
    player.isPlaying = false;
    player.onEnded?.();
    await vi.waitFor(() => expect(mocks.lead).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playTriggersOf()).toHaveLength(1);
    session.pause();
  });
  it("sends load again when the session disarms and arms for the same song", () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.setArmed(false);
    session.setArmed(true);
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 1],
    ]);
  });

  it("sends end and then stop when the song reaches its end, and not when nothing was playing", async () => {
    const { session, out } = armedSession(output(), { cues: parseChart(chartA) });
    session.state.player?.onEnded?.();
    expect(sent(out)).toEqual([[192, 1]]);
    await session.play();
    session.state.player?.onEnded?.();
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 9],
      [176, 81, 127],
    ]);
  });

  it("sends each trigger once across a gapless hand-over: A's end and stop, then B's load, and B's play with its start", async () => {
    vi.useFakeTimers();
    const incoming = new StemPlayer({} as Stems);
    const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
    mocks.library.playlistPlaying = true;
    mocks.library.queue = ["a", "b"];
    mocks.library.preparedNext = () => next as never;
    mocks.library.advanceToPrepared = vi.fn(() => true);
    const { session, out, access, unload } = armedSession(output(), { queued: true, playlistPlaying: true, cues: parseChart(chartA) });
    await vi.advanceTimersByTimeAsync(10);
    expect(session.state.playing).toBe(true);
    expect(sent(out)).toEqual([[192, 1]]);
    mocks.position = 56;
    mocks.audioNow = 16;
    vi.advanceTimersByTime(4000);
    expect(mocks.library.advanceToPrepared).toHaveBeenCalledWith("b");
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 9],
      [176, 81, 127],
    ]);
    unload();
    session.dispose();
    const joined = joinedSession(out, access, { cues: parseChart(chartB) });
    expect(joined.session.state.player).toBe(incoming);
    expect(sent(out)).toEqual([
      [192, 1],
      [192, 9],
      [176, 81, 127],
      [193, 5],
    ]);
    expect(playTriggersOf().at(-1)).toEqual([[177, 80, 127]]);
    vi.useRealTimers();
  });
});

describe("remote actions", () => {
  /** A session on one input, with a view that records what the screen was asked to do. */
  function remoteSession(patch: Partial<SessionInputs> = {}) {
    const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
    const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
    const session = new PerformanceSession({
      initial: inputs(patch),
      carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
      initialClock: false,
    });
    session.loadSong(source, null);
    session.bind();
    const view = {
      scrollLyrics: vi.fn(),
      pdfOnScreen: vi.fn(() => false),
      fontSize: vi.fn(),
      toggleStage: vi.fn(),
      muteGroup: vi.fn(),
      toggleClick: vi.fn(),
      togglePart: vi.fn(),
      tap: vi.fn(),
    };
    session.setView(view);
    const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
    return { session, input, view, message };
  }
  const press = (key: string, target: EventTarget = window) => {
    const event = new KeyboardEvent("keydown", { key });
    target.dispatchEvent(event);
    return event;
  };
  const withBindings = (session: PerformanceSession, bindings: Binding[]) => session.update({ bindings });

  beforeEach(() => {
    stopLearn();
    useMidiConfiguration.getState().update({ bindings: defaultBindings() });
  });

  it("toggles a practice mute from a bound key, even while the performance screen is hidden, and clears it", () => {
    usePracticeMute.getState().clear();
    const { session } = remoteSession();
    withBindings(session, [
      { action: "practice.toggle.guitar", source: "key", match: { key: "g" } },
      { action: "practice.clear", source: "key", match: { key: "h" } },
    ]);
    session.shown = false;
    session.keyDown(press("g"));
    expect(usePracticeMute.getState().kinds).toEqual(["guitar"]);
    session.keyDown(press("g"));
    expect(usePracticeMute.getState().kinds).toEqual([]);
    session.keyDown(press("g"));
    session.keyDown(press("h"));
    expect(usePracticeMute.getState().kinds).toEqual([]);
    session.dispose();
  });

  it("runs the tempo tap from the T key, and the key is ignored while typing in a field", () => {
    const { session, view } = remoteSession();
    session.keyDown(press("t"));
    expect(view.tap).toHaveBeenCalledTimes(1);
    const field = document.createElement("input");
    document.body.appendChild(field);
    const typed = press("t", field);
    expect(session.keyDown(typed)).toBe(false);
    expect(view.tap).toHaveBeenCalledTimes(1);
    field.remove();
    session.dispose();
  });

  it("runs the bindings in stage mode, but not under another dialog", () => {
    const { session, view } = remoteSession();
    const dialog = (attributes: Record<string, string>) => {
      const element = document.createElement("div");
      element.setAttribute("role", "dialog");
      element.setAttribute("data-state", "open");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      document.body.appendChild(element);
      return element;
    };
    const stage = dialog({ "data-stage-mode": "" });
    session.keyDown(press("t"));
    expect(view.tap).toHaveBeenCalledTimes(1);
    session.keyDown(press("PageDown"));
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "This song has no sections." });
    const other = dialog({});
    expect(session.keyDown(press("t"))).toBe(false);
    expect(view.tap).toHaveBeenCalledTimes(1);
    other.remove();
    stage.remove();
    session.dispose();
  });

  it("runs only transport and song keys while the screen is hidden by another Song tab, and leaves other keys to the page", () => {
    const { session, view } = remoteSession();
    const cancelable = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      window.dispatchEvent(event);
      return event;
    };
    view.pdfOnScreen.mockReturnValue(true);
    session.shown = false;
    session.keyDown(cancelable("t"));
    expect(view.tap).not.toHaveBeenCalled();
    for (const key of ["PageDown", "ArrowRight"]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      expect(session.keyDown(event)).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(view.scrollLyrics).not.toHaveBeenCalled();
    withBindings(session, [{ action: "transport.playPause", source: "key", match: { key: " " } }]);
    const space = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    expect(session.keyDown(space)).toBe(true);
    expect(space.defaultPrevented).toBe(true);
    session.shown = true;
    withBindings(session, defaultBindings());
    expect(session.keyDown(new KeyboardEvent("keydown", { key: "PageDown" }))).toBe(true);
    expect(view.scrollLyrics).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("a focused checkbox does not block a binding, but a focused slider does", () => {
    const { session, view } = remoteSession();
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const range = document.createElement("input");
    range.type = "range";
    document.body.append(checkbox, range);
    session.keyDown(press("t", checkbox));
    expect(view.tap).toHaveBeenCalledTimes(1);
    expect(session.keyDown(press("t", range))).toBe(false);
    expect(view.tap).toHaveBeenCalledTimes(1);
    checkbox.remove();
    range.remove();
    session.dispose();
  });

  it("a binding that does not apply says why, and changes nothing", () => {
    const { session } = remoteSession();
    const before = session.state.sectionLive;
    session.keyDown(press("PageDown"));
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "This song has no sections." });
    expect(session.state.sectionLive).toBe(before);
    session.dispose();
  });

  it("refuses play from start in stage mode, and leaves play and pause working", () => {
    const { session } = remoteSession();
    withBindings(session, [{ action: "transport.playFromStart", source: "key", match: { key: "Home" } }]);
    session.locked = true;
    session.keyDown(press("Home"));
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "Seeking is locked in stage mode." });
    session.dispose();
  });

  it("shows the first press of a double press, and runs the action on the second", () => {
    const { session, view } = remoteSession();
    withBindings(session, [{ action: "tempo.tap", source: "key", match: { key: "y" }, doublePress: true }]);
    session.keyDown(press("y"));
    expect(mocks.toasts.at(-1)).toMatchObject({ title: "Press again to Tap tempo" });
    expect(view.tap).not.toHaveBeenCalled();
    session.keyDown(press("y"));
    expect(view.tap).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("learns a program change with its bank as one binding on the selected input", () => {
    const { session, message } = remoteSession();
    startLearn({ source: "midi", action: "song.select", index: 2 });
    const input = session.state.access?.inputs.get("in") as unknown as EventTarget;
    input.dispatchEvent(message([0xb2, 0, 1]));
    expect(useRemoteLearn.getState().seen).toContain("program change");
    expect(useRemoteLearn.getState().target).not.toBeNull();
    input.dispatchEvent(message([0xb2, 32, 3]));
    input.dispatchEvent(message([0xc2, 9]));
    const learned = useMidiConfiguration.getState().bindings.at(-1);
    expect(learned).toEqual({ action: "song.select", index: 2, source: "midi", match: { status: 0xc0, channel: 3, data1: 9, bank: 131 } });
    expect(useRemoteLearn.getState().target).toBeNull();
    expect(useRemoteLearn.getState().result).toBe("Bound Ch 3 · Program 9 · bank 131.");
    session.dispose();
  });

  it("names the binding a learned key already runs, and binds nothing", () => {
    const { session } = remoteSession();
    const before = useMidiConfiguration.getState().bindings.length;
    startLearn({ source: "key", action: "song.next" });
    session.keyDown(press("PageDown"));
    expect(useRemoteLearn.getState().result).toBe("Already bound to Key PageDown. Remove that binding first.");
    expect(useMidiConfiguration.getState().bindings).toHaveLength(before);
    session.dispose();
  });

  it("learns a key, and Escape cancels Learn", () => {
    const { session } = remoteSession();
    startLearn({ source: "key", action: "view.stage" });
    session.keyDown(press("F9"));
    expect(useRemoteLearn.getState().result).toBe("Bound Key F9.");
    startLearn({ source: "key", action: "view.stage" });
    session.keyDown(press("Escape"));
    expect(useRemoteLearn.getState().target).toBeNull();
    expect(useRemoteLearn.getState().result).toBe("Learn cancelled.");
    session.dispose();
  });

  it("runs Start and Stop from the input, and ignores our own Stop coming back in", async () => {
    const { session, input, message } = remoteSession();
    input.dispatchEvent(message([250]));
    await vi.waitFor(() => expect(session.state.playing).toBe(true));
    // Our own Stop, echoed by a THRU input, must not stop the song.
    session.sendPerformance([252]);
    input.dispatchEvent(message([252]));
    expect(session.state.playing).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 250));
    input.dispatchEvent(message([252]));
    expect(session.state.playing).toBe(false);
    session.dispose();
  });

  it("does nothing with a key while a MIDI message is being learned, and a pedal while a key is", () => {
    const { session, view, input, message } = remoteSession();
    startLearn({ source: "midi", action: "view.stage" });
    expect(session.keyDown(press("t"))).toBe(false);
    expect(view.tap).not.toHaveBeenCalled();
    stopLearn();
    startLearn({ source: "key", action: "view.stage" });
    input.dispatchEvent(message([0xb0, 80, 127]));
    expect(session.state.playing).toBe(false);
    expect(useRemoteLearn.getState().target).not.toBeNull();
    stopLearn();
    session.dispose();
  });

  it("steps the speed down with its key and says when it is at the limit", () => {
    const { session } = remoteSession();
    // The song is shared by the tests above, so its speed is set rather than assumed.
    session.setSpeed({ rate: 1 });
    withBindings(session, [{ action: "speed.down", source: "key", match: { key: "-" } }]);
    session.keyDown(press("-"));
    expect(session.state.speed.rate).toBeCloseTo(0.95);
    for (let i = 0; i < 20; i++) session.keyDown(press("-"));
    expect(session.state.speed.rate).toBe(0.5);
    expect(mocks.toasts.at(-1)).toEqual({ tone: "info", title: "Speed is at its minimum." });
    session.dispose();
  });
});

describe("song triggers", () => {
  type Song = { id: string; title: string; settings: Record<string, string> };
  const song = (id: string, title: string, trigger?: object): Song => ({
    id,
    title,
    settings: { ":options": JSON.stringify(trigger ? { midiTrigger: trigger } : {}) },
  });
  const library = (songs: Song[]) => Object.assign(mocks.library, { index: { songs } });
  const pc = (channel: number, program: number) => ({ type: "pc", channel, program });
  const message = (data: number[]) => Object.assign(new Event("midimessage"), { data: Uint8Array.from(data) });
  const now = () => performance.now();

  /** A session on the selected input, with the song triggers switched as given. */
  function triggerSession(triggers: Partial<SongTriggerSettings> = {}, patch: Partial<SessionInputs> = {}, from = source) {
    useMidiConfiguration.getState().update({ songTriggers: { ...SONG_TRIGGER_DEFAULTS, listen: true, ...triggers } });
    const input = Object.assign(new EventTarget(), { id: "in", state: "connected" });
    const access = Object.assign(new EventTarget(), { outputs: new Map(), inputs: new Map([["in", input]]) }) as unknown as MIDIAccess;
    const session = new PerformanceSession({
      initial: inputs(patch),
      carried: { access, portId: "", inputId: "in", armed: false, output: undefined },
      initialClock: false,
    });
    session.loadSong(from, null);
    session.bind();
    return { session, input, send: (data: number[]) => input.dispatchEvent(message(data)) };
  }

  beforeEach(() => {
    stopLearn();
    useMidiConfiguration.getState().update({ bindings: defaultBindings() });
    Object.assign(mocks.library, { busy: false, playlistPlaying: false, queue: [], position: 0, autoplayId: null, notice: "" });
    library([song("a", "Song A"), song("b", "Song B", pc(2, 9)), song("c", "Song C", pc(2, 10))]);
    mocks.library.load.mockClear();
    mocks.library.skipPlaylist.mockClear();
    mocks.library.armNext.mockClear();
  });

  it("loads the song that a program change selects, on the selected input", () => {
    const { session, send } = triggerSession();
    send([0xc1, 9]);
    expect(mocks.library.load).toHaveBeenCalledWith("b");
    session.dispose();
  });

  it("keeps the input listening after a program change loads a song, so the next program change loads another", () => {
    mocks.library.midiSession = null;
    const first = triggerSession();
    first.send([0xc1, 9]);
    expect(mocks.library.load).toHaveBeenCalledWith("b");
    first.session.dispose();
    // The view is re-created for the song that loaded: it takes the input the one before had selected.
    const next = new PerformanceSession({
      initial: inputs(),
      carried: carriedInto(mocks.library.midiSession, { queued: false, playlistPlaying: false }),
      initialClock: false,
    });
    next.loadSong(source, null);
    next.bind();
    expect(next.state.inputId).toBe("in");
    next.state.access!.inputs.get("in")!.dispatchEvent(message([0xc1, 10]));
    expect(mocks.library.load).toHaveBeenLastCalledWith("c");
    next.dispose();
  });

  it("does nothing with a program change while song triggers are off, and with a program no song uses", () => {
    const off = triggerSession({ listen: false });
    off.send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    off.session.dispose();
    const on = triggerSession();
    on.send([0xc1, 99]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    expect(on.session.state.error).toBe("");
    expect(mocks.toasts.at(-1)).not.toMatchObject({ title: expect.stringContaining("not loaded") });
    on.session.dispose();
  });

  it("in the playlist scope, a song outside the playlist is not selected, and one in it moves the set to it", () => {
    mocks.library.queue = ["a", "c"];
    const { session, send } = triggerSession({ scope: "playlist" }, { queued: true });
    send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    expect(mocks.library.skipPlaylist).not.toHaveBeenCalled();
    send([0xc1, 10]);
    expect(mocks.library.skipPlaylist).toHaveBeenCalledWith(1);
    session.dispose();
  });

  it("a binding that claims the program change keeps the song from loading", () => {
    const { session, send } = triggerSession();
    session.update({ bindings: [{ action: "section.next", source: "midi", match: { status: 0xc0, channel: 2, data1: 9 } }] });
    send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    session.dispose();
  });

  it("our own program change or Song Select coming back through THRU does not load a song", () => {
    const { session, send } = triggerSession();
    const t = now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(t);
    // Scheduled for 500 ms ahead, and echoed back 5 ms after it went out.
    session.sendPerformance([0xc1, 9], t + 500);
    clock.mockReturnValue(t + 505);
    send([0xc1, 9]);
    session.sendPerformance([0xf3, 12], t + 500);
    send([0xf3, 12]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    clock.mockRestore();
    session.dispose();
  });

  it("a program change that arrives before our scheduled one goes out is a press, and loads the song", () => {
    const { session, send } = triggerSession();
    const t = now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(t);
    session.sendPerformance([0xc1, 9], t + 500);
    send([0xc1, 9]);
    expect(mocks.library.load).toHaveBeenCalledWith("b");
    clock.mockRestore();
    session.dispose();
  });

  it("a pedal that sends the same change twice loads once", () => {
    const { session, send } = triggerSession();
    send([0xc1, 9]);
    send([0xc1, 9]);
    expect(mocks.library.load).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("while a song plays, the default ignores a trigger and says so", async () => {
    const { session, send } = triggerSession();
    void session.play();
    await vi.waitFor(() => expect(session.state.playing).toBe(true));
    send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    expect(session.state.playing).toBe(true);
    expect(mocks.toasts.at(-1)).toMatchObject({ title: "Song B was not loaded" });
    session.dispose();
  });

  it("with arm as next, a triggered song is armed while the set plays, and nothing stops", async () => {
    mocks.library.playlistPlaying = true;
    const { session, send } = triggerSession({ whilePlaying: "next" }, { queued: true, playlistPlaying: true });
    void session.play();
    await vi.waitFor(() => expect(session.state.playing).toBe(true));
    send([0xc1, 9]);
    expect(mocks.library.armNext).toHaveBeenCalledWith("b");
    expect(mocks.library.load).not.toHaveBeenCalled();
    expect(session.state.playing).toBe(true);
    session.dispose();
  });

  it("with stop and load now, a playing song stops and the triggered one loads", async () => {
    const { session, send } = triggerSession({ whilePlaying: "now" });
    void session.play();
    await vi.waitFor(() => expect(session.state.playing).toBe(true));
    send([0xc1, 9]);
    expect(session.state.playing).toBe(false);
    expect(mocks.library.load).toHaveBeenCalledWith("b");
    session.dispose();
  });

  it("autoplay asks for the loaded song to start, and that song starts once it is ready", async () => {
    const { session, send } = triggerSession({ autoplay: true });
    send([0xc1, 9]);
    expect(mocks.library.autoplayId).toBe("b");
    session.dispose();
    const loaded = triggerSession({}, {}, { ...source, libraryId: "b" });
    await vi.waitFor(() => expect(loaded.session.state.playing).toBe(true));
    expect(mocks.library.autoplayId).toBeNull();
    loaded.session.dispose();
  });

  it("a trigger while a song is still loading is not loaded, and says so", () => {
    mocks.library.busy = true;
    const { session, send } = triggerSession();
    send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    expect(mocks.toasts.at(-1)).toMatchObject({ title: "Song B was not loaded", body: "A song is still loading." });
    session.dispose();
  });

  it("a song that is already loaded is left alone", () => {
    library([song("a", "Song A", pc(2, 9))]);
    const { session, send } = triggerSession();
    send([0xc1, 9]);
    expect(mocks.library.load).not.toHaveBeenCalled();
    session.dispose();
  });

  it("learns a song's trigger from a program change with its bank, names the clash, and saves it", () => {
    library([song("a", "Song A"), song("b", "Song B"), song("d", "Song D", pc(2, 9))]);
    const { session, send } = triggerSession();
    startLearn({ source: "song", songId: "b" });
    send([0xb1, 0, 0]);
    send([0xb1, 32, 1]);
    expect(useRemoteLearn.getState().target).not.toBeNull();
    send([0xc1, 9]);
    expect(mocks.library.setSongTrigger).toHaveBeenCalledWith("b", { type: "pc", channel: 2, program: 9, bankMsb: 0, bankLsb: 1 });
    expect(useRemoteLearn.getState().target).toBeNull();
    expect(useRemoteLearn.getState().result).toBe("Song B loads on Ch 2 · Program 9 · bank 0/1. Same trigger as Song D; the first in the library loads.");
    expect(mocks.library.load).not.toHaveBeenCalled();
    session.dispose();
  });

  it("learns Song Select as a song's trigger", () => {
    const { session, send } = triggerSession();
    startLearn({ source: "song", songId: "b" });
    send([0xf3, 42]);
    expect(mocks.library.setSongTrigger).toHaveBeenCalledWith("b", { type: "songselect", number: 42 });
    expect(useRemoteLearn.getState().result).toBe("Song B loads on Song Select 42.");
    session.dispose();
  });

  it("says why a controller cannot be learned as a song's trigger, and learns nothing", () => {
    const { session, send } = triggerSession();
    startLearn({ source: "song", songId: "b" });
    send([0xb0, 80, 127]);
    expect(useRemoteLearn.getState().target).not.toBeNull();
    expect(useRemoteLearn.getState().seen).toContain("Only a program change or Song Select selects a song.");
    expect(mocks.library.setSongTrigger).not.toHaveBeenCalled();
    stopLearn();
    session.dispose();
  });

  it("says a learned trigger that a binding already answers will not load the song", () => {
    const { session, send } = triggerSession();
    session.update({ bindings: [{ action: "section.next", source: "midi", match: { status: 0xc0, channel: 2, data1: 9 } }] });
    startLearn({ source: "song", songId: "b" });
    send([0xc1, 9]);
    expect(useRemoteLearn.getState().result).toContain("already runs an action, so the song will not load.");
    session.dispose();
  });
});

describe("MIDI timecode in the session", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives the scheduler the rate and the offset, and sends no app clock while timecode is on", async () => {
    const { session, out } = armedSession(output(), { timecode: { enabled: true, fps: 25, offset: "01:02:03:04" } });
    session.setClock(true);
    await session.play();
    await vi.advanceTimersByTimeAsync(100);
    const config = mocks.configs.at(-1)!;
    expect(config.timecode).toEqual({ fps: 25, offset: 93079 });
    expect(config.clock).toBe(false);
    expect(out.send.mock.calls.some((c) => c[0][0] === 250)).toBe(false);
    session.pause();
  });

  it("gives the scheduler no timecode while it is off", async () => {
    const { session } = armedSession(output(), { timecode: { enabled: false, fps: 25, offset: "99:99:99:99" } });
    await session.play();
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.configs.at(-1)!.timecode).toBeUndefined();
    session.pause();
  });

  it("refuses to play when the offset is not valid at the rate, and says why", async () => {
    const { session } = armedSession(output(), { timecode: { enabled: true, fps: 24, offset: "00:00:00:24" } });
    await session.play();
    expect(session.state.playing).toBe(false);
    expect(session.state.error).toBe("MIDI timecode offset: Frames must be 0 to 23 at 24 fps.");
  });
});

it("counts a playing song as played once, at its halfway point, with the set it played in", async () => {
  vi.useFakeTimers();
  mocks.library.playlistPlaying = true;
  mocks.library.playingSet = "set-1";
  const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  const player = session.state.player! as unknown as { isPlaying: boolean };
  player.isPlaying = true;
  mocks.position = 10;
  vi.advanceTimersByTime(3000);
  expect(mocks.library.recordPlay).not.toHaveBeenCalled();
  mocks.position = 31;
  vi.advanceTimersByTime(3000);
  expect(mocks.library.recordPlay).toHaveBeenCalledTimes(1);
  expect(mocks.library.recordPlay).toHaveBeenCalledWith("a", "set-1");
  mocks.position = 55;
  vi.advanceTimersByTime(3000);
  expect(mocks.library.recordPlay).toHaveBeenCalledTimes(1);
  unload();
  session.dispose();
  vi.useRealTimers();
});

it("holds a chained song in the library, and lets go of it when the chain is undone", async () => {
  vi.useFakeTimers();
  const incoming = new StemPlayer({} as Stems);
  const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
  mocks.library.playlistPlaying = true;
  mocks.library.queue = ["a", "b"];
  mocks.library.preparedNext = () => next as never;
  const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
  await vi.advanceTimersByTimeAsync(10);
  mocks.position = 56;
  mocks.audioNow = 16;
  vi.advanceTimersByTime(250);
  expect(session.state.player).not.toBe(incoming);
  const holds = mocks.library.holdChain.mock.calls as unknown as ({ id: string; release(): void } | null)[][];
  const hold = holds.at(-1)![0]!;
  expect(hold.id).toBe("b");
  hold.release();
  expect(holds.at(-1)![0]).toBeNull();
  expect(mocks.library.advanceToPrepared).not.toHaveBeenCalled();
  unload();
  session.dispose();
  vi.useRealTimers();
});

describe("per-entry overrides on the playing song", () => {
  const reset = () => {
    mocks.library.playlistPlaying = true;
    mocks.library.queue = ["a", "b"];
    mocks.library.queueOverrides = [];
    mocks.library.position = 0;
  };
  afterEach(() => {
    reset();
    mocks.library.queueOverrides = [];
  });

  it("a stop override ends the playlist at that song, even when the song itself would go on", async () => {
    vi.useFakeTimers();
    reset();
    mocks.library.queueOverrides = [{ endBehaviour: "stop" }, null];
    mocks.library.pausePlaylist = vi.fn();
    mocks.library.advancePlaylist = vi.fn(async () => {});
    const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
    await vi.advanceTimersByTimeAsync(10);
    (session.state.player as unknown as { onEnded(): void }).onEnded();
    expect(mocks.library.pausePlaylist).toHaveBeenCalledTimes(1);
    expect(mocks.library.advancePlaylist).not.toHaveBeenCalled();
    unload();
    session.dispose();
    vi.useRealTimers();
  });

  it("a loop override loops the song inside the player, whatever the song itself says", async () => {
    vi.useFakeTimers();
    reset();
    mocks.library.queueOverrides = [{ endBehaviour: "loop" }, null];
    const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
    await vi.advanceTimersByTimeAsync(10);
    expect((session.state.player as unknown as { behaviour: string }).behaviour).toBe("loop");
    unload();
    session.dispose();
    vi.useRealTimers();
  });

  it("an entry that waits for Play does not start by itself when it becomes the playing song", async () => {
    vi.useFakeTimers();
    reset();
    mocks.library.position = 1;
    mocks.library.queueOverrides = [null, { autoplay: false }];
    const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(session.state.playing).toBe(false);
    unload();
    session.dispose();
    vi.useRealTimers();
  });

  it("an entry that waits for Play is not chained onto the song before it", async () => {
    vi.useFakeTimers();
    reset();
    const incoming = new StemPlayer({} as Stems);
    const next = { id: "b", title: "B", source: { name: "b.wav", libraryId: "b", audio: source.audio }, stems: {}, settings: {}, player: incoming };
    mocks.library.queueOverrides = [null, { autoplay: false }];
    mocks.library.preparedNext = () => next as never;
    const { session, unload } = armedSession(output(), { queued: true, playlistPlaying: true });
    await vi.advanceTimersByTimeAsync(10);
    mocks.position = 56;
    mocks.audioNow = 16;
    vi.advanceTimersByTime(250);
    expect(session.state.player).not.toBe(incoming);
    expect(mocks.library.holdChain).not.toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    unload();
    session.dispose();
    vi.useRealTimers();
  });
});

describe("a start from a position after a chase", () => {
  const chartBefore = "[00:10] {midi:pc 1 4}\n[00:20] {midi:cc 1 11 90}";
  it("holds the audio back so the chase goes out first, and sends Continue after the chase", async () => {
    mocks.position = 30;
    const out = output();
    const { session } = armedSession(out);
    session.update({ cues: parseChart(chartBefore) });
    session.setClock(true);
    await session.play();
    // With clock on the hold is CLOCK_LEAD_MS (150 ms), which is longer than the chase's 100 ms.
    expect(mocks.lead).toMatchObject({ startDelay: 0.15 });
    // The scheduler sends its chase at once; the Continue byte is timed for when the audio begins, 150 ms later.
    const chaseAt = performance.timeOrigin + performance.now();
    mocks.sends.at(-1)!({ bytes: [192, 4], due: chaseAt, label: "Chase state" } as never);
    const timeOf = (byte: number) => out.send.mock.calls.find(([bytes]) => bytes[0] === byte)![1] as number;
    expect(timeOf(192)).toBeCloseTo(chaseAt - performance.timeOrigin, 0);
    expect(timeOf(251) - timeOf(192)).toBeGreaterThanOrEqual(90);
    session.pause();
  });
  it("does not delay a start from 0:00 with no clock to start", async () => {
    mocks.position = 0;
    const out = output();
    const { session } = armedSession(out);
    session.update({ cues: parseChart(chartBefore) });
    await session.play();
    expect(mocks.lead).not.toHaveProperty("startDelay");
    session.pause();
  });
  it("does not delay a start when no output is armed", async () => {
    mocks.position = 30;
    const session = new PerformanceSession({ initial: inputs(), carried: null, initialClock: false });
    const unload = session.loadSong(source, null);
    session.update({ cues: parseChart(chartBefore) });
    await session.play();
    expect(mocks.lead).not.toHaveProperty("startDelay");
    session.pause();
    unload();
  });
});

describe("a start with app clock and no count-in", () => {
  it("holds the audio back 150 ms, so Start goes out at the audio start, not before the first pulses", async () => {
    mocks.position = 0;
    const out = output();
    const { session } = armedSession(out);
    session.setClock(true);
    const before = performance.now();
    await session.play();
    expect(mocks.lead).toMatchObject({ startDelay: 0.15 });
    const timeOf = (byte: number) => out.send.mock.calls.find(([bytes]) => bytes[0] === byte)![1] as number;
    expect(timeOf(250) - before).toBeGreaterThanOrEqual(149);
    expect(timeOf(250) - before).toBeLessThan(170);
    session.pause();
  });
  it("does not hold the audio for the clock when a count-in comes first", async () => {
    mocks.position = 0;
    const out = output();
    const { session } = armedSession(out);
    session.update({ timing: { countInBars: 1, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 } });
    session.setClock(true);
    await session.play();
    expect(mocks.lead).not.toHaveProperty("startDelay");
    session.pause();
  });
});

describe("the play trigger through the real schedule", () => {
  const chart = "{midi@play: cc 1 80 127}\n{midi@stop: cc 1 81 127}";
  const playsSent = (out: ReturnType<typeof output>) => out.send.mock.calls.filter(([bytes]) => bytes[0] === 176 && bytes[1] === 80).length;
  /** Lets the schedule run for a few ticks, as its worker timer does. */
  const pump = async () => {
    for (let i = 0; i < 4; i++) {
      mocks.schedules.at(-1)?.tick(performance.timeOrigin + performance.now());
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  beforeEach(() => {
    mocks.realSchedule = true;
    mocks.realTime = true;
  });
  afterEach(() => {
    mocks.realSchedule = false;
    mocks.realTime = false;
  });
  it("sends the play trigger on a start from the middle and on each resume", async () => {
    const out = output();
    const { session } = armedSession(out);
    session.update({ cues: parseChart(chart), timing: { countInBars: 1, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 } });
    session.setClock(true);
    mocks.position = 30;
    await session.play();
    await pump();
    expect(playsSent(out)).toBe(1);
    session.pause();
    await session.play();
    await pump();
    expect(playsSent(out)).toBe(2);
    expect(mocks.dropped.map((m) => m.bytes)).toEqual([]);
    session.pause();
  });
  it("sends the play trigger on a start from the middle with no count-in", async () => {
    const out = output();
    const { session } = armedSession(out);
    session.update({ cues: parseChart(chart), timing: { countInBars: 0, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 } });
    session.setClock(true);
    mocks.position = 30;
    await session.play();
    await pump();
    expect(playsSent(out)).toBe(1);
    expect(mocks.dropped.map((m) => m.bytes)).toEqual([]);
    session.pause();
  });
});

describe("Send cues stays on", () => {
  const remember = (outputId = "usb") => useMidiConfiguration.setState({ sendCues: { on: true, outputId } });
  /** A session that starts disarmed with the saved USB output and an open system access, as a remount after Enable. */
  function freshSession(out = output(), outputId = "usb") {
    const access = Object.assign(new EventTarget(), { outputs: new Map([[outputId, out]]), inputs: new Map() }) as unknown as MIDIAccess;
    const session = new PerformanceSession({
      initial: inputs({ savedOutput: { id: outputId, name: "USB", transport: "system" } }),
      carried: { access, portId: outputId, inputId: "", armed: false, output: null },
      initialClock: false,
    });
    session.loadSong(source, null);
    session.bind();
    return { session, out, access };
  }

  it("starts armed for the remembered, connected output", () => {
    remember();
    const { session } = freshSession();
    expect(selectArmed(session.state)).toBe(true);
    expect(session.state.armedByPreference).toBe(true);
  });

  it("starts disarmed when the preference was set for another output, or is off", () => {
    remember("other");
    expect(selectArmed(freshSession().session.state)).toBe(false);
    useMidiConfiguration.setState({ sendCues: { on: false, outputId: "usb" } });
    expect(selectArmed(freshSession().session.state)).toBe(false);
  });

  it("starts disarmed with the output disconnected, and arms when it connects", async () => {
    remember();
    const out = output();
    out.state = "disconnected";
    const { session, access } = freshSession(out);
    expect(selectArmed(session.state)).toBe(false);
    out.state = "connected";
    const fresh = Object.assign(new EventTarget(), { outputs: new Map([["usb", out]]), inputs: new Map() }) as unknown as MIDIAccess;
    vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => fresh) });
    access.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() => expect(selectArmed(session.state)).toBe(true));
  });

  it("arms again when a lost output returns", async () => {
    remember();
    const { session, access, out } = freshSession();
    out.state = "disconnected";
    access.dispatchEvent(new Event("statechange"));
    expect(selectArmed(session.state)).toBe(false);
    expect(useMidiDiagnostics.getState().lastFailure).toBe("System MIDI output disconnected. Cues disarmed.");
    const back = output();
    const fresh = Object.assign(new EventTarget(), { outputs: new Map([["usb", back]]), inputs: new Map() }) as unknown as MIDIAccess;
    vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => fresh) });
    (access.outputs as unknown as Map<string, unknown>).set("usb", back);
    access.dispatchEvent(new Event("statechange"));
    await vi.waitFor(() => expect(selectArmed(session.state)).toBe(true));
    expect(session.state.midiStatus).toBe("MIDI output reconnected. Send cues is on.");
    expect(session.output).toBe(back);
  });

  it("arms a re-enumerated object while armed, and does not once the preference is off", () => {
    remember();
    const { session, access } = freshSession();
    const replacement = output();
    (access.outputs as unknown as Map<string, unknown>).set("usb", replacement);
    access.dispatchEvent(new Event("statechange"));
    expect(selectArmed(session.state)).toBe(true);
    expect(session.output).toBe(replacement);
    session.disarm();
    expect(selectArmed(session.state)).toBe(false);
    (access.outputs as unknown as Map<string, unknown>).set("usb", output());
    access.dispatchEvent(new Event("statechange"));
    expect(selectArmed(session.state)).toBe(false);
  });

  it("arms a new Bluetooth connection for the remembered output", () => {
    remember("bluetooth-midi");
    const first = { ...output(), id: "bluetooth-midi", subscribe: vi.fn() };
    const session = new PerformanceSession({ initial: inputs({ bluetooth: first as never }), carried: null, initialClock: false });
    session.loadSong(source, null);
    session.bind();
    expect(selectArmed(session.state)).toBe(true);
    session.update({ bluetooth: null });
    expect(selectArmed(session.state)).toBe(false);
    session.update({ bluetooth: { ...first } as never });
    expect(selectArmed(session.state)).toBe(true);
  });

  it("writes the preference when Send cues is ticked and unticked, and Disarm writes false", () => {
    const { session } = freshSession();
    session.sendCues(true);
    expect(useMidiConfiguration.getState().sendCues).toEqual({ on: true, outputId: "usb" });
    expect(session.state.armedByPreference).toBe(false);
    session.sendCues(false);
    expect(useMidiConfiguration.getState().sendCues.on).toBe(false);
    session.sendCues(true);
    session.panicAndDisarm();
    expect(selectArmed(session.state)).toBe(false);
    expect(useMidiConfiguration.getState().sendCues.on).toBe(false);
  });

  it("choosing another output disarms without arming it, and keeps the preference", () => {
    remember();
    const { session, access } = freshSession();
    const second = output();
    (access.outputs as unknown as Map<string, unknown>).set("usb2", second);
    session.setArmed(false);
    session.setPortId("usb2");
    expect(selectArmed(session.state)).toBe(false);
    expect(useMidiConfiguration.getState().sendCues).toEqual({ on: true, outputId: "usb" });
  });

  it("a send fault disarms the session but keeps the preference, and the next session arms", () => {
    remember();
    const { session, out } = freshSession();
    out.send.mockImplementation(() => {
      throw new Error("port closed");
    });
    session.sendPerformance([192, 1]);
    expect(selectArmed(session.state)).toBe(false);
    expect(session.state.error).toBe("MIDI send failed: port closed. Cues disarmed.");
    expect(useMidiConfiguration.getState().sendCues).toEqual({ on: true, outputId: "usb" });
    out.send.mockReset();
    expect(selectArmed(freshSession(out).session.state)).toBe(true);
  });

  it("a remounted session starts armed, and a song loaded by hand does too", () => {
    remember();
    const { session } = freshSession();
    session.dispose();
    const remount = new PerformanceSession({
      initial: inputs({ savedOutput: { id: "usb", name: "USB", transport: "system" } }),
      carried: carriedInto(
        { access: session.state.access, portId: "usb", inputId: "", armed: true, output: session.output },
        { queued: false, playlistPlaying: false },
      ),
      initialClock: false,
    });
    expect(selectArmed(remount.state)).toBe(true);
  });

  it("opens system MIDI by itself on bind when Send cues is remembered for the saved USB output", async () => {
    remember();
    const out = output();
    const access = Object.assign(new EventTarget(), { outputs: new Map([["usb", out]]), inputs: new Map() }) as unknown as MIDIAccess;
    vi.stubGlobal("navigator", { requestMIDIAccess: vi.fn(async () => access) });
    const session = new PerformanceSession({
      initial: inputs({ savedOutput: { id: "usb", name: "USB", transport: "system" } }),
      carried: null,
      initialClock: false,
    });
    session.loadSong(source, null);
    session.bind();
    await vi.waitFor(() => expect(selectArmed(session.state)).toBe(true));
    expect(session.state.midiStatus).toBe("MIDI output reconnected. Send cues is on.");
  });
});

describe("managed RC-10R preparation", () => {
  beforeEach(() => clearSettingsCache());
  const managed = (chart: string) => parseChart(chart).map((cue) => ({ ...cue, managed: "rhythm" as const }));
  const chart = "{midi@load:pc 2 0}\n[00:00] {nochase} {midi:cc 2 80 127} {midi:cc 2 80 0}\n{midi@stop:cc 2 83 127} {midi@stop:cc 2 83 0}";
  it("recalls an edited memory while armed and prepares it again before Play", async () => {
    const { session, out, unload } = armedSession(output(), { cues: managed(chart) });
    try {
      out.send.mockClear();
      session.update({ cues: managed(chart.replace("pc 2 0", "pc 2 5")) });
      expect(out.send.mock.calls.some(([bytes]) => bytes[0] === 0xc1 && bytes[1] === 5)).toBe(true);
      out.send.mockClear();
      await session.play();
      expect(out.send.mock.calls.some(([bytes]) => bytes[0] === 0xc1 && bytes[1] === 5)).toBe(true);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("sends the resolved quarter-note tempo independently of the song's dotted-quarter pulse", async () => {
    const { session, unload } = armedSession(output(), { bpm: 90, rhythmTempo: 135, tempoOnStart: true, tempoChannel: 16, cues: managed(chart) });
    try {
      await session.play();
      expect(mocks.configs.at(-1)?.tempo).toEqual([
        [0xbf, 73, 1],
        [0xbf, 74, 7],
      ]);
      expect(mocks.configs.at(-1)?.bpm).toBe(135);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("requires a restart after pausing mid-song and keeps the output armed for that restart", async () => {
    const { session, unload } = armedSession(output(), { cues: managed(chart) });
    try {
      await session.play();
      mocks.position = 10;
      session.pause();
      await session.play();
      expect(session.state.playing).toBe(false);
      expect(session.state.rhythmRestart).toBe(true);
      expect(session.armed).toBe(true);
      expect(session.state.error).toContain("Play from beginning");
      await session.playFromBeginning();
      expect(session.state.playing).toBe(true);
      expect(session.state.rhythmRestart).toBe(false);
      expect(session.state.error).toBe("");
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("refuses live section loops, jumps and speed changes with pedal rhythm armed", async () => {
    const { session, unload } = armedSession(output(), { cues: managed(chart), sections: [{ id: "v", name: "Verse", start: 0, end: 20, mode: "continue" }] });
    try {
      await session.play();
      session.toggleSectionLoop("v");
      session.tapSection("v");
      session.jumpSectionNow("v");
      session.setSpeed({ rate: 0.8 });
      expect(session.state.sectionLive.loop).toBeNull();
      expect(session.state.sectionLive.jump).toBeNull();
      expect(session.state.speed.rate).toBe(1);
      expect(session.state.error).toContain("Pause and restart");
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
});

describe("Before song preparation", () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const preparationSettings = { enabled: true, settleMs: 1000, openingPresets: true };
  const setup = () => {
    const cues = parseChart("[00:00] {midi:cc 16 0 0} {midi:pc 16 6}\n{midi@prepare:$READY}", [
      { code: "READY", label: "Ready", commands: ["cc 3 12 0", "pc 3 7"] },
    ]);
    return armedSession(output(), { cues, preparationSettings, tempoOnStart: true, tempoChannel: 16, bpm: 140 });
  };
  it("prepares to Ready without audio or Play triggers, then starts immediately without repeating setup", async () => {
    const { session, out, unload } = setup();
    try {
      const preparing = session.preparePedals();
      await vi.waitFor(() => expect(session.state.preparing).not.toBeNull());
      await vi.advanceTimersByTimeAsync(1100);
      await preparing;
      expect(session.state.pedalsReady).toBe(true);
      expect(session.state.playing).toBe(false);
      expect(session.state.player?.isPlaying).toBe(false);
      expect(mocks.configs).toHaveLength(0);
      const sent = out.send.mock.calls.length;
      await session.play();
      expect(session.state.playing).toBe(true);
      expect(session.state.pedalsReady).toBe(false);
      expect(out.send.mock.calls).toHaveLength(sent);
      expect(mocks.configs.at(-1)?.prepared?.messages).toContainEqual([0xcf, 6]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it.each(["bpm", "cues", "settings", "tempo", "output", "disconnect", "seek", "manual"])("invalidates Ready after %s changes", async (change) => {
    const { session, unload, out, access } = setup();
    try {
      const preparing = session.preparePedals();
      await vi.waitFor(() => expect(session.state.preparing).not.toBeNull());
      await vi.advanceTimersByTimeAsync(1100);
      await preparing;
      expect(session.state.pedalsReady).toBe(true);
      if (change === "bpm") session.update({ bpm: 130 });
      if (change === "cues") session.update({ cues: parseChart("{midi@prepare:pc 3 9}") });
      if (change === "settings") session.update({ preparationSettings: { ...preparationSettings, settleMs: 2000 } });
      if (change === "tempo") session.update({ tempoOnStart: false });
      if (change === "output") session.setArmed(false);
      if (change === "disconnect") {
        out.state = "disconnected";
        access.dispatchEvent(new Event("statechange"));
      }
      if (change === "seek") await session.seek(0.2);
      if (change === "manual") session.sendPerformance([0xc2, 10]);
      expect(session.state.pedalsReady).toBe(false);
      expect(session.state.playing).toBe(false);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("sends presets and custom macro messages before the loading wait, then tempo before audio", async () => {
    const { session, out, unload } = setup();
    try {
      const playing = session.play();
      await vi.waitFor(() => expect(session.state.preparing?.label).toBe("Waiting for pedals"));
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xbf, 0, 0],
        [0xcf, 6],
        [0xb2, 12, 0],
        [0xc2, 7],
      ]);
      expect(session.state.player?.isPlaying).toBe(false);
      await vi.advanceTimersByTimeAsync(1100);
      await playing;
      expect(session.state.player?.isPlaying).toBe(true);
      expect(session.state.preparing).toBeNull();
      expect(out.send.mock.calls.slice(-2).map((call) => call[0])).toEqual([
        [0xbf, 73, 1],
        [0xbf, 74, 12],
      ]);
      expect(mocks.configs.at(-1)?.tempo).toBeNull();
      expect(mocks.configs.at(-1)?.prepared?.messages).toContainEqual([0xcf, 6]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("cancels the waiting start without playing audio or sending a later tempo", async () => {
    const { session, out, unload } = setup();
    try {
      const playing = session.play();
      await vi.waitFor(() => expect(session.state.preparing).not.toBeNull());
      session.cancelStart();
      await vi.advanceTimersByTimeAsync(2000);
      await playing;
      expect(session.state.player?.isPlaying).toBe(false);
      expect(session.state.preparing).toBeNull();
      expect(out.clear).toHaveBeenCalled();
      expect(out.send.mock.calls.some((call) => call[0][1] === 74)).toBe(false);
    } finally {
      unload();
      session.dispose();
    }
  });
  it("cancels rather than running stale commands when setup changes during preparation", async () => {
    const { session, unload } = setup();
    try {
      const playing = session.play();
      await vi.waitFor(() => expect(session.state.preparing).not.toBeNull());
      session.update({ preparationSettings: { ...session.state.preparationSettings! }, timing: { ...session.state.timing } });
      expect(session.state.starting).toBe(true);
      session.update({ cues: parseChart("{midi@prepare:pc 3 8}") });
      await vi.advanceTimersByTimeAsync(2000);
      await playing;
      expect(session.state.playing).toBe(false);
      expect(session.state.error).toContain("setup changed during preparation");
    } finally {
      unload();
      session.dispose();
    }
  });
  it("keeps bank/preset and macro messages together while spacing setup commands", async () => {
    const { session, out, unload } = setup();
    session.update({ preparationSettings: { ...preparationSettings, commandGapMs: 250 } });
    try {
      const playing = session.play();
      await vi.waitFor(() => expect(session.state.preparing?.label).toBe("Between setup commands"));
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xbf, 0, 0],
        [0xcf, 6],
      ]);
      await vi.advanceTimersByTimeAsync(100);
      expect(out.send.mock.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(150);
      expect(out.send.mock.calls.slice(-2).map((call) => call[0])).toEqual([
        [0xb2, 12, 0],
        [0xc2, 7],
      ]);
      session.cancelStart();
      await vi.advanceTimersByTimeAsync(3000);
      await playing;
      expect(session.state.playing).toBe(false);
      expect(out.send.mock.calls.some((call) => call[0][1] === 73)).toBe(false);
    } finally {
      unload();
      session.dispose();
    }
  });
});

describe("preparation command repeat rules", () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  const setup = (chart: string, commandGapMs = 0) => {
    const result = armedSession(output(), { cues: parseChart(chart), preparationSettings: { enabled: true, openingPresets: true, settleMs: 0, commandGapMs } });
    result.session.resetPreparationCommands();
    return result;
  };
  it("resumes with Every start only, and replays beginning commands only at the trimmed start", async () => {
    const { session, out, unload } = setup("{midi@prepare:pc 1 5}\n{midi@prepare-beginning:cc 3 20 127}\n{midi@prepare-once:cc 4 21 127}");
    Object.assign(session.state.player!, { start: 10 });
    mocks.position = 10;
    try {
      await session.preparePedals();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xc0, 5],
        [0xb2, 20, 127],
        [0xb3, 21, 127],
      ]);
      expect(session.state.preparationOnceUsed).toBe(1);
      await session.play();
      expect(out.send.mock.calls).toHaveLength(3);
      session.pause();
      mocks.position = 10.02;
      out.send.mockClear();
      await session.play();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([[0xc0, 5]]);
      session.pause();
      mocks.position = 10;
      out.send.mockClear();
      await session.play();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xc0, 5],
        [0xb2, 20, 127],
      ]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("keeps an interrupted once line consumed, and resets it only on an explicit request", async () => {
    const { session, out, unload } = setup("{midi@prepare-once:cc 3 20 127} {midi@prepare-once:cc 3 20 0}");
    try {
      out.send.mockImplementationOnce(() => session.cancelStart());
      await session.preparePedals();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([[0xb2, 20, 127]]);
      expect(session.state.preparationOnceUsed).toBe(1);
      await session.preparePedals();
      expect(out.send.mock.calls).toHaveLength(1);
      expect(session.state.pedalsReady).toBe(true);
      session.resetPreparationCommands();
      expect(session.state.preparationOnceUsed).toBe(0);
      expect(session.state.pedalsReady).toBe(false);
      expect(out.send.mock.calls).toHaveLength(1);
      await session.preparePedals();
      expect(out.send.mock.calls.slice(-2).map((call) => call[0])).toEqual([
        [0xb2, 20, 127],
        [0xb2, 20, 0],
      ]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("does not consume a once command when preparation is cancelled before sending begins", async () => {
    const { session, out, unload } = setup("{midi@prepare-once:pc 3 9}");
    try {
      const pending = session.preparePedals();
      session.cancelStart();
      await pending;
      expect(session.state.preparationOnceUsed).toBe(0);
      expect(out.send).not.toHaveBeenCalled();
      await session.preparePedals();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([[0xc2, 9]]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("does not automatically repeat an ambiguous failed once send after rearming", async () => {
    const { session, out, unload } = setup("{midi@prepare-once:cc 3 22 127}");
    try {
      out.send.mockImplementationOnce(() => {
        throw new Error("link failed");
      });
      await session.preparePedals();
      expect(session.state.preparationOnceUsed).toBe(1);
      expect(session.state.pedalsReady).toBe(false);
      session.setArmed(true);
      await session.preparePedals();
      expect(out.send).toHaveBeenCalledTimes(1);
      expect(session.state.pedalsReady).toBe(true);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
});

describe("individual preparation waits", () => {
  beforeEach(() => {
    clearSettingsCache();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  it("uses the preview's exact wait plan, keeps a bank pair together, and stops at Ready without audio", async () => {
    const { session, out, unload } = armedSession(output(), {
      cues: parseChart("{label:Patch} {midi@prepare:cc 3 0 0} {midi@prepare wait=0.5:pc 3 5}\n{label:Effect} {midi@prepare wait=0.2:cc 3 12 64}"),
      preparationSettings: { enabled: true, settleMs: 100, openingPresets: true },
      tempoOnStart: true,
      tempoChannel: 16,
      bpm: 140,
    });
    try {
      expect(session.preparationPreview()?.totalWaitMs).toBe(900);
      expect(out.send).not.toHaveBeenCalled();
      const pending = session.preparePedals();
      await vi.waitFor(() => expect(session.state.preparing?.label).toBe("Wait after Patch"));
      expect(session.state.preparationPlan?.totalWaitMs).toBe(900);
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xb2, 0, 0],
        [0xc2, 5],
      ]);
      await vi.advanceTimersByTimeAsync(350);
      expect(out.send.mock.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(150);
      expect(out.send.mock.calls.at(-1)?.[0]).toEqual([0xb2, 12, 64]);
      await vi.advanceTimersByTimeAsync(400);
      await pending;
      expect(session.state.pedalsReady).toBe(true);
      expect(session.state.playing).toBe(false);
      expect(out.send.mock.calls.slice(-2).map((call) => call[0])).toEqual([
        [0xbf, 73, 1],
        [0xbf, 74, 12],
      ]);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
  it("cancels a wait before the next command and keeps an attempted once action used", async () => {
    const { session, out, unload } = armedSession(output(), {
      cues: parseChart("{label:Once} {midi@prepare-once wait=0.5:cc 3 25 127}\n{midi@prepare:pc 3 4}"),
      preparationSettings: { enabled: true, settleMs: 0, openingPresets: true },
    });
    session.resetPreparationCommands();
    try {
      const pending = session.preparePedals();
      await vi.waitFor(() => expect(session.state.preparing?.label).toBe("Wait after Once"));
      session.cancelStart();
      await pending;
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([[0xb2, 25, 127]]);
      expect(session.preparationPreview()?.totalWaitMs).toBe(0);
      await session.preparePedals();
      expect(out.send.mock.calls.map((call) => call[0])).toEqual([
        [0xb2, 25, 127],
        [0xc2, 4],
      ]);
      expect(session.state.preparationOnceUsed).toBe(1);
    } finally {
      session.pause();
      unload();
      session.dispose();
    }
  });
});
