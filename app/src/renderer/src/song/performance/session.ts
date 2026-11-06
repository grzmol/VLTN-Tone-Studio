import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import { StemPlayer, type Lead, type RenderedBuffers } from "@/song/stems/player";
import { RenderQueue, isPlainSpeed } from "@/song/audio/render-queue";
import { DEFAULT_SPEED, clampRate, clampSpeed, effectiveBpm, speedFromOptions, speedOptions, type SpeedSettings } from "./speed";
import { sharedPlaybackEngine } from "@/song/audio/playback-engine";
import { useSongLibrary, type HandedOverSong, type PreparedSong } from "@/song/library";
import { playableStems } from "@/song/stems/playable";
import { useNav } from "@/state/nav";
import { useOutputSettings } from "@/song/audio/output-settings";
import { showToast } from "@/app/notify";
import { host } from "@/host";
import type { SongSource, Stems } from "@/song/types";
import { expandSectionCues, type Cue, type MidiTrigger } from "@/song/performance/chart";
import { setClockPosition, startPlaybackClock } from "@/song/performance/playback-clock";
import { beatSeconds, countInBeats, preRollStart } from "@/song/performance/rhythm";
import { HANDOVER_LEAD_S, planTransition, type Transition } from "@/song/performance/transition";
import { readCrossfade } from "@/song/performance/crossfade";
import { songCountIn, type SongCountIn } from "@/song/performance/lead-in";
import { getSetting, performanceKey, setSetting } from "@/song/performance/settings";
import { playerShape, shapeFromOptions, type EndBehaviour } from "@/song/performance/song-shape";
import { startMidiScheduler, prepareMidiScheduler, midiNow, type SchedulerDegraded } from "@/song/performance/midi-scheduler-client";
import { CHASE_LEAD_MS, chaseTriggerSet, computeChaseState, type TriggerCc } from "@/song/performance/midi-chase";
import { configuredPedals, usePedalLibrary } from "@/song/performance/pedal-library";
import { BLUETOOTH_LOOKAHEAD, SYSTEM_LOOKAHEAD, type SchedulerJump, type TimecodeTail } from "@/song/performance/midi-scheduler";
import { orderForPedal } from "@/song/performance/midi-pedal-order";
import { NO_TIMECODE, timecodeOffsetFrames, type TimecodeSetting } from "@/song/performance/timecode";
import {
  armJump,
  cancelJump,
  clampSections,
  DECISION_LEAD_S,
  immediateJump,
  NO_LIVE,
  nextBoundary,
  releaseLoop,
  sectionIndexAt,
  sortedSections,
  startLoop,
  type Section,
  type SectionBoundary,
  type SectionLive,
} from "@/song/performance/sections";
import { useMidiDiagnostics } from "@/song/performance/midi-diagnostics";
import { rememberedPort, useMidiConfiguration, type PortChoice } from "@/song/performance/midi-configuration";
import type { BleMidiConnection } from "@/bluetooth/connection";
import { countsAsPlayed } from "@shared/library-history";
import { ACTIONS, actionLabel, isActionId, runAction, type ActionHost, type Hint, type ViewHost } from "./actions";
import { FollowerGate } from "./band-control";
import { isFollowerAction, type FollowerAction } from "@shared/band-sync";
import {
  RemoteRouter,
  defaultBindings,
  describeBinding,
  dialogOpen,
  findConflict,
  isModifierKey,
  isTypingTarget,
  normaliseKey,
  stopLearn,
  useRemoteLearn,
  type ActionLearnTarget,
  type Binding,
  type BankTracker,
  type LearnStep,
  type MidiEvent,
  type Route,
  type SongHit,
} from "./bindings";
import {
  bindingClaiming,
  describeTrigger,
  songEntries,
  songForEvent,
  songLearnStep,
  songsInScope,
  triggerClashes,
  type SongEntry,
} from "./song-triggers";

/*
 * Everything that keeps a song's MIDI cues, transport and remote input running during a performance, without React.
 * The component tree renders `state` and calls the methods; it never owns the scheduler, the arming binding or the
 * panic path. Timing-critical lifecycle code lives in `effects`, which mirror the dependency-array semantics the
 * panel used before: each effect re-runs when one of its inputs changes and its cleanup runs first.
 */

export type MidiOutput = MIDIOutput | BleMidiConnection;
export const BLUETOOTH_PORT_ID = "bluetooth-midi";

/** How often the session checks whether the next playlist song can be chained onto this one */
const CHAIN_CHECK_MS = 250;
/** The next song is chained this far before its join, so that a pause in between has time to undo it */
const CHAIN_AHEAD_S = 5;
/** How often the playing song is checked for having reached its halfway point, to count it as played. */
const PLAYED_CHECK_MS = 1000;

export interface LateNotice {
  dropped: number;
  position: number;
  resynced: boolean;
  at: number;
}

/** What one song carries to the next: the access, ports and input, and whether the outputs were armed. */
export interface CarriedMidi {
  access: MIDIAccess | null;
  portId: string;
  inputId: string;
  armed: boolean;
  output: unknown;
}

/**
 * The MIDI a song takes from the one before it. Arming carries only into a playlist that is playing, so a song loaded by hand
 * starts disarmed and its cues wait for the user to arm them.
 */
export function carriedInto(midi: CarriedMidi | null, next: { queued: boolean; playlistPlaying: boolean }): CarriedMidi | null {
  if (!midi) return null;
  return { ...midi, armed: midi.armed && next.queued && next.playlistPlaying };
}

/** The lead-in before a start: whole bars of count-in, beats of pre-roll, and a delay before either (seconds). */
export interface Timing {
  countInBars: number;
  beatsPerBar: number;
  preRollBeats: number;
  startDelay: number;
}

export const NO_TIMING: Timing = { countInBars: 0, beatsPerBar: 4, preRollBeats: 0, startDelay: 0 };

export interface SessionState {
  player: StemPlayer | null;
  playing: boolean;
  access: MIDIAccess | null;
  portId: string;
  inputId: string;
  /** Arming belongs to this exact connection object, never just a reusable port ID. */
  armedOutput: MidiOutput | null;
  /** Whether the session armed itself from the remembered Send cues preference, rather than the user arming it just now. */
  armedByPreference: boolean;
  clock: boolean;
  midiStatus: string;
  error: string;
  lateNotice: LateNotice | null;
  portsVersion: number;
  /** Inputs owned by other parts of the app, pushed in with `update()`. */
  bluetooth: BleMidiConnection | null;
  tempoOnStart: boolean;
  tempoChannel: number;
  savedOutput: PortChoice | null;
  savedInput: PortChoice | null;
  queued: boolean;
  playlistPlaying: boolean;
  busy: boolean;
  cues: Cue[];
  parseError: string;
  bpm: number;
  timing: Timing;
  /** A start is waiting: the start delay, or the scheduler worker. A Play press cancels it. */
  starting: boolean;
  /** The song's sections, from its options */
  sections: Section[];
  /** What the performer has asked for about sections since the song started */
  sectionLive: SectionLive;
  /** The song's speed and pitch, as the player plays them */
  speed: SpeedSettings;
  /** Tracks rendered out of the tracks in the render, while a render is being built */
  rendering: { done: number; total: number } | null;
  /** The decided boundary that is still to take effect: a jump (to `target`) or a pause, and the song time it lands at */
  sectionNext: { kind: "jump" | "pause"; target: string | null; at: number } | null;
  /** What each MIDI message or key runs. Saved with the MIDI configuration. */
  bindings: Binding[];
  /** MIDI timecode: on or off, the rate, and the song's offset (see timecode.ts). Timecode replaces app clock while it is on. */
  timecode: TimecodeSetting;
}

export type SessionInputs = Pick<
  SessionState,
  "bluetooth" | "tempoOnStart" | "tempoChannel" | "savedOutput" | "savedInput" | "queued" | "playlistPlaying" | "busy" | "cues" | "parseError" | "bpm"
> &
  Partial<Pick<SessionState, "timing" | "sections" | "bindings" | "timecode">>;

/** The actions the session carries out itself: transport, songs, sections and arming. The screen supplies the rest (see `setView`). */
export type SessionHost = Omit<ActionHost, keyof ViewHost>;

const NOT_ON_SCREEN = (): Hint => "This control is not on screen.";
/** The view actions before the performance screen has supplied its own. */
const NO_VIEW: ViewHost = {
  scrollLyrics: NOT_ON_SCREEN,
  pdfOnScreen: () => false,
  fontSize: NOT_ON_SCREEN,
  toggleStage: NOT_ON_SCREEN,
  muteGroup: NOT_ON_SCREEN,
  toggleClick: NOT_ON_SCREEN,
  togglePart: NOT_ON_SCREEN,
  tap: NOT_ON_SCREEN,
};

/** The action groups a key may run while the performance screen is hidden by another Song tab. */
const HIDDEN_KEY_GROUPS = new Set<string>(["Transport", "Songs"]);
/** Whether a binding's action is a transport or song action, which still runs while the screen is hidden. */
const runsWhileHidden = (action: string): boolean => isActionId(action) && HIDDEN_KEY_GROUPS.has(ACTIONS[action].group);

/** How far a speed key moves the rate: 5% */
const SPEED_STEP = 0.05;
/** Shown when Learn is given a key with a modifier, which a binding cannot match */
const MODIFIER_HINT = "Use a key without Ctrl, Alt or Cmd.";

/** Shown when the remembered output is back and Send cues arms it again. */
const REARMED_STATUS = "MIDI output reconnected. Send cues is on.";

/** Shown after a sleep re-enumerated the port and the session was armed: the cues must be armed again to send. */
const RECONNECTED_STATUS = "MIDI output reconnected after sleep. Send cues to arm again.";

/**
 * A port that can no longer take messages. Only a port whose state is not "connected" is dead. A Web MIDI output starts with
 * connection "closed" until it is opened or first sent to, and sending opens it, so that is not a dead port.
 */
function portIsDead(output: MidiOutput | undefined): boolean {
  return !output || output.state !== "connected";
}

export function selectOutput(s: Pick<SessionState, "portId" | "bluetooth" | "access">): MidiOutput | undefined {
  return (s.portId === BLUETOOTH_PORT_ID ? s.bluetooth : s.access?.outputs.get(s.portId)) ?? undefined;
}

export function selectArmed(s: Pick<SessionState, "portId" | "bluetooth" | "access" | "armedOutput">): boolean {
  const output = selectOutput(s);
  return !!s.armedOutput && s.armedOutput === output && output?.state === "connected";
}

/**
 * A boundary the session has decided and is waiting for. `before` is the live state it was decided from, put back if the decision
 * is cancelled. `schedule` is what the MIDI scheduler was told, so it can be told again if the scheduler restarts.
 */
