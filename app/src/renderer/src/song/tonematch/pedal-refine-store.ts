// Refine on the pedal: play the proposal on the pedal, record a take of the player through its USB audio, compare it with
// the song's guitar and correct the amp's Gain and the Guitar EQ (pedal-refine.ts), take after take. The input stays open
// between takes. Every change goes through the device store's live edits, so it plays at once and shows on the Rig;
// nothing is written to a slot. Mirrors ir-store.ts for the recording.
import { create } from "zustand";
import { profileFor } from "@shared/devices";
import { useDevice } from "@/state/device";
import { pedalName } from "@/state/device-model";
import { isSessionLive as irLive, MIN_PLAYING_S, useIrMatch } from "./ir-store";
import { LTAS_FRAME, ltas } from "./ltas";
import { bestRound, isDone, measure, nextKnobs, type Knobs, type Round } from "./pedal-refine";
import { EQ_BAND_NAMES, STEPS_PER_DB, withTunedOnPedal } from "./proposal";
import { InputRecorder, isPedalInput, listInputs, type AudioInput, type Level } from "./recorder";
import { useToneMatch } from "./store";

/** One take, in seconds of recording. */
export const TAKE_S = 15;
const TICK_MS = 200;

export type RefineStep =
  | { kind: "idle" }
  | { kind: "opening" }
  /** Waiting for the player: `take` is the number of the next take (1-based) */
  | { kind: "ready"; take: number }
  | { kind: "recording"; take: number }
  | { kind: "done"; best: Round; start: Round; takes: number }
  | { kind: "error"; message: string };

export const isRefineLive = (s: RefineStep) => s.kind === "opening" || s.kind === "ready" || s.kind === "recording";

export interface PedalRefineState {
  step: RefineStep;
  history: Round[];
  inputs: AudioInput[];
  inputId: string | null;
  level: Level | null;
  seconds: number;
  /** A take that didn't count (too little playing) says why, and the take is asked for again */
  notice: string | null;
  open(): Promise<void>;
  selectInput(deviceId: string): Promise<void>;
  record(): void;
  /** Stop the take (also called after TAKE_S), measure it and set up the next one or finish */
  finishTake(): Promise<void>;
  /** End the session with the best take so far */
  finishNow(): void;
  /** Stop and close the input; the pedal stays as it is */
  cancel(): Promise<void>;
  /** Put the best knobs in the proposal */
  keep(): void;
}

let recorder: InputRecorder | null = null;
let ticker: number | undefined;

const message = (e: unknown) => {
  if (!(e instanceof Error)) return String(e);
  if (e.name === "NotAllowedError" || e.name === "SecurityError") return "Recording needs permission to use your audio input.";
  if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "That audio input isn't available any more. Pick another one.";
  return e.message;
};

/** The amp's Gain and the Guitar EQ bands in the live preset, by name (the proposal's models). */
function pedalTarget() {
  const d = useDevice.getState();
  const p = d.preset;
  if (d.status !== "connected" || !p) throw new Error(`Connect the ${pedalName(d.device)} first: the takes go through it.`);
  const blocks = profileFor(p.device).blocks;
  const amp = blocks.indexOf("AMP");
  const eq = blocks.indexOf("EQ");
  const gain = p.blocks[amp]?.model?.params.find((x) => x.name === "Gain")?.index;
  const bands = EQ_BAND_NAMES.map((n) => p.blocks[eq]?.model?.params.find((x) => x.name === n)?.index);
  if (gain === undefined || bands.some((b) => b === undefined)) throw new Error("The preset needs the proposed amp and the Guitar EQ. Audition the proposal first.");
  return { amp, eq, gain, bands: bands as number[] };
}

/** The knobs as they are on the pedal now. */
function readKnobs(): Knobs {
  const t = pedalTarget();
  const p = useDevice.getState().preset!;
  return { gain: p.blocks[t.amp].params[t.gain], eqDb: t.bands.map((i) => p.blocks[t.eq].params[i] / STEPS_PER_DB) };
}

/** Play `k` on the pedal (live edits; the EQ is switched on, since the refinement works through it). */
function applyKnobs(k: Knobs) {
  const t = pedalTarget();
  const d = useDevice.getState();
  if (!d.preset!.blocks[t.eq].enabled) d.setBlockEnabled(t.eq, true);
  d.setParam(t.amp, t.gain, k.gain);
  t.bands.forEach((index, i) => d.setParam(t.eq, index, Math.max(-50, Math.min(50, Math.round(k.eqDb[i] * STEPS_PER_DB)))));
}

async function closeRecorder() {
  window.clearInterval(ticker);
  ticker = undefined;
  const r = recorder;
  recorder = null;
  await r?.close().catch(() => {});
}

