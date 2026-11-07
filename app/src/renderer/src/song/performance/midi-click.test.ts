import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClickEvent } from "../stems/player";
import { MidiClick, midiClickMessages, parseMidiClickSettings, type ClickPort, type MidiClickSettings } from "./midi-click";
import type { TimedMessage } from "./midi-scheduler";

vi.mock("@/host", () => ({ host: {} }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settings = (patch: Partial<MidiClickSettings> = {}): MidiClickSettings => ({
  enabled: true,
  portId: "drums",
  channel: 10,
  offsetMs: 0,
  alsoPlay: true,
  ...patch,
});
const beat = (n: number, when = 10, sound: ClickEvent["sound"] = "sticks"): ClickEvent => ({ when: when + n * 0.5, beat: n, beats: 4, sound });

/** A fake scheduler that sends every timed message at once, as the worker would when it is due. */
function rig(initial: MidiClickSettings) {
  const drums: ClickPort & { sent: [number[], number | undefined][] } = {
    state: "connected",
    sent: [],
    send: (bytes, at) => void drums.sent.push([bytes, at]),
  };
  const cues: ClickPort & { sent: [number[], number | undefined][] } = { state: "connected", sent: [], send: (bytes, at) => void cues.sent.push([bytes, at]) };
  const ports: Record<string, ClickPort | undefined> = { drums, cues };
  let current = initial;
  const timed: TimedMessage[] = [];
  const starts = vi.fn();
  const syncs = vi.fn();
  const stop = vi.fn();
  const onFault = vi.fn();
  const click = new MidiClick({
    settings: () => current,
    output: (id) => ports[id],
    start: ((_config: unknown, onSend: (message: { bytes: number[]; due: number; label: string }) => void) => {
      starts();
      return {
        stop,
        sync: syncs,
        addTimed: (messages: TimedMessage[]) => {
          timed.push(...messages);
          for (const m of messages) onSend({ bytes: m.bytes, due: m.due, label: "Click" });
        },
      };
    }) as never,
    now: () => performance.now() + 1000,
    timeOrigin: () => 1000,
    onFault,
  });
  return { click, drums, cues, timed, starts, syncs, stop, onFault, set: (next: MidiClickSettings) => void (current = next) };
}

it("builds a note-on and a note-off 50 ms later on the chosen channel, with a harder downbeat", () => {
  expect(midiClickMessages("pedal-hat", 0, 4, 10, 2000)).toEqual([
    { bytes: [153, 44, 100], due: 2000 },
    { bytes: [137, 44, 0], due: 2050 },
  ]);
  expect(midiClickMessages("rock", 1, 4, 1, 3000)).toEqual([
    { bytes: [144, 38, 80], due: 3000 },
    { bytes: [128, 38, 0], due: 3050 },
  ]);
});

it("reads saved settings with every value checked", () => {
  expect(parseMidiClickSettings(undefined)).toEqual({ enabled: false, portId: "", channel: 10, offsetMs: 0, alsoPlay: true });
  expect(parseMidiClickSettings({ enabled: true, portId: "x", channel: 99, offsetMs: -500, alsoPlay: false })).toEqual({
    enabled: true,
    portId: "x",
    channel: 16,
    offsetMs: -100,
    alsoPlay: false,
  });
  expect(parseMidiClickSettings({ channel: "ten", offsetMs: NaN }).channel).toBe(10);
});

it("sends each count-in beat as note on and off on channel 10 at the beat time plus the offset, to the chosen output only", () => {
  const r = rig(settings({ offsetMs: 40 }));
  // The audio clock reads 10 now, so a beat at audio time 10.5 is half a second from now on the MIDI clock.
  for (let n = 0; n < 4; n++) r.click.onClick(beat(n), 10);
  const now = performance.now() + 1000;
  expect(r.starts).toHaveBeenCalledTimes(1);
  expect(r.drums.sent.map(([bytes]) => bytes)).toEqual([
    [153, 37, 100],
    [137, 37, 0],
    [153, 37, 80],
    [137, 37, 0],
    [153, 37, 80],
    [137, 37, 0],
    [153, 37, 80],
    [137, 37, 0],
  ]);
  // Beat 1 is due 500 ms ahead, plus the 40 ms offset; its Web MIDI timestamp is on the page's clock.
  expect(r.timed[2].due).toBeCloseTo(now + 540, -1);
  expect(r.drums.sent[2][1]).toBeCloseTo(now + 540 - 1000, -1);
  expect(r.timed[3].due - r.timed[2].due).toBe(50);
  expect(r.cues.sent).toEqual([]);
});

it("sends nothing when the setting is off, no output is chosen, or the output is gone", () => {
  const off = rig(settings({ enabled: false }));
  off.click.onClick(beat(0), 10);
  const none = rig(settings({ portId: "" }));
  none.click.onClick(beat(0), 10);
  const gone = rig(settings({ portId: "missing" }));
  gone.click.onClick(beat(0), 10);
  for (const r of [off, none, gone]) {
    expect(r.starts).not.toHaveBeenCalled();
    expect(r.drums.sent).toEqual([]);
  }
});

it("keeps the worker's session alive with a heartbeat, closes it when the clicks stop, and releases held notes on cancel", () => {
  const r = rig(settings());
  r.click.onClick(beat(0), 10);
  vi.advanceTimersByTime(200);
  expect(r.syncs.mock.calls.length).toBeGreaterThanOrEqual(3);
  vi.advanceTimersByTime(4000);
  expect(r.stop).toHaveBeenCalledTimes(1);
  // A note-on still open when playback is cut gets its note-off at once.
  const c = rig(settings());
  c.click.onClick(beat(0), 10);
  c.drums.sent.length = 0;
  (c.click as unknown as { held: Map<string, ClickPort> }).held.set("9:37", c.drums);
  c.click.cancel();
  expect(c.stop).toHaveBeenCalled();
  expect(c.drums.sent).toEqual([[[137, 37, 0], undefined]]);
});