interface SectionPlan {
  kind: "continue" | "pause" | "jump";
  /** Audio time at which the boundary takes effect */
  ctxAt: number;
  before: SectionLive;
  /** The sections the decision was made on. Editing them drops the decision. */
  sections: Section[];
  schedule: { cap: number; jump: SchedulerJump | null } | null;
}

/** The values `panic` needs, captured when a stop is scheduled rather than when it runs. */
interface PanicContext {
  output: MidiOutput | undefined;
  armed: boolean;
  clock: boolean;
}

interface Effect {
  deps: (s: SessionState) => unknown[];
  run: (s: SessionState) => void | (() => void);
  last?: unknown[];
  cleanup?: void | (() => void);
}

export interface SessionOptions {
  initial: SessionInputs;
  /** Arming handed over by the previous playlist song. */
  carried: CarriedMidi | null;
  initialClock: boolean;
}

/** A render swap waits at least this long (audio seconds) for its beat, so the MIDI schedule hears of it before it takes effect */
const RENDER_SWAP_LEAD_S = 0.3;

/**
 * A start with app clock and no count-in holds the audio back this long, so Start and the first clock pulses go out before it. The
 * scheduler starts about 100 ms after Play and anchors the pulses on the audio start. Without the hold, the pulses for that first
 * 100 ms are already overdue when it starts, and go out in one burst. With the hold they are due on time.
 */
const CLOCK_LEAD_MS = 150;