export const usePedalRefine = create<PedalRefineState>((set, get) => {
  let attempt = 0;
  const openInput = async (deviceId: string | null, id: number) => {
    await closeRecorder();
    const r = await InputRecorder.open(deviceId, (level) => set({ level }));
    if (id !== attempt) {
      await r.close().catch(() => {});
      return false;
    }
    recorder = r;
    return true;
  };
  const fail = async (e: unknown) => {
    await closeRecorder();
    set({ step: { kind: "error", message: message(e) } });
  };
  const finish = () => {
    const { history } = get();
    const best = bestRound(history);
    applyKnobs(best.knobs);
    void closeRecorder();
    set({ step: { kind: "done", best, start: history[0], takes: history.length }, level: null, seconds: 0 });
  };

  return {
    step: { kind: "idle" },
    history: [],
    inputs: [],
    inputId: null,
    level: null,
    seconds: 0,
    notice: null,

    async open() {
      const tm = useToneMatch.getState();
      if (!tm.analysis || !tm.proposal) return;
      if (irLive(useIrMatch.getState().step)) {
        set({ step: { kind: "error", message: "Finish or cancel the IR match first: it holds the pedal's CAB block." } });
        return;
      }
      const id = ++attempt;
      set({ step: { kind: "opening" }, history: [], seconds: 0, level: null, notice: null });
      try {
        // the proposal has to be on the pedal for the takes to mean anything
        if (tm.audition.kind !== "applied") await tm.auditionProposal();
        if (useToneMatch.getState().audition.kind !== "applied") throw new Error("The proposal didn't play on the pedal. Audition it first and see what the card says.");
        pedalTarget();
        const inputs = await listInputs();
        if (id !== attempt) return;
        if (inputs.length === 0) throw new Error(`No audio input found. Connect the ${pedalName(useDevice.getState().device)} with USB; it is also an audio interface.`);
        const keep = inputs.find((i) => i.deviceId === get().inputId);
        const inputId = (keep ?? inputs.find((i) => isPedalInput(i.label)) ?? inputs[0]).deviceId;
        set({ inputs, inputId });
        if (await openInput(inputId, id)) set({ step: { kind: "ready", take: 1 } });
      } catch (e) {
        if (id === attempt) await fail(e);
      }
    },

    async selectInput(deviceId) {
      if (get().step.kind !== "ready") return;
      const id = attempt;
      set({ inputId: deviceId, level: null });
      try {
        await openInput(deviceId, id);
      } catch (e) {
        if (id === attempt) await fail(e);
      }
    },

    record() {
      const { step } = get();
      if (!recorder || step.kind !== "ready") return;
      recorder.start();
      set({ step: { kind: "recording", take: step.take }, seconds: 0, notice: null });
      ticker = window.setInterval(() => {
        const seconds = recorder?.seconds ?? 0;
        set({ seconds });
        if (seconds >= TAKE_S) void get().finishTake();
      }, TICK_MS);
    },

    async finishTake() {
      const { step } = get();
      if (!recorder || step.kind !== "recording") return;
      window.clearInterval(ticker);
      ticker = undefined;
      const rate = recorder.sampleRate;
      const samples = recorder.stop();
      try {
        const analysis = useToneMatch.getState().analysis;
        if (!analysis) throw new Error("The song's analysis went away. Analyse it again.");
        const playedS = (ltas(samples, rate).activeFrames * (LTAS_FRAME / 2)) / rate;
        if (playedS < MIN_PLAYING_S) {
          set({ step: { kind: "ready", take: step.take }, seconds: 0, notice: `Only ${playedS.toFixed(0)} s of playing came through. Play through the take and check that the level moves, then record it again.` });
          return;
        }
        const history = [...get().history, { knobs: readKnobs(), measure: measure(samples, rate, analysis) }];
        set({ history, seconds: 0 });
        if (isDone(history)) return finish();
        applyKnobs(nextKnobs(history, analysis));
        set({ step: { kind: "ready", take: history.length + 1 } });
      } catch (e) {
        await fail(e);
      }
    },

    finishNow() {
      if (get().history.length === 0) {
        void get().cancel();
        return;
      }
      if (get().step.kind === "recording") recorder?.stop();
      finish();
    },

    async cancel() {
      attempt++;
      recorder?.stop();
      await closeRecorder();
      set({ step: { kind: "idle" }, history: [], level: null, seconds: 0, notice: null });
    },

    keep() {
      const { step } = get();
      const proposal = useToneMatch.getState().proposal;
      if (step.kind !== "done" || !proposal) return;
      useToneMatch.setState({ proposal: withTunedOnPedal(proposal, step.best.knobs, step.takes, step.start.measure.distance, step.best.measure.distance) });
      set({ step: { kind: "idle" }, history: [] });
    },
  };
});

// A new analysis (another song) makes the takes stale.
useToneMatch.subscribe((s, prev) => {
  if (s.analysis !== prev.analysis && usePedalRefine.getState().step.kind !== "idle") void usePedalRefine.getState().cancel();
});