/** A song's options as an object. Anything that is not an object reads as empty. */
function parseOptions(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Whether the app has moved off Performance. A remount on the same screen is not leaving. Only the panel's teardown asks this, and a
 * switch to another Song tab keeps the panel mounted, so it does not pause the set.
 */
export function leftPerformance(): boolean {
  const nav = useNav.getState();
  return nav.screen !== "song" || nav.param !== "performance";
}

export class PerformanceSession {
  readonly store: StoreApi<SessionState>;
  private effects: Effect[];
  /** Stage mode: seeking is refused however it is requested. */
  locked = false;
  /**
   * Whether the performance screen is on screen. Another Song tab hides it without stopping anything; while hidden, a key runs only the
   * transport and song actions, and any other key is left to the visible tab. MIDI and Bluetooth messages are not changed by this.
   */
  shown = true;
  private bound = false;
  private flushing = false;
  private dirty = false;
  private batchDepth = 0;
  /** Stop and end messages waiting for the effects that the stop caused to finish (see `sendTriggers`). */
  private heldTriggers: { bytes: number[]; kind: MidiTrigger }[] = [];
  private unsubscribe: (() => void) | null = null;
  private unsubscribeResume: (() => void) | null = null;
  /** Set when the remembered system port was lost while armed. Its return re-acquires it, since the object from before is not trusted. */
  private portLost = false;
  private scheduler: ReturnType<typeof startMidiScheduler> | null = null;
  private prepared: ReturnType<typeof prepareMidiScheduler> | null = null;
  private readyWorker: Worker | null = null;
  private clearedOutput: MidiOutput | undefined;
  private playRequest = 0;
  private playPending = false;
  private startTempo: number[][] | null = null;
  private startPosition: number | null = null;
  /** The count-in before the audio of the current start, in ms. The start tempo is due at its beginning. */
  private countInMs = 0;
  /** Epoch ms when the audio of a delayed start begins. Set only while a chase leads the audio; the transport byte goes out then. */
  private transportAt: number | null = null;
  private cancelDelay: (() => void) | null = null;
  private noteChannels = new Set<number>();
  private previousBluetooth: BleMidiConnection | null;
  private section: SectionPlan | null = null;
  /** Whether the scheduler was last given a hold, so that clearing it is sent once */
  private planSent = false;
  /** The next playlist song, once it has been started on this song's clock */
  private chained: HandedOverSong | null = null;
  /** The outgoing song's quarter frames up to its join, for the next scheduler this session starts. Consumed once. */
  private incomingTail: TimecodeTail | null = null;
  private handoverTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the playing song has been counted as played. Counted once per song, at its halfway point. */
  private playedRecorded = false;
  private playedTimer: ReturnType<typeof setInterval> | null = null;
  private expandedCues: { cues: Cue[]; sections: Section[]; value: Cue[] } | null = null;
  private clampedSections: { source: Section[]; start: number; end: number; value: Section[] } | null = null;
  /** The id of the song being handed over to, from the moment the library moves on until the session that takes it over is set up */
  private handingOver: string | null = null;
  /** Set when a hand-over starts this session's song on a set that is already running: the set's Start went out with its first song */
  private joining = false;
  /** Set while a song that ends hands the set on to the next song: the set goes on, so the outgoing song sends no transport Stop */
  private endingIntoSet = false;
  /** The output a transport Stop was last sent to, until a Start or Continue goes out. One stop sends one Stop, however many cleanups run. */
  private stoppedOn: MidiOutput | undefined;
  /** Set while a song that missed its loop pass restarts from its start. The restart is a loop pass, so it sends no play trigger. */
  private restartingLoop = false;
  /** The stems at 100%, which every render is made from */
  private baseStems: Stems | null = null;
  /** The settings key of the song loaded, under which its speed is stored */
  private songSettingsKey = "";
  private renders = new RenderQueue();
  /** Counts speed requests, so a render that a newer request has overtaken is dropped */
  private renderRequest = 0;
  /** A built render waiting for the next beat of the song that is playing */
  private pendingRender: RenderedBuffers | null = null;
  /** A render swap that is on its way: the song time it takes effect at, and the audio time, which is also the MIDI jump */
  private renderSwap: { at: number; ctxAt: number; rate: number } | null = null;
  /** The `{midi@play}` messages of the start that the next scheduler sends. Cleared by any scheduler run, so a start sends them once. */
  private startPlay: number[][] | null = null;
  /** The player whose `{midi@load}` messages were sent while armed. Disarming clears it, so arming again sends them again. */
  private loadedPlayer: StemPlayer | null = null;
  /** The library id of the song loaded, when it is saved. A song trigger for this song does nothing. */
  private loadedSongId: string | undefined;
  /** Set when a MIDI trigger asked for the loaded song to start: it starts once its player is ready and the library is idle */
  private autoplayPending = false;
  /** Decides what each incoming MIDI message and key press runs, and recognises our own output coming back */
  private readonly remote = new RemoteRouter();
  private readonly followerGate = new FollowerGate();
  /** The view actions, which the performance screen supplies (see `setView`) */
  private view: ViewHost = NO_VIEW;
  /** What the session does for the remote actions. Each returns a hint when the action does not apply now. */
  private readonly sessionActions: SessionHost = {
    play: () => {
      if (!this.state.player) return "No song is loaded.";
      this.startPlayback();
    },
    playPause: () => {
      if (!this.state.player) return "No song is loaded.";
      if (this.state.playing) this.pause();
      else this.startPlayback();
    },
    stop: () => {
      if (!this.state.player) return "No song is loaded.";
      this.pause();
    },
    playFromStart: () => {
      if (!this.state.player) return "No song is loaded.";
      // Seeking is refused in stage mode, so the song would carry on from where it is.
      if (this.locked) return "Seeking is locked in stage mode.";
      void this.seek(0).then(() => this.startPlayback());
    },
    panic: () => this.panicAndDisarm(),
    nextSong: () => this.skipSong(1),
    previousSong: () => this.skipSong(-1),
    selectSong: (n) => this.selectSong(n),
    crossfade: () => {
      if (!this.crossfadeNext()) return "Crossfade needs a playing playlist with the next song ready.";
    },
    nextSection: () => this.stepSection(1),
    previousSection: () => this.stepSection(-1),
    armSection: (n) => this.sectionAt(n, (id) => this.tapSection(id)),
    jumpSection: (n) => this.sectionAt(n, (id) => this.jumpSectionNow(id)),
    toggleSectionLoop: () => {
      const { ids, current } = this.sectionOrder();
      if (current < 0) return "No section is playing.";
      this.toggleSectionLoop(ids[current]);
    },
    exitSectionLoop: () => {
      if (this.sectionOrder().current < 0) return "No section is playing.";
      this.releaseSectionLoop();
    },
    cancelSectionJump: () => {
      if (!this.state.sectionLive.jump) return "No jump is armed.";
      this.cancelSectionJump();
    },
    arm: () => {
      const output = this.output;
      if (!output || output.state !== "connected") return "Choose a connected MIDI output first.";
      this.sendCues(true);
    },
    disarm: () => this.disarm(),
    speed: (change) => {
      const rate = this.state.speed.rate;
      if (change === "reset") {
        if (rate !== 1) this.setSpeed({ rate: 1 });
        return;
      }
      const next = clampRate(Math.round((rate + (change === "up" ? SPEED_STEP : -SPEED_STEP)) * 100) / 100);
      if (next === rate) return change === "up" ? "Speed is at its maximum." : "Speed is at its minimum.";
      this.setSpeed({ rate: next });
    },
  };

  constructor(options: SessionOptions) {
    const { initial, carried } = options;
    const bluetooth = initial.bluetooth;
    // An empty carried id means nothing was carried, so the saved choice still applies to a song loaded by hand.
    const portId =
      carried?.portId || (initial.savedOutput?.transport === "system" ? initial.savedOutput.id : bluetooth?.state === "connected" ? bluetooth.id : "");
    const access = carried?.access ?? null;
    const first = selectOutput({ portId, bluetooth, access });
    this.previousBluetooth = bluetooth;
    this.store = createStore<SessionState>(() => ({
      player: null,
      playing: false,
      access,
      portId,
      inputId: carried?.inputId || (initial.savedInput?.transport === "bluetooth" ? BLUETOOTH_PORT_ID : ""),
      armedOutput: carried?.armed && carried.output === first && first?.state === "connected" ? first : null,
      armedByPreference: false,
      clock: options.initialClock,
      midiStatus: "",
      error: "",
      lateNotice: null,
      portsVersion: 0,
      timing: NO_TIMING,
      starting: false,
      sections: [],
      sectionLive: NO_LIVE,
      sectionNext: null,
      speed: DEFAULT_SPEED,
      rendering: null,
      bindings: defaultBindings(),
      timecode: NO_TIMECODE,
      ...initial,
    }));
    this.effects = this.createEffects();
    // The preference arms a new session for its remembered output, when that output is connected.
    if (!this.state.armedOutput && !this.armRemembered() && portId !== BLUETOOTH_PORT_ID && this.rememberedFor(portId) && access) this.portLost = true;
  }

  get state(): SessionState {
    return this.store.getState();
  }

  /** The audio engine's position, for callers that need it outside of rendering. */
  get position(): number {
    return this.state.player?.position ?? 0;
  }

  get output(): MidiOutput | undefined {
    return selectOutput(this.state);
  }

  get armed(): boolean {
    return selectArmed(this.state);
  }

  // ---- lifecycle -----------------------------------------------------------------------------------------------

  /**
   * Creates the audio player for the song, or takes over the next playlist song that is already playing on this clock. Returns the
   * cleanup, which leaves the playlist running if the source is merely replaced.
   */
  loadSong(source: SongSource | null, stems: Stems | null): () => void {
    const handover = this.claimHandover(source);
    if (!source) return () => {};
    this.loadedSongId = source.libraryId;
    this.playedRecorded = false;
    this.autoplayPending = useSongLibrary.getState().takeAutoplay(source.libraryId);
    const options = getSetting(performanceKey(source), ":options");
    const shape = playerShape(shapeFromOptions(options));
    const speed = speedFromOptions(options);
    this.baseStems = playableStems(stems, source.audio);
    this.songSettingsKey = performanceKey(source);
    this.renders.clear();
    this.pendingRender = null;
    this.renderSwap = null;
    const player = handover?.player ?? new StemPlayer(this.baseStems, sharedPlaybackEngine(), shape);
    // The song is now the playing entry, so its end behaviour is the entry's override, when it has one.
    player.setEndBehaviour(this.behaviourOf(player));
    const stopWiring = this.wirePlayer(player, source);
    if (handover) {
      this.startHandover(handover);
      // Playback carries on: the song is already running, so the transport goes on as it was.
      this.batch(() => this.set({ player, playing: true, speed }));
    } else {
      this.batch(() => {
        this.set({ player, playing: false, speed });
        setClockPosition(0);
      });
      // A song saved at another speed is rendered now. It plays at 100% until its render is in place.
      if (!isPlainSpeed(speed)) void this.renderSpeed(speed);
    }
    this.playedTimer = setInterval(this.checkPlayed, PLAYED_CHECK_MS);
    return () => {
      this.dropChained();
      if (this.playedTimer) clearInterval(this.playedTimer);
      this.playedTimer = null;
      stopWiring();
      // A hand-over keeps the worker, which the next song's scheduler is about to use.
      if (this.handingOver === null) {
        this.cancelPendingStart();
        this.terminateWorker();
      }
      void player.dispose();
      // Leaving Performance pauses the set. Checked later, so that a remount on the same screen (StrictMode's re-run, an advance) is not
      // taken for leaving: the screen is still Performance, and the set is still on this song or has moved on.
      const id = source.libraryId;
      setTimeout(() => {
        const library = useSongLibrary.getState();
        if (leftPerformance() && library.playlistPlaying && library.queue[library.position] === id) library.pausePlaylist();
      }, 0);
    };
  }

  /** Connects a song's player to the outputs and to the session. Returns the function that disconnects it. */
  private wirePlayer(player: StemPlayer, source: SongSource): () => void {
    player.onOutputWarning = (message) => showToast({ tone: "fault", title: "Audio output changed", body: message });
    // Outputs are applied now, and again whenever the saved outputs change. Playback keeps going through either.
    const applyOutputs = () => void player.setOutputs(useOutputSettings.getState().config);
    applyOutputs();
    const stopOutputs = useOutputSettings.subscribe((state, previous) => {
      if (state.config !== previous.config) applyOutputs();
    });
    // The player wraps a looping song on its own, so the scheduler is told the way it is for a section jump: a planned jump at the wrap.
    player.onLoopScheduled = ({ to, at, when }) => {
      if (this.state.player !== player || this.section || this.renderSwap) return;
      this.section = {
        kind: "jump",
        ctxAt: when,
        before: this.state.sectionLive,
        sections: this.playableSections,
        schedule: { cap: at, jump: { at: this.clockOf(when), position: to } },
      };
      this.sendPlan();
    };
    player.onEnded = () => {
      // A song the session has let go of has nothing left to say to it.
      if (this.state.player !== player) return;
      // A song that has handed over was ended by its hand-over, which sent its end and stop triggers.
      if (this.handingOver !== null) return;
      // The next song is already playing on this clock, so the hand-over is taken now rather than at its start.
      if (this.chained) {
        this.handOver();
        return;
      }
      // A looping song reaches its end only if its loop pass was missed. It then starts again from its trimmed start.
      if (this.behaviourOf(player) === "loop") {
        this.set({ playing: false });
        setClockPosition(player.start);
        this.restartingLoop = true;
        void player.seek(player.start).then(() => this.play());
        return;
      }
      this.batch(() => {
        // The song has reached its end, so its end and stop triggers go out before the playlist moves on. They are held until the effects
        // of this batch, which clear the output, have run.
        if (this.state.playing) {
          this.sendTriggers("end");
          this.sendTriggers("stop");
        }
        this.set({ playing: false });
        setClockPosition(player.duration);
        const library = useSongLibrary.getState();
        // A song set to stop the playlist ends it here, so the next song does not start on its own.
        if (this.behaviourOf(player) === "stop") {
          library.pausePlaylist();
          return;
        }
        if (library.playlistPlaying && library.queue[library.position] === source.libraryId) {
          // The effects run when the batch ends, so the flag is read by the transport cleanup below before it is cleared.
          this.endingIntoSet = true;
          void library.advancePlaylist();
        }
      });
      this.endingIntoSet = false;
    };
    return stopOutputs;
  }

  /**
   * The song the previous session handed over, when it is `source`: the library holds it until a session takes it up. Any other
   * held song is released there. The previous session's hook-up is undone here, and this session wires the song up again.
   */
  private claimHandover(source: SongSource | null): HandedOverSong | null {
    const handover = useSongLibrary.getState().claimHandover(source?.libraryId);
    handover?.unwire();
    return handover;
  }

  /** Whether a song this session handed over is still waiting in the library for the next session to take it up. */
  private get passing(): boolean {
    return this.handingOver !== null && useSongLibrary.getState().handover?.id === this.handingOver;
  }

  /** Sets the next song's start: its cues from its own start, and its tempo message at the start of its count-in. */
  private startHandover(chained: HandedOverSong): void {
    const armed = this.armed;
    try {
      this.startTempo = this.tempoMessages(armed, this.output, chained.player.playbackRate);
    } catch (e) {
      this.fail(e);
      this.startTempo = null;
    }
    this.startPosition = armed ? chained.player.start : null;
    this.startPlay = this.triggerBytes("play");
    this.countInMs = chained.countInMs;
    this.joining = true;
    this.incomingTail = chained.timecodeTail ? { ...chained.timecodeTail, end: chained.join } : null;
  }

  /** The outgoing scheduler's quarter-frame stream, which runs to the join. Null when the outgoing song sends no timecode. */
  private outgoingTimecode(join: number): TimecodeTail | null {
    const stream = this.scheduler?.timecodeStream();
    return stream ? { ...stream, end: join } : null;
  }

  /** Starts the effects. Safe to call again after `dispose()`. */
  bind() {
    this.bound = true;
    this.unsubscribe = this.store.subscribe(() => this.flush());
    this.unsubscribeResume = host.song.onSystemResume?.(this.resumeMidi) ?? null;
    this.flush();
    // A USB output is only reachable once system MIDI is open, so a remembered Send cues for it opens it, and opening arms it.
    const { savedOutput, access } = this.state;
    if (!access && savedOutput?.transport === "system" && this.rememberedFor(savedOutput.id) && typeof navigator.requestMIDIAccess === "function")
      void this.openMidi();
  }

  /** Runs every effect cleanup, which stops the scheduler and sends the final panic. */
  dispose() {
    this.dropSectionPlan();
    this.dropChained();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeResume?.();
    this.unsubscribeResume = null;
    for (const effect of this.effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
      effect.last = undefined;
    }
    this.bound = false;
  }

  /** Pushes values owned by other stores. Only changed values cause effects to re-run. */
  update(inputs: Partial<SessionInputs>) {
    const changed = (Object.keys(inputs) as (keyof SessionInputs)[]).some((key) => !Object.is(this.state[key], inputs[key]));
    if (changed) this.set(inputs);
  }

  // ---- triggers ------------------------------------------------------------------------------------------------

  /**
   * The cues the scheduler and the state chase use: the chart's cues, with each section cue turned into timed cues at the start of the sections
   * it names. The same array while neither the cues nor the sections change, and the chart's own array when it has no section cues, so a chart
   * without them behaves exactly as before.
   */
  private playCues(s: Pick<SessionState, "cues" | "sections">): Cue[] {
    const cached = this.expandedCues;
    if (cached && cached.cues === s.cues && cached.sections === s.sections) return cached.value;
    const value = expandSectionCues(s.cues, s.sections);
    this.expandedCues = { cues: s.cues, sections: s.sections, value };
    return value;
  }

  /** The messages of the song's triggers of one kind, in chart order. */
  private triggerBytes(kind: MidiTrigger): number[][] {
    return this.state.cues.filter((cue) => cue.trigger === kind).flatMap((cue) => cue.messages);
  }

  /**
   * Sends the song's `{midi@…}` messages of one kind, once each. Nothing is sent unless the session is armed, and a failed send is reported
   * rather than thrown, because a trigger must never stop the transport.
   *
   * A stop or end is sent only after the batch that caused it has run its effects. That stop clears the output, and the transport's cleanup
   * clears it again, which would drop a message still waiting in a Bluetooth buffer. So while a batch is open or its effects are running,
   * these messages are held and sent by `flush`, once the effects are done.
   */
  private sendTriggers(kind: MidiTrigger, cues: Cue[] = this.state.cues): void {
    if (!this.armed) return;
    try {
      const messages = orderForPedal(
        cues.filter((cue) => cue.trigger === kind).flatMap((cue) => cue.messages),
        this.state.tempoChannel,
        (bytes) => bytes,
      );
      if ((kind === "stop" || kind === "end") && (this.batchDepth > 0 || this.flushing)) {
        for (const bytes of messages) this.heldTriggers.push({ bytes, kind });
        return;
      }
      for (const bytes of messages) this.sendPerformance(bytes, undefined, `Song ${kind} trigger`);
    } catch (e) {
      this.fail(e);
    }
  }

  /** Sends the stop and end messages held by `sendTriggers`, in the order they were queued. */
  private sendHeldTriggers(): void {
    while (this.heldTriggers.length) {
      const { bytes, kind } = this.heldTriggers.shift()!;
      try {
        this.sendPerformance(bytes, undefined, `Song ${kind} trigger`);
      } catch (e) {
        this.fail(e);
      }
    }
  }

  // ---- state helpers -------------------------------------------------------------------------------------------

  private set(patch: Partial<SessionState>) {
    this.store.setState(patch);
  }

  /** Several state changes made together run the effects once afterwards, as one render did. */
  private batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      this.flush();
    }
  }

  private flush() {
    if (this.batchDepth > 0) return;
    if (!this.bound) {
      this.sendHeldTriggers();
      return;
    }
    if (this.flushing) {
      this.dirty = true;
      return;
    }
    this.flushing = true;
    try {
      do {
        this.dirty = false;
        for (const effect of this.effects) {
          const deps = effect.deps(this.state);
          if (effect.last && deps.every((value, i) => Object.is(value, effect.last?.[i]))) continue;
          effect.cleanup?.();
          effect.last = deps;
          try {
            effect.cleanup = effect.run(this.state);
          } catch (e) {
            // An effect must never surface as a failed Play; report it and keep the others running.
            useMidiDiagnostics.getState().fault(String(e));
            this.fail(e);
          }
        }
      } while (this.dirty);
    } finally {
      this.flushing = false;
    }
    this.sendHeldTriggers();
  }

  private context(): PanicContext {
    return { output: this.output, armed: this.armed, clock: this.state.clock };
  }

  private terminateWorker() {
    this.readyWorker?.terminate();
    this.readyWorker = null;
  }

  fail = (e: unknown) => this.set({ error: e instanceof Error ? e.message : String(e) });

  setMidiStatus = (midiStatus: string) => this.set({ midiStatus });
  setClock = (clock: boolean) => this.set({ clock });
  setPortId = (portId: string) => this.set({ portId });
  setInputId = (inputId: string) => this.set({ inputId });
  setAccess = (access: MIDIAccess | null) => this.set({ access });
  /** Arms or disarms this session only. Faults and output changes use it, so they leave the remembered preference alone. */
  setArmed = (value: boolean) => this.set({ armedOutput: value ? (this.output ?? null) : null, armedByPreference: false });

  /** The Send cues choice: arms or disarms, and remembers it for the selected output so later songs and sessions follow. */
  sendCues = (on: boolean) => {
    const { portId } = this.state;
    useMidiConfiguration.getState().update({ sendCues: { on, outputId: on ? portId : "" } });
    this.setArmed(on);
  };

  /** The explicit stop: disarms and turns the remembered preference off. */
  disarm = () => this.sendCues(false);

  /** Whether the Send cues preference was turned on for this port. */
  private rememberedFor(portId: string): boolean {
    const { on, outputId } = useMidiConfiguration.getState().sendCues;
    return on && outputId !== "" && outputId === portId;
  }

  /** Arms the selected output when the preference is on for it and it is connected. Returns whether it armed. */
  private armRemembered(): boolean {
    const output = this.output;
    if (!output || output.state !== "connected" || !this.rememberedFor(this.state.portId)) return false;
    this.set({ armedOutput: output, armedByPreference: true });
    return true;
  }

  /** Waits out the start delay. Cancelling resolves the wait at once. */
  private waitStartDelay(seconds: number): Promise<void> {
    if (seconds <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancelDelay = null;
        resolve();
      }, seconds * 1000);
      this.cancelDelay = () => {
        clearTimeout(timer);
        this.cancelDelay = null;
        resolve();
      };
    });
  }

  /** Invalidates the pending start (if any) so it does nothing when it resumes. */
  private cancelPendingStart() {
    this.playRequest++;
    this.playPending = false;
    this.set({ starting: false });
    const cancel = this.cancelDelay;
    this.cancelDelay = null;
    cancel?.();
  }

  /** Cancels a start that is still waiting (the start delay, or a worker). A second Play press does this. Once audio has begun it does nothing. */
  cancelStart = () => {
    if (this.playPending) this.cancelPendingStart();
  };

  /** Stops the scheduler and releases anything this session started. A second call for one stop does nothing. */
  panic = (context: PanicContext = this.context()) => {
    this.startPosition = null;
    this.scheduler?.stop();
    this.scheduler = null;
    const { output, armed, clock } = context;
    if (!output || this.clearedOutput === output) return;
    // Pause handlers and lifecycle cleanup can both run for one stop.
    // A second clear would cancel the BLE note releases queued by the first.
    this.clearedOutput = output;
    try {
      (output as { clear?: () => void }).clear?.();
      if (!armed || output.state !== "connected") {
        this.noteChannels.clear();
        return;
      }
      // CC64 is sustain on synths but looper Stop on the GP-150 / GP-180. Release only
      // channels where this session actually queued note messages.
      for (const ch of this.noteChannels)
        for (const bytes of [
          [176 + ch, 64, 0],
          [176 + ch, 123, 0],
        ]) {
          output.send(bytes);
          this.recordQueued(bytes, undefined, "Note cleanup");
        }
      this.noteChannels.clear();
      if (clock && this.stoppedOn !== output) {
        output.send([252]);
        this.recordQueued([252], undefined, "Transport Stop");
        this.stoppedOn = output;
      }
    } catch (e) {
      useMidiDiagnostics.getState().fault(String(e));
      this.fail(e);
    }
  };

  private recordQueued(bytes: number[], timestamp?: number, label = "Manual / transport") {
    // Whatever leaves the app may come back in through a THRU input, and must not be taken for a press. A scheduled message is
    // timed from its wire time, not from when it was queued, since USB cues are queued up to a second ahead.
    this.remote.echo.record(bytes, timestamp ?? performance.now());
    const queued = midiNow(),
      intended = (timestamp ?? performance.now()) + performance.timeOrigin;
    useMidiDiagnostics.getState().record({ label, intended, queued, lateMs: Math.max(0, queued - intended), bytes });
  }

  sendPerformance = (bytes: number[], timestamp?: number, label = "Manual / transport") => {
    this.clearedOutput = undefined;
    if (this.state.armedOutput && portIsDead(this.output)) {
      this.deadOutput("MIDI output is no longer connected. Cues disarmed.");
      return;
    }
    try {
      this.output?.send(bytes, timestamp);
    } catch (e) {
      this.deadOutput(`MIDI send failed: ${e instanceof Error ? e.message : String(e)}. Cues disarmed.`);
      return;
    }
    this.recordQueued(bytes, timestamp, label);
    if ((bytes[0] & 240) === 144 || (bytes[0] & 240) === 128) this.noteChannels.add(bytes[0] & 15);
  };

  /** Disarms because the output can no longer take messages. Armed cues are never dropped without a visible fault. */
  private deadOutput(message: string): void {
    useMidiDiagnostics.getState().fault(message);
    this.batch(() => {
      this.setArmed(false);
      this.fail(message);
    });
  }

  private degraded = (event: SchedulerDegraded) => {
    const diagnostics = useMidiDiagnostics.getState(),
      now = midiNow();
    if (event.resynced) diagnostics.resync();
    if (event.dropped.length)
      diagnostics.drop(event.dropped.map((m) => ({ label: m.label, intended: m.due, queued: now, lateMs: Math.max(0, now - m.due), bytes: m.bytes })));
    // Events from one stall arrive separately (resync, then drops); show them as one notice.
    const n = this.state.lateNotice;
    const recent = n !== null && now - n.at < 2000;
    this.set({
      lateNotice: {
        dropped: (recent ? n.dropped : 0) + event.dropped.length,
        position: event.position,
        resynced: (recent && n.resynced) || event.resynced,
        at: now,
      },
    });
  };

  // ---- transport -----------------------------------------------------------------------------------------------

  pause = () => {
    this.batch(() => {
      const { player } = this.state;
      const wasRunning = player?.isPlaying || this.playPending;
      // A stop trigger belongs to a start whose play trigger was sent, so a pause during a count-in sends none.
      const wasPlaying = this.state.playing;
      this.cancelPendingStart();
      this.dropSectionPlan();
      this.dropChained();
      if (this.renderSwap) {
        this.renderSwap = null;
        this.sendPlan();
      }
      player?.pause();
      this.applyPendingRender();
      this.set({ playing: false });
      // A pedal/THRU path can echo our Stop back into the selected input.
      // Repeated Stop while already stopped must not transmit another Stop.
      if (wasRunning) this.panic();
      if (wasPlaying) this.sendTriggers("stop");
      if (this.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
    });
  };

  play = async () => {
    const loopPass = this.restartingLoop;
    this.restartingLoop = false;
    const { player } = this.state;
    if (!player || this.state.parseError || this.playPending || player.isPlaying) return;
    const request = ++this.playRequest;
    this.playPending = true;
    this.set({ starting: true });
    const armed = this.armed,
      output = this.output;
    try {
      const { bpm, timing } = this.state;
      const tempoMessages = this.tempoMessages(armed, output);
      // An offset that is not valid at the rate stops the start, rather than sending the wrong position.
      if (armed) timecodeOffsetFrames(this.state.timecode);
      if (armed) {
        const warm = this.prepared ?? prepareMidiScheduler();
        this.prepared = warm;
        await warm.ready;
        if (request !== this.playRequest) return;
        this.readyWorker = warm.worker;
        this.prepared = null;
      }
      await this.waitStartDelay(timing.startDelay);
      if (request !== this.playRequest) return;
      const requestedPosition = player.position >= player.duration ? 0 : Math.max(0, player.position);
      // The count-in is clicked before the audio starts, so it begins with the tempo message.
      const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
      // The count-in is as long as the audio it leads: beats at the song tempo times the rate.
      this.countInMs = bpm > 0 ? (countIn * beatSeconds(bpm) * 1000) / player.playbackRate : 0;
      // A chase that the pedals need before the song begins holds the audio back by CHASE_LEAD_MS, so it goes out first. Nothing is held
      // when the output is not armed, or when there is no state to chase (a start from the beginning, or no cues before the position).
      const chaseStart = preRollStart(requestedPosition, timing.preRollBeats, bpm);
      const chaseLead = armed && computeChaseState(this.playCues(this.state), chaseStart, chaseTriggerSet(this.chaseTriggers())).length ? CHASE_LEAD_MS : 0;
      // Clock without a count-in has no lead-in to cover the scheduler's start, so the hold is CLOCK_LEAD_MS.
      const clockLead = armed && this.state.clock && !this.state.timecode.enabled && countIn === 0 ? CLOCK_LEAD_MS : 0;
      const lead = Math.max(chaseLead, clockLead) / 1000;
      this.transportAt = lead ? midiNow() + lead * 1000 : null;
      await player.play({ bpm, countInBeats: countIn, preRollBeats: timing.preRollBeats, ...(lead ? { startDelay: lead } : {}) });
      if (request !== this.playRequest) {
        player.pause();
        this.terminateWorker();
        return;
      }
      this.startTempo = tempoMessages;
      // Every start and resume sends the play trigger, except a loop pass, which is not a new play press.
      this.startPlay = loopPass ? null : this.triggerBytes("play");
      // Cues start from where the audio really starts: a pre-roll puts that before the requested position.
      this.startPosition = armed ? preRollStart(requestedPosition, timing.preRollBeats, bpm) : null;
      this.set({ playing: true });
    } catch (e) {
      this.terminateWorker();
      if (request === this.playRequest) {
        this.batch(() => {
          if (armed) {
            useMidiDiagnostics.getState().fault(String(e));
            this.setArmed(false);
            if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
          }
          this.fail(e);
          if (this.state.playlistPlaying) useSongLibrary.getState().pausePlaylist();
        });
      }
    } finally {
      if (request === this.playRequest) {
        this.playPending = false;
        this.set({ starting: false });
      }
    }
  };

  seek = async (value: number) => {
    if (this.locked) return;
    this.pause();
    await this.state.player?.seek(value);
    setClockPosition(value);
  };

  /** Play, or start the whole playlist when the queue is at its end. */
  startPlayback = () => {
    const library = useSongLibrary.getState();
    const { player, queued } = this.state;
    // A set of one song is still a set: it resumes as the set, so a play counted afterwards records it.
    if (queued && (library.queue.length > 1 || !!library.playingSet)) {
      if (player && player.position >= player.duration) {
        if (library.position === library.queue.length - 1) void library.playPlaylist(library.queue, 0, library.playingSet ?? undefined);
        else {
          library.resumePlaylist();
          void library.advancePlaylist();
        }
        return;
      }
      library.resumePlaylist();
    }
    void this.play();
  };

  skip = (offset: number) => {
    this.batch(() => {
      this.cancelPendingStart();
      this.dropSectionPlan();
      this.dropChained();
      const wasPlaying = this.state.playing;
      this.state.player?.pause();
      this.set({ playing: false });
      this.panic();
      if (wasPlaying) this.sendTriggers("stop");
      void useSongLibrary.getState().skipPlaylist(offset);
    });
  };

  /** The one-time tempo message a start sends, or null when it sends none. Throws when the tempo is out of range. */
  private tempoMessages(armed: boolean, output: MidiOutput | undefined, rate = this.state.player?.playbackRate ?? 1): number[][] | null {
    const { tempoOnStart, tempoChannel, bpm } = this.state;
    if (!armed || !tempoOnStart || output?.state !== "connected") return null;
    // The pedal is sent the tempo the song plays at, so the range is checked on the effective BPM.
    const tempoBpm = effectiveBpm(bpm, rate);
    if (tempoBpm < 40 || tempoBpm > 300) throw new Error("GP-150 / GP-180 one-time tempo supports 40–300 BPM.");
    const tempo = Math.round(tempoBpm),
      status = 0xb0 + tempoChannel - 1;
    return [
      [status, 73, tempo >> 7],
      [status, 74, tempo & 127],
    ];
  }

  /** Crossfades into the next playlist song now. Returns false when no next song is ready, or a join is already planned. */
  crossfadeNext = (): boolean => {
    const { player, queued, playlistPlaying } = this.state;
    const next = useSongLibrary.getState().preparedNext();
    if (!player?.isPlaying || this.chained || !queued || !playlistPlaying || !next) return false;
    // The count-in is the incoming song's: its clicks start at the outgoing song's end.
    const timing = songCountIn(next.settings);
    const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
    const plan = planTransition({
      now: player.audioNow,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
      manual: true,
    });
    if (plan.kind === "gap") return false;
    this.startChain(next, plan, timing);
    return true;
  };

  /** Chains the next playlist song onto this one once its join is close, so the two play on one clock. Checked until it is chained. */
  private planNext(): void {
    const { player, queued, playlistPlaying } = this.state;
    // A song set to stop, or to loop, does not hand over to the next one.
    if (!player?.isPlaying || this.behaviourOf(player) !== "next" || this.chained || !queued || !playlistPlaying) return;
    const library = useSongLibrary.getState();
    // An entry that waits for Play is not chained: it would start on the clock at the join.
    if (library.queueOverrides[library.position + 1]?.autoplay === false) return;
    const next = library.preparedNext();
    if (!next) return;
    const now = player.audioNow;
    const timing = songCountIn(next.settings);
    const countIn = countInBeats(timing.countInBars, timing.beatsPerBar);
    const plan = planTransition({
      now,
      songEnd: player.audioTimeOf(player.duration),
      crossfade: readCrossfade(),
      ready: true,
      countIn: countIn > 0,
    });
    if (plan.kind === "gap" || plan.startAt - now > CHAIN_AHEAD_S) return;
    this.startChain(next, plan, timing);
  }

  /**
   * Counts the playing song as played once it passes its halfway point, with the playlist set it came from. The check runs once a second and
   * does no work once the song is counted, so it stays off the playback path.
   */
  private checkPlayed = (): void => {
    const { player } = this.state;
    const id = this.loadedSongId;
    if (!player || !id || this.playedRecorded || !player.isPlaying || !countsAsPlayed(player.position, player.duration)) return;
    this.playedRecorded = true;
    const library = useSongLibrary.getState();
    library.recordPlay(id, library.playlistPlaying ? (library.playingSet ?? undefined) : undefined);
  };

  /**
   * What the playing song does at its end: the playlist entry's override when it has one, otherwise the song's own. The entry playing
   * is locked, so its override cannot change while it plays.
   */
  private behaviourOf(player: StemPlayer): EndBehaviour {
    const library = useSongLibrary.getState();
    return library.queueOverrides[library.position]?.endBehaviour ?? player.behaviour;
  }

  /** Starts `next` on this song's clock at the join, and arranges the hand-over HANDOVER_LEAD_S before it. `timing` is the next song's. */
  private startChain(next: PreparedSong, plan: Exclude<Transition, { kind: "gap" }>, timing: SongCountIn): void {
    const { player } = this.state;
    if (!player) return;
    // The next song's buffers were built when it was prepared, so the join only starts them.
    const incoming = next.player;
    const unwire = this.wirePlayer(incoming, next.source);
    const countInBeatsNow = plan.kind === "countIn" ? countInBeats(timing.countInBars, timing.beatsPerBar) : 0;
    const lead: Lead = { bpm: timing.bpm, countInBeats: countInBeatsNow, preRollBeats: 0 };
    if (!player.chainNext(incoming, { startAt: plan.startAt, fadeLength: plan.fadeLength, stopAt: plan.stopAt, lead })) {
      unwire();
      return;
    }
    const countInMs = timing.bpm > 0 ? (countInBeatsNow * beatSeconds(timing.bpm) * 1000) / incoming.playbackRate : 0;
    const join = this.clockOf(plan.startAt);
    this.chained = { id: next.id, player: incoming, countInMs, unwire, join };
    // The library holds the chained song, so a queue edit that changes the next song undoes this chain first.
    useSongLibrary.getState().holdChain({ id: next.id, release: () => this.dropChained() });
    // The outgoing song's quarter frames end where the next song joins, and its full frame starts there. The chain is decided several
    // seconds ahead, so no quarter frame past the join is queued yet. Dropping the chain restores them.
    this.scheduler?.endTimecode(join);
    this.clearHandoverTimer();
    this.handoverTimer = setTimeout(this.handOver, Math.max(0, (plan.startAt - HANDOVER_LEAD_S - player.audioNow) * 1000));
  }

  /**
   * Hands the chained song over: the library holds it and moves on, and the view is re-created for the new song. The next session
   * takes the song up in `loadSong`. The song is already playing, so this only moves the playlist and the outgoing song's events on.
   */
  private handOver = (): void => {
    const chained = this.chained;
    const outgoing = this.state.player;
    if (!chained || !outgoing) return;
    this.clearHandoverTimer();
    const library = useSongLibrary.getState();
    if (library.preparedNext()?.id !== chained.id) {
      this.dropChained();
      return;
    }
    outgoing.detachNext();
    this.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.handingOver = chained.id;
    // The outgoing song ends at the join: its end and stop go out before the next song's load and play. The batch holds them until the
    // effects have run, so no clear that follows can drop them.
    this.batch(() => {
      this.sendTriggers("end");
      this.sendTriggers("stop");
    });
    // The outgoing scheduler is torn down with this view, so its quarter frames are carried to the join by the incoming scheduler.
    library.setHandover({ ...chained, timecodeTail: this.outgoingTimecode(chained.join) });

    library.advanceToPrepared(chained.id);
  };

  /** Undoes the chained song, if it has not been taken over: the outgoing song then runs to its own end. */
  private dropChained(): void {
    this.clearHandoverTimer();
    const chained = this.chained;
    if (!chained) return;
    this.chained = null;
    useSongLibrary.getState().holdChain(null);
    this.scheduler?.endTimecode(null);
    // The prepared song stays with the library: it is stopped here, and it can be chained again.
    this.state.player?.cancelChain();
    chained.unwire();
  }

  private clearHandoverTimer(): void {
    if (this.handoverTimer) clearTimeout(this.handoverTimer);
    this.handoverTimer = null;
  }

  /** Stop playback, release the output and disarm. */
  panicAndDisarm = () => {
    this.batch(() => {
      this.pause();
      this.panic();
      this.disarm();
    });
    // After the flush: the carry effect would otherwise store the disarmed state over this reset.
    if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
  };

  /** Enable USB / system MIDI. Always asks for a fresh access, so a port re-enumerated since then is the object sent to. */
  connectMidi = () => this.openMidi();

  /**
   * After sleep the ports from before are stale, so the system's ports are requested again. A warm scheduler worker from before the sleep
   * is dropped too, so Play builds a fresh one.
   */
  private resumeMidi = () => {
    if (this.prepared) {
      this.prepared.cancel();
      this.prepared = null;
    }
    if (this.state.access) void this.openMidi();
  };

  private async openMidi(): Promise<void> {
    // Read before the request: the armed output is compared with the new one once access is replaced.
    const wasArmed = !!this.state.armedOutput;
    this.set({ midiStatus: "Opening USB / system MIDI…" });
    try {
      const next = await navigator.requestMIDIAccess({ sysex: true });
      const connectedOutputs = [...next.outputs.values()].filter((p) => p.state === "connected");
      const { portId } = this.state;
      const remembered = portId !== BLUETOOTH_PORT_ID && next.outputs.get(portId)?.state === "connected";
      if (portId !== BLUETOOTH_PORT_ID) this.portLost = !remembered;
      let midiStatus = connectedOutputs.length
        ? `USB / system MIDI ready: ${connectedOutputs.map((p) => p.name || p.id).join(", ")}. Select an output and enable Send cues.`
        : "USB / system MIDI is enabled, but no outputs are available. Connect the pedal and close other MIDI apps, then try again.";
      if (wasArmed && remembered) midiStatus = RECONNECTED_STATUS;
      else if (wasArmed) useMidiDiagnostics.getState().fault("System MIDI output disconnected. Cues disarmed.");
      this.batch(() => {
        this.set({ access: next, midiStatus });
        if (remembered && this.armRemembered()) this.set({ midiStatus: REARMED_STATUS });
      });
    } catch (e) {
      this.set({ midiStatus: "USB / system MIDI could not be opened." });
      this.fail(e);
    }
  }

  // ---- sections ------------------------------------------------------------------------------------------------

  private lookahead(): number {
    return this.state.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD;
  }

  /** The MIDI clock time at which the audio clock reads `ctx`. Both clocks are in step while playing. */
  private clockOf(ctx: number): number {
    return midiNow() + (ctx - (this.state.player?.audioNow ?? 0)) * 1000;
  }

  /** The sections as they fall inside the part of the audio that plays: a trim cuts them. */
  private get playableSections(): Section[] {
    const { player, sections } = this.state;
    if (!player) return sections;
    const { start, duration } = player;
    // The same array while nothing changes, so a decision made on it is still recognised as current.
    const cached = this.clampedSections;
    if (cached && cached.source === sections && cached.start === start && cached.end === duration) return cached.value;
    const value = clampSections(sections, { start, end: duration });
    this.clampedSections = { source: sections, start, end: duration, value };
    return value;
  }

  /** Tells the scheduler the waiting plan. Called on each decision, and when a scheduler starts while a plan waits. */
  private sendPlan(): void {
    const schedule = this.section?.schedule ?? this.renderSchedule();
    // Without sections there is never a plan to send or to clear, so the scheduler is not touched.
    if (!schedule && !this.planSent) return;
    this.planSent = schedule !== null;
    this.scheduler?.plan(schedule?.cap ?? null, schedule?.jump ?? null);
  }

  /** The MIDI plan of a render swap: cues are held after its song time, and the schedule takes the new rate at its audio time. */
  private renderSchedule(): { cap: number; jump: SchedulerJump | null } | null {
    const swap = this.renderSwap;
    if (!swap) return null;
    return { cap: swap.at, jump: { at: this.clockOf(swap.ctxAt), position: swap.at, rate: swap.rate, keepsPosition: true } };
  }

  /** Takes a boundary decided by the planner: the audio jump is scheduled now, the MIDI schedule is held up to it. */
  private commitBoundary(boundary: SectionBoundary): void {
    const { player, sectionLive } = this.state;
    const sections = this.playableSections;
    if (!player || this.renderSwap) return;
    const { action } = boundary;
    if (action.kind === "jump") {
      const ctxAt = player.prepareJump(action.to, boundary.at);
      if (ctxAt === null) return;
      this.section = {
        kind: "jump",
        ctxAt,
        before: sectionLive,
        sections,
        schedule: { cap: boundary.at, jump: { at: this.clockOf(ctxAt), position: action.to } },
      };
    } else {
      this.section = {
        kind: action.kind,
        ctxAt: player.audioTimeOf(boundary.at),
        before: sectionLive,
        sections,
        schedule: action.kind === "pause" ? { cap: boundary.at, jump: null } : null,
      };
    }
    this.sendPlan();
    this.set({
      sectionLive: boundary.live,
      sectionNext: action.kind === "continue" ? null : { kind: action.kind, target: action.kind === "jump" ? action.target : null, at: boundary.at },
    });
  }

  /**
   * Puts back the decision that has not taken effect yet, and the live state it was made from. Returns false when a jump is already
   * too close to take effect to undo, and the jump then stands.
   */
  private cancelSectionPlan(): boolean {
    const plan = this.section;
    if (!plan) return true;
    if (plan.kind === "jump" && !this.state.player?.cancelJump()) return false;
    this.section = null;
    this.sendPlan();
    this.set({ sectionLive: plan.before, sectionNext: null });
    return true;
  }

  /** Forgets a decision because playback stopped. Any jump was dropped by the player, and the live state goes back to what it was. */
  private dropSectionPlan(): void {
    const plan = this.section;
    if (!plan) return;
    this.section = null;
    this.set({ sectionLive: plan.before, sectionNext: null });
  }

  /** Every 50 ms while playing: carries out a decision once its boundary has passed, and decides the next boundary when it is close. */
  private tickSections = (): void => {
    const { player, playing } = this.state;
    const sections = this.playableSections;
    if (!player || !playing) return;
    try {
      this.tickRender(player);
      if (this.renderSwap) return;
      const plan = this.section;
      if (plan) {
        if (plan.sections !== sections) {
          this.cancelSectionPlan();
          return;
        }
        if (player.audioNow < plan.ctxAt) return;
        this.section = null;
        this.set({ sectionNext: null });
        if (plan.kind === "pause") this.pause();
        return;
      }
      if (!sections.length || player.position < 0) return;
      const boundary = nextBoundary(sections, player.position, this.state.sectionLive);
      if (boundary && boundary.at - player.position <= DECISION_LEAD_S) this.commitBoundary(boundary);
    } catch (e) {
      this.cancelSectionPlan();
      this.fail(e);
    }
  };

  /**
   * Carries a render through while the song plays: a built render is swapped in at the next beat, once no section jump is waiting,
   * and the swap is cleared when its audio time passes. Sections wait for a swap to land.
   */
  private tickRender(player: StemPlayer): void {
    const swap = this.renderSwap;
    if (swap) {
      if (player.audioNow >= swap.ctxAt) {
        this.renderSwap = null;
        this.sendPlan();
      }
      return;
    }
    if (!this.pendingRender || this.section) return;
    const started = player.swapRender(this.pendingRender, RENDER_SWAP_LEAD_S);
    if (!started) return;
    this.renderSwap = { at: started.at, ctxAt: started.when, rate: this.pendingRender.rate };
    this.pendingRender = null;
    this.sendPlan();
  }

  /** Applies a render that is waiting for a beat, now. Used when the song stops, because a stopped song has no beat to wait for. */
  private applyPendingRender(): void {
    const render = this.pendingRender;
    const player = this.state.player;
    if (!render || !player) return;
    this.pendingRender = null;
    player.applyRender(render);
  }

  /**
   * Sets the song's speed and pitch. The render is built in the background; the newest request wins. A built render is swapped in at
   * the next beat while the song plays, and applied at once while it is stopped.
   */
  setSpeed = (requested: Partial<SpeedSettings>): void => {
    const speed = clampSpeed({ ...this.state.speed, ...requested });
    if (JSON.stringify(speed) === JSON.stringify(this.state.speed)) return;
    this.set({ speed });
    try {
      const key = this.songSettingsKey;
      const options = parseOptions(getSetting(key, ":options"));
      setSetting(key, ":options", JSON.stringify({ ...options, ...speedOptions(speed) }));
    } catch (e) {
      this.fail(e);
    }
    void this.renderSpeed(speed);
  };

  /** Builds the render for `speed` from the stems at 100%, and hands it to the player. Stale results are dropped. */
  private async renderSpeed(speed: SpeedSettings): Promise<void> {
    const base = this.baseStems;
    const player = this.state.player;
    if (!base || !player) return;
    const request = ++this.renderRequest;
    this.set({ rendering: null });
    try {
      const stems = await this.renders.render(base, speed, (done, total) => {
        if (request === this.renderRequest) this.set({ rendering: { done, total } });
      });
      if (!stems || request !== this.renderRequest || this.state.player !== player) return;
      const render = await player.renderBuffers(stems, speed.rate);
      if (request !== this.renderRequest || this.state.player !== player) return;
      this.pendingRender = render;
      if (!player.isPlaying) this.applyPendingRender();
      this.set({ rendering: null });
    } catch (e) {
      if (request === this.renderRequest) {
        this.set({ rendering: null });
        this.fail(e);
      }
    }
  }

  /** A tap arms a jump to the section for the next boundary. While stopped it moves the playhead to the section's start instead. */
  tapSection = (id: string) => {
    const section = this.playableSections.find((s) => s.id === id);
    if (!section) return;
    if (!this.state.playing) {
      void this.state.player?.seek(section.start);
      setClockPosition(section.start);
      return;
    }
    this.cancelSectionPlan();
    this.set({ sectionLive: armJump(this.state.sectionLive, id) });
  };

  /** A second tap on the armed section: jumps now, after the MIDI lookahead, so queued cues still belong to the passage being left. */
  jumpSectionNow = (id: string) => {
    const { player, playing } = this.state;
    if (!player || !playing) {
      this.tapSection(id);
      return;
    }
    this.cancelSectionPlan();
    const boundary = immediateJump(this.playableSections, player.position + this.lookahead(), this.state.sectionLive, id);
    if (boundary) this.commitBoundary(boundary);
  };

  /** Loops a section until it is released; tapping the looping section releases it. */
  toggleSectionLoop = (id: string) => {
    this.cancelSectionPlan();
    const live = this.state.sectionLive;
    this.set({ sectionLive: live.loop === id ? releaseLoop(live, id) : startLoop(live, id) });
  };

  /** Releases the loop of the section being played, whether it was started live or is the section's own mode. */
  releaseSectionLoop = () => {
    const { player } = this.state;
    const ordered = sortedSections(this.playableSections);
    const current = player ? ordered[sectionIndexAt(ordered, player.position)] : undefined;
    if (!current) return;
    this.cancelSectionPlan();
    this.set({ sectionLive: releaseLoop(this.state.sectionLive, current.id) });
  };

  /** Cancels the armed jump. A decision already made for it is put back too, where that is still possible. */
  cancelSectionJump = () => {
    this.cancelSectionPlan();
    this.set({ sectionLive: cancelJump(this.state.sectionLive) });
  };

  // ---- remote control ------------------------------------------------------------------------------------------

  /** Supplies the performance screen's view actions (stage, click, mixer, tap, lyrics). Called again whenever they change. */
  setView(view: ViewHost): void {
    this.view = view;
  }

  /** Every key press from the window. Returns true when Learn or a binding took it; a key in a text field is never taken. */
  keyDown = (e: KeyboardEvent): boolean => {
    if (e.defaultPrevented || isTypingTarget(e.target) || dialogOpen()) return false;
    const learn = useRemoteLearn.getState().target;
    if (learn?.source === "key") {
      if (!e.repeat) this.learnKey(e, learn);
      e.preventDefault();
      return true;
    }
    // While a MIDI message is being learned, a key does nothing: learning must not run what it is about to bind.
    if (learn) return false;
    // Key repeat and modified keys are not bindings: holding PageDown must not run the section jump again and again.
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
    const routes = this.remote.key(e.key, this.state.bindings).filter((route) => this.shown || runsWhileHidden(route.binding.action));
    if (!routes.length) return false;
    e.preventDefault();
    this.runRoutes(routes);
    return true;
  };

  /** One message from the selected input: learned while Learn is open, otherwise it runs the bindings or selects a song. */
  private receiveMidi = (data: Uint8Array): void => {
    const learn = useRemoteLearn.getState().target;
    if (learn?.source === "song") this.learnSong(data, learn.songId);
    else if (learn?.source === "midi") this.learnFromMidi(data, learn);
    // While a key is being learned, a pedal message does nothing, for the same reason as a key during MIDI Learn.
    else if (!learn) this.runInput(data);
  };

  /** One message that no Learn is taking: a binding that claims it runs; otherwise a song trigger may select a song. Never throws. */
  private runInput(data: Uint8Array): void {
    try {
      const { routes, song } = this.remote.receive(data, this.state.bindings, (event, bank) => this.songSelectedBy(event, bank));
      this.runRoutes(routes);
      if (song) this.loadSongFromMidi(song);
    } catch (e) {
      this.fail(e);
    }
  }

  /** The song a message selects, when song triggers are switched on. Only a program change or Song Select can select one. */
  private songSelectedBy(event: MidiEvent, bank: BankTracker): SongHit<SongEntry> | null {
    const { listen, scope } = useMidiConfiguration.getState().songTriggers;
    if (!listen || (event.status !== 0xc0 && event.status !== 0xf3)) return null;
    const library = useSongLibrary.getState();
    const song = songForEvent(songsInScope(songEntries(library.index.songs), library.queue, scope), event, bank);
    return song ? { key: song.id, value: song } : null;
  }

  /**
   * Loads the song a trigger selected. A song that is already loaded is left alone. While a song plays, the trigger follows its
   * while-playing option: ignored (the default), armed as next in the set, or used to stop and load the song now. A song in the set
   * moves the set to it. A song outside the set loads on its own and pauses the set, with a notice. Autoplay starts the loaded song.
   */
  private loadSongFromMidi(song: SongEntry): void {
    if (song.id === this.loadedSongId) return;
    const library = useSongLibrary.getState();
    const { whilePlaying, autoplay } = useMidiConfiguration.getState().songTriggers;
    if (library.busy) {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "A song is still loading." });
      return;
    }
    const playing = this.state.playing || this.playPending;
    if (playing && whilePlaying === "ignore") {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "Stop the song to load it, or change the song trigger option while playing." });
      return;
    }
    if (playing && whilePlaying === "next") {
      this.armNextFromMidi(song);
      return;
    }
    // Read before a stop pauses the set, so the notice can say the set was left.
    const wasInSet = library.playlistPlaying;
    if (playing) this.pause();
    if (autoplay) library.requestAutoplay(song.id);
    const at = library.queue.indexOf(song.id);
    const loading = at >= 0 ? library.skipPlaylist(at - library.position) : library.load(song.id);
    void Promise.resolve(loading)
      .then(() => {
        if (wasInSet && at < 0) useSongLibrary.setState({ notice: `${song.title} loaded by MIDI. The playlist is paused.` });
      })
      .catch((e) => this.fail(e));
  }

  /** Arms a song as next in the playing set. A chained song is undone first, so the one armed here is the one that plays at the join. */
  private armNextFromMidi(song: SongEntry): void {
    if (!this.state.queued) {
      showToast({ tone: "info", title: `${song.title} was not loaded`, body: "Arm as next needs a playlist. Stop the song to load it." });
      return;
    }
    this.dropChained();
    const hint = useSongLibrary.getState().armNext(song.id);
    showToast(hint ? { tone: "info", title: hint } : { tone: "info", title: `${song.title} plays next` });
  }

  /** One message while a song's trigger is being learned: a program change (with its bank) or Song Select is saved for that song. */
  private learnSong(data: Uint8Array, songId: string): void {
    const event = this.remote.readInput(data);
    if (!event) return;
    const step = songLearnStep(event, this.remote.bank);
    useRemoteLearn.setState({ seen: step.seen });
    if (step.kind !== "match") return;
    try {
      useSongLibrary.getState().setSongTrigger(songId, step.trigger);
      const songs = songEntries(useSongLibrary.getState().index.songs);
      const title = songs.find((song) => song.id === songId)?.title ?? "The song";
      const notes = [`${title} loads on ${describeTrigger(step.trigger)}.`];
      const clashes = triggerClashes(songs, songId);
      if (clashes.length) notes.push(`Same trigger as ${clashes.map((song) => song.title).join(", ")}; the first in the library loads.`);
      const bound = bindingClaiming(step.trigger, this.state.bindings);
      if (bound) notes.push(`${describeBinding(bound)} already runs an action, so the song will not load.`);
      stopLearn(notes.join(" "));
    } catch (e) {
      stopLearn(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * A transport action a band follower asked for (spec 44). Anything that is not one of the follower actions is ignored. A stop needs a
   * second press, as a double-press binding does, so the performer sees "press again" before the song stops.
   */
  runFollowerAction(action: string): void {
    if (!isFollowerAction(action)) return;
    const step = this.followerGate.take(action as FollowerAction);
    if (step.kind === "armed") {
      showToast({ tone: "info", title: "A bandmate asked to stop", body: "Press stop again within 0.6 s to stop the song." });
      return;
    }
    showToast({ tone: "info", title: `A bandmate asked: ${actionLabel(step.action)}` });
    const hint = runAction({ action: step.action }, this.actionHost());
    if (hint) showToast({ tone: "info", title: hint });
  }

  /** Runs what the bindings matched. A first press of a double press says so, so the performer knows it is waiting for the second. */
  private runRoutes(routes: Route[]): void {
    for (const route of routes) {
      const label = actionLabel(route.binding.action, route.binding.index);
      if (route.kind === "armed") {
        showToast({ tone: "info", title: `Press again to ${label}`, body: "The second press must come within 0.6 s." });
        continue;
      }
      const hint = runAction(route.binding, this.actionHost());
      if (hint) showToast({ tone: "info", title: hint });
    }
  }

  private actionHost(): ActionHost {
    return { ...this.sessionActions, ...this.view };
  }

  private learnFromMidi(data: Uint8Array, target: ActionLearnTarget): void {
    const step: LearnStep | null = this.remote.learnMidi(data);
    if (!step) return;
    useRemoteLearn.setState({ seen: step.seen });
    if (step.kind === "match") this.capture({ ...this.learnedBase(target), source: "midi", match: step.match });
  }

  private learnKey(e: KeyboardEvent, target: ActionLearnTarget): void {
    if (e.key === "Escape") {
      stopLearn("Learn cancelled.");
      return;
    }
    if (isModifierKey(e.key)) {
      useRemoteLearn.setState({ seen: "Press a key, not a modifier." });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      useRemoteLearn.setState({ seen: MODIFIER_HINT });
      return;
    }
    const key = normaliseKey(e.key);
    useRemoteLearn.setState({ seen: `Key ${key}` });
    this.capture({ ...this.learnedBase(target), source: "key", match: { key } });
  }

  private learnedBase(target: ActionLearnTarget): { action: ActionLearnTarget["action"]; index?: number } {
    return target.index === undefined ? { action: target.action } : { action: target.action, index: target.index };
  }

  /** Binds what Learn captured, unless a binding already responds to the same input: the clash is named instead. */
  private capture(binding: Binding): void {
    const clash = findConflict(this.state.bindings, binding);
    if (clash >= 0) {
      stopLearn(`Already bound to ${describeBinding(this.state.bindings[clash])}. Remove that binding first.`);
      return;
    }
    const bindings = [...this.state.bindings, binding];
    this.set({ bindings });
    useMidiConfiguration.getState().update({ bindings });
    stopLearn(`Bound ${describeBinding(binding)}.`);
  }

  /** The playable sections in song order, and the index of the one the playhead is in (-1 when none). */
  sectionOrder(): { ids: string[]; current: number } {
    const ordered = sortedSections(this.playableSections);
    const player = this.state.player;
    return { ids: ordered.map((s) => s.id), current: player ? sectionIndexAt(ordered, player.position) : -1 };
  }

  private stepSection(step: 1 | -1): Hint {
    const { ids, current } = this.sectionOrder();
    if (!ids.length) return "This song has no sections.";
    const target = current + step;
    if (target < 0) return "Already at the first section.";
    if (target >= ids.length) return "Already at the last section.";
    this.tapSection(ids[target]);
  }

  private sectionAt(n: number, run: (id: string) => void): Hint {
    const { ids } = this.sectionOrder();
    if (!ids.length) return "This song has no sections.";
    if (n > ids.length) return `This song has ${ids.length} sections.`;
    run(ids[n - 1]);
  }

  /** Moves the playlist by `offset` songs. Outside a playlist, or past its ends, there is a hint instead. */
  private skipSong(offset: number): Hint {
    if (!this.state.queued) return "Songs change only in a playlist.";
    if (offset === 0) return;
    const library = useSongLibrary.getState(),
      target = library.position + offset;
    if (target < 0) return "This is the first song in the playlist.";
    if (target >= library.queue.length) return "This is the last song in the playlist.";
    this.skip(offset);
  }

  private selectSong(n: number): Hint {
    if (!this.state.queued) return "Songs change only in a playlist.";
    const library = useSongLibrary.getState();
    if (n > library.queue.length) return `The playlist has ${library.queue.length} songs.`;
    return this.skipSong(n - 1 - library.position);
  }

  // ---- effects -------------------------------------------------------------------------------------------------

  private createEffects(): Effect[] {
    const armedOf = (s: SessionState) => selectArmed(s);
    return [
      // A song a MIDI trigger loaded starts once its player is ready and the library is no longer loading.
      {
        deps: (s) => [s.player, s.busy],
        run: (s) => {
          if (!this.autoplayPending || !s.player || s.busy) return;
          this.autoplayPending = false;
          void this.play();
        },
      },
      // A playlist song starts itself once it is the current one and nothing is loading, unless its entry asks to wait for Play.
      {
        deps: (s) => [s.player, s.queued, s.playlistPlaying, s.busy],
        run: (s) => {
          if (!s.queued || !s.playlistPlaying || s.busy || !s.player) return;
          if (useSongLibrary.getState().queueOverrides[useSongLibrary.getState().position]?.autoplay === false) return;
          if (s.parseError) {
            this.fail(s.parseError);
            useSongLibrary.getState().pausePlaylist();
            return;
          }
          void this.play();
        },
      },
      // Chains the next playlist song onto this one once its join is close, so that the two play on one clock.
      {
        deps: (s) => [s.player, s.playing, s.queued, s.playlistPlaying],
        run: (s) => {
          if (!s.playing || !s.player || !s.queued || !s.playlistPlaying) return;
          const timer = setInterval(() => this.planNext(), CHAIN_CHECK_MS);
          return () => clearInterval(timer);
        },
      },
      // Stopping the playlist from elsewhere stops this song.
      {
        deps: (s) => [s.playlistPlaying],
        run: (s) => {
          if (!s.playlistPlaying && s.player?.isPlaying && s.queued) {
            this.cancelPendingStart();
            this.dropSectionPlan();
            this.dropChained();
            s.player.pause();
            this.set({ playing: false });
            this.panic();
            this.sendTriggers("stop");
          }
        },
      },
      // Carry the MIDI to the next song: the access, output and input to any song loaded next, and arming only while a playlist plays,
      // so a stopped playlist cannot leave an armed flag that re-arms a later join.
      {
        deps: (s) => [s.queued, s.playlistPlaying, s.busy, s.access, s.portId, s.inputId, armedOf(s), selectOutput(s)],
        run: (s) => {
          if (s.busy) return;
          useSongLibrary
            .getState()
            .rememberMidi({ access: s.access, portId: s.portId, inputId: s.inputId, armed: armedOf(s) && s.playlistPlaying, output: selectOutput(s) });
        },
      },
      // Transport lifecycle is separate from tempo-dependent scheduling.
      {
        deps: (s) => [s.playing, armedOf(s), selectOutput(s), s.clock],
        run: (s) => {
          if (!s.playing) return;
          const context = this.context();
          // A song that joins a set already running sends no Start: the set's Start went out with its first song.
          const joined = this.joining;
          this.joining = false;
          // A delayed start sends its Start or Continue when the audio begins, after the chase.
          const at = this.transportAt;
          this.transportAt = null;
          if (context.armed && s.clock && !s.timecode.enabled && !joined) {
            try {
              this.stoppedOn = undefined;
              this.sendPerformance([(s.player?.position ?? 0) < 0.05 ? 250 : 251], at === null ? undefined : at - performance.timeOrigin);
            } catch (e) {
              this.fail(e);
              this.setArmed(false);
            }
          }
          // A song handed over stays on the set's transport, so leaving this session does not stop it.
          return () => {
            if (!this.passing) this.panic(this.endingIntoSet ? { ...context, clock: false } : context);
          };
        },
      },
      // Warm the scheduler worker while armed and stopped, so Play does not wait for it.
      {
        deps: (s) => [armedOf(s), s.playing, s.player, selectOutput(s)],
        run: (s) => {
          if (!armedOf(s) || s.playing || !s.player) return;
          try {
            const warm = this.prepared ?? prepareMidiScheduler();
            this.prepared = warm;
            return () => {
              if (this.prepared === warm) {
                warm.cancel();
                this.prepared = null;
              }
            };
          } catch (e) {
            useMidiDiagnostics.getState().fault(String(e));
            this.setArmed(false);
            this.fail(e);
          }
        },
      },
      // Mirror the audio position into the display clock.
      {
        deps: (s) => [s.playing, s.player],
        run: (s) => {
          const player = s.player;
          if (!s.playing || !player) return;
          return startPlaybackClock(() => player.position);
        },
      },
      // Section boundaries: decided ahead and carried out on the audio clock while the song plays.
      {
        deps: (s) => [s.playing, s.player],
        run: (s) => {
          if (!s.playing || !s.player) return;
          const timer = setInterval(this.tickSections, 50);
          return () => clearInterval(timer);
        },
      },
      // A song's load triggers go out when it is loaded while armed, and again each time the session arms for it.
      {
        deps: (s) => [armedOf(s), s.player],
        run: (s) => {
          if (!armedOf(s) || !s.player) {
            this.loadedPlayer = null;
            return;
          }
          if (this.loadedPlayer === s.player) return;
          this.loadedPlayer = s.player;
          this.sendTriggers("load", s.cues);
        },
      },
      // The MIDI scheduler itself.
      {
        deps: (s) => [s.playing, s.player, armedOf(s), selectOutput(s), s.clock, s.bpm, this.playCues(s), s.timecode],
        run: (s) => this.runScheduler(s),
      },
      // A USB output that goes away disarms the session. The same port id re-enumerated as a new object is the same device:
      // it disarms without a fault, since the cues were never sent to the new object.
      {
        deps: (s) => [s.access, s.portId, s.armedOutput],
        run: (s) => {
          const access = s.access;
          if (!access) return;
          const update = () => {
            const { portId, armedOutput } = this.state;
            this.set({ portsVersion: this.state.portsVersion + 1 });
            if (portId === BLUETOOTH_PORT_ID) return;
            const current = access.outputs.get(portId);
            if (!armedOutput) {
              // The remembered port is back: take it up again, so Enable and arming work from the new object. Opening arms it too
              // when Send cues is on for it. A port that goes away while Send cues is on is marked lost even if a fault had disarmed it.
              if (current?.state !== "connected" && this.rememberedFor(portId)) this.portLost = true;
              if (this.portLost && current?.state === "connected") void this.openMidi();
              return;
            }
            if (current === armedOutput && current.state === "connected") return;
            if (current?.state === "connected") {
              this.setArmed(false);
              this.set({ midiStatus: this.armRemembered() ? REARMED_STATUS : RECONNECTED_STATUS });
              return;
            }
            useMidiDiagnostics.getState().fault("System MIDI output disconnected. Cues disarmed.");
            this.portLost = true;
            this.setArmed(false);
          };
          access.addEventListener("statechange", update);
          return () => access.removeEventListener("statechange", update);
        },
      },
      // Restore remembered ports when they appear.
      {
        deps: (s) => [s.access, s.portsVersion],
        run: (s) => {
          const access = s.access;
          if (!access) return;
          if (!access.outputs.get(s.portId) && s.savedOutput?.transport === "system") {
            const saved = rememberedPort([...access.outputs.values()], s.savedOutput);
            if (saved) this.setPortId(saved.id);
          }
          if (!s.inputId && s.savedInput?.transport === "system") {
            const saved = rememberedPort([...access.inputs.values()], s.savedInput);
            if (saved) this.setInputId(saved.id);
          }
        },
      },
      // A replaced or lost Bluetooth connection disarms. This runs before the generic check below so the fault is reported.
      {
        deps: (s) => [s.bluetooth, s.portId, s.armedOutput],
        run: (s) => {
          if (this.previousBluetooth !== s.bluetooth && s.portId === BLUETOOTH_PORT_ID) {
            if (s.armedOutput && s.armedOutput === this.previousBluetooth)
              useMidiDiagnostics.getState().fault("Bluetooth output disconnected or replaced. Cues disarmed.");
            this.setArmed(false);
            // A new Bluetooth connection for the remembered output is the same pedal coming back.
            if (this.armRemembered()) this.set({ midiStatus: REARMED_STATUS });
          }
          this.previousBluetooth = s.bluetooth;
        },
      },
      // Arming never survives a change of output object.
      {
        deps: (s) => [s.armedOutput, selectOutput(s)],
        run: (s) => {
          if (s.armedOutput && s.armedOutput !== selectOutput(s)) this.setArmed(false);
        },
      },
      // Remote input: the selected input's messages run the bindings, or are learned while Learn is open.
      {
        deps: (s) => [s.access, s.inputId, s.bluetooth],
        run: (s) => {
          if (s.inputId === BLUETOOTH_PORT_ID) return s.bluetooth?.subscribe(this.receiveMidi);
          const input = s.access?.inputs.get(s.inputId);
          if (!input) return;
          const handler = (e: MIDIMessageEvent) => {
            if (e.data) this.receiveMidi(e.data);
          };
          input.addEventListener("midimessage", handler);
          return () => input.removeEventListener("midimessage", handler);
        },
      },
    ];
  }

  /** The trigger controllers of every configured pedal, which a chase never replays (see midi-chase.ts). */
  private chaseTriggers(): TriggerCc[] {
    return configuredPedals(usePedalLibrary.getState()).flatMap((pedal) => pedal.triggers);
  }

  private runScheduler(s: SessionState): void | (() => void) {
    const player = s.player;
    if (!s.playing || !player) return;
    const output = selectOutput(s);
    if (!this.armed || output?.state !== "connected") {
      // Armed, but the port went away: a silent stop would look like cues that never sounded.
      if (s.armedOutput && portIsDead(output)) this.deadOutput("MIDI output is no longer connected. Cues disarmed.");
      this.startPosition = null;
      this.startTempo = null;
      this.startPlay = null;
      this.terminateWorker();
      return;
    }
    const context = this.context();
    const fault = (message: string) => {
      useMidiDiagnostics.getState().fault(message);
      this.batch(() => {
        this.panic(context);
        this.setArmed(false);
        this.fail(message);
        if (this.state.queued) useSongLibrary.getState().rememberMidi(null);
      });
    };
    this.set({ lateNotice: null });
    try {
      const position = player.position;
      // Select opening cues from the requested offset, not a later render.
      // Keep the live audio clock as the origin so overdue starts still fault.
      const cuePosition = this.startPosition ?? position;
      this.startPosition = null;
      const rate = player.playbackRate;
      const origin = midiNow() - (position * 1000) / rate;
      const playTriggers = this.startPlay ?? [];
      this.startPlay = null;
      // Timecode replaces app clock: a receiver gets one source of time. The offset is checked here as well as at Play.
      const offset = timecodeOffsetFrames(s.timecode);
      const timecodeTail = this.incomingTail;
      this.incomingTail = null;
      const handle = startMidiScheduler(
        {
          cues: this.playCues(s),
          position: cuePosition,
          duration: player.duration,
          origin,
          // The start tempo and play trigger are due at the start of the count-in: the start position's clock time less the count-in. Song position
          // zero is not that time when starting mid-song, so the message would be older than STALE_MS and dropped.
          tempoAt: origin + (cuePosition * 1000) / rate - this.countInMs,
          bpm: s.bpm,
          rate,
          clock: s.clock && offset === null,
          timecode: offset === null ? undefined : { fps: s.timecode.fps, offset },
          timecodeTail: timecodeTail ?? undefined,
          tempo: this.startTempo,
          playTriggers,
          lookahead: s.portId === BLUETOOTH_PORT_ID ? BLUETOOTH_LOOKAHEAD : SYSTEM_LOOKAHEAD,
          pedalChannel: s.tempoChannel,
          chaseTriggers: this.chaseTriggers(),
        },
        (message) => {
          // A replaced output object (same port id) is never sent to; the statechange handler disarms.
          if (this.output !== output) return;
          this.sendPerformance(message.bytes, message.due - performance.timeOrigin, message.label);
        },
        fault,
        this.readyWorker ?? undefined,
        this.degraded,
      );
      this.readyWorker = null;
      this.startTempo = null;
      this.scheduler = handle;
      this.sendPlan();
      // Audio position is a checkpoint, not the scheduling clock. A missing or
      // frozen checkpoint makes the worker stop producing new batches.
      const timer = setInterval(() => handle.sync(player.position), 50);
      return () => {
        clearInterval(timer);
        handle.stop();
        if (this.scheduler === handle) this.scheduler = null;
      };
    } catch (e) {
      fault(e instanceof Error ? e.message : String(e));
    }
  }
}

/** Subscribes a component to the session state. */
export function useSession<T>(session: PerformanceSession, select: (state: SessionState) => T): T {
  return useStore(session.store, select);
}
