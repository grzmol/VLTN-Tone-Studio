import { describe, expect, it, vi } from "vitest";
import {
  BankTracker,
  BOUNCE_MS,
  DOUBLE_PRESS_MS,
  ECHO_MS,
  EchoFilter,
  RemoteRouter,
  defaultBindings,
  describeBinding,
  dialogOpen,
  findConflict,
  isTypingTarget,
  learnStep,
  overlaps,
  parseMidi,
  sanitizeBindings,
  type Binding,
  type Route,
} from "./bindings";

/** A router whose clock the test moves by hand. */
function clock(start = 1000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

const firedActions = (routes: Route[]) => routes.filter((r) => r.kind === "fire").map((r) => r.binding.action);
const pedal = (value: number, channel = 0, controller = 80) => Uint8Array.from([0xb0 | channel, controller, value]);

describe("parseMidi", () => {
  it("reads channel messages with their channel from 0 to 15", () => {
    expect(parseMidi([0x92, 60, 100])).toEqual({ status: 0x90, channel: 2, data1: 60, data2: 100 });
    expect(parseMidi([0xc4, 9])).toEqual({ status: 0xc0, channel: 4, data1: 9 });
  });

  it("reads a note on with velocity 0 as a note off", () => {
    expect(parseMidi([0x90, 60, 0])).toEqual({ status: 0x80, channel: 0, data1: 60, data2: 0 });
  });

  it("reads real-time messages by their status alone", () => {
    expect(parseMidi([0xfa])).toEqual({ status: 0xfa });
    expect(parseMidi([0xf8])).toEqual({ status: 0xf8 });
  });

  it("returns null for SysEx, running status, out-of-range data and empty messages", () => {
    expect(parseMidi([0xf0, 0x7e, 0xf7])).toBeNull();
    expect(parseMidi([0x40, 0x10])).toBeNull();
    expect(parseMidi([0xb0, 80, 200])).toBeNull();
    expect(parseMidi([0xb0, 80])).toBeNull();
    expect(parseMidi([])).toBeNull();
  });
});

describe("matching", () => {
  it("matches a specific channel only, and any channel when none is given", () => {
    const router = new RemoteRouter(clock().now);
    const onChannel2: Binding = { action: "tempo.tap", source: "midi", match: { status: 0x90, channel: 2, data1: 60, data2Min: 1, data2Max: 127 } };
    const anyChannel: Binding = { action: "section.next", source: "midi", match: { status: 0x90, data1: 61, data2Min: 1, data2Max: 127 } };
    // Channels are 1 to 16 in a binding and 0 to 15 on the wire: 0x90 is channel 1, 0x91 is channel 2.
    expect(firedActions(router.midi([0x90, 60, 90], [onChannel2]))).toEqual([]);
    expect(firedActions(router.midi([0x90, 61, 90], [anyChannel]))).toEqual(["section.next"]);
    expect(firedActions(router.midi([0x91, 60, 90], [onChannel2]))).toEqual(["tempo.tap"]);
  });

  it("matches a note's velocity against its range", () => {
    const router = new RemoteRouter(clock().now);
    const hard: Binding = { action: "section.next", source: "midi", match: { status: 0x90, data1: 36, data2Min: 100, data2Max: 127 } };
    expect(firedActions(router.midi([0x90, 36, 99], [hard]))).toEqual([]);
    expect(firedActions(router.midi([0x90, 36, 100], [hard]))).toEqual(["section.next"]);
  });

  it("fires a momentary controller on every message in its range", () => {
    const router = new RemoteRouter(clock().now);
    const [binding] = defaultBindings().filter((b) => b.source === "midi" && b.match.status === 0xb0);
    expect(firedActions(router.midi(pedal(127), [binding]))).toEqual(["transport.playPause"]);
    expect(firedActions(router.midi(pedal(0), [binding]))).toEqual([]);
    expect(firedActions(router.midi(pedal(63), [binding]))).toEqual([]);
  });

  it("fires a threshold controller once when the value rises into its range", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    const binding: Binding = { action: "section.next", source: "midi", match: { status: 0xb0, data1: 70, data2Min: 64, data2Max: 127, mode: "threshold" } };
    expect(firedActions(router.midi(pedal(127, 0, 70), [binding]))).toEqual(["section.next"]);
    c.advance(BOUNCE_MS + 10);
    expect(firedActions(router.midi(pedal(127, 0, 70), [binding]))).toEqual([]);
    c.advance(BOUNCE_MS + 10);
    expect(firedActions(router.midi(pedal(0, 0, 70), [binding]))).toEqual([]);
    c.advance(BOUNCE_MS + 10);
    expect(firedActions(router.midi(pedal(127, 0, 70), [binding]))).toEqual(["section.next"]);
  });

  it("fires a toggle controller on each switch, up and down", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    const binding: Binding = { action: "section.next", source: "midi", match: { status: 0xb0, data1: 71, data2Min: 64, data2Max: 127, mode: "toggle" } };
    const sequence = [127, 127, 0, 127];
    const fired = sequence.map((value) => {
      c.advance(BOUNCE_MS + 10);
      return firedActions(router.midi(pedal(value, 0, 71), [binding])).length;
    });
    expect(fired).toEqual([1, 0, 1, 1]);
  });

  it("ignores repeats of one control within the bounce window", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    const [binding] = defaultBindings().filter((b) => b.source === "midi" && b.match.status === 0xb0);
    expect(firedActions(router.midi(pedal(127), [binding]))).toHaveLength(1);
    c.advance(BOUNCE_MS - 1);
    expect(firedActions(router.midi(pedal(127), [binding]))).toHaveLength(0);
    c.advance(BOUNCE_MS);
    expect(firedActions(router.midi(pedal(127), [binding]))).toHaveLength(1);
  });

  it("matches a program change on its bank only once the bank is selected", () => {
    const router = new RemoteRouter(clock().now);
    const binding: Binding = { action: "song.select", index: 2, source: "midi", match: { status: 0xc0, channel: 1, data1: 5, bank: 1 * 128 + 3 } };
    expect(firedActions(router.midi([0xc0, 5], [binding]))).toEqual([]);
    router.midi([0xb0, 0, 1], []);
    router.midi([0xb0, 32, 3], []);
    expect(firedActions(router.midi([0xc0, 5], [binding]))).toEqual(["song.select"]);
    expect(firedActions(router.midi([0xc0, 6], [binding]))).toEqual([]);
  });

  it("matches a real-time message by its status", () => {
    const router = new RemoteRouter(clock().now);
    const bindings = defaultBindings();
    expect(firedActions(router.midi([0xfc], bindings))).toEqual(["transport.stop"]);
    expect(firedActions(router.midi([0xfa], bindings))).toEqual(["transport.play"]);
    expect(firedActions(router.midi([0xf8], bindings))).toEqual([]);
  });
});

describe("echo", () => {
  it("does not take our own output, coming back through a THRU input, for a press", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    const stop = defaultBindings().filter((b) => b.source === "midi" && b.match.status === 0xfc);
    router.echo.record([0xfc]);
    c.advance(10);
    expect(router.midi([0xfc], stop)).toEqual([]);
    // Each record is used once: a second Stop from the pedal is a press.
    expect(firedActions(router.midi([0xfc], stop))).toEqual(["transport.stop"]);
  });

  it("stops recognising the echo after its window", () => {
    const c = clock();
    const filter = new EchoFilter(c.now);
    filter.record([0x90, 60, 100]);
    c.advance(ECHO_MS + 1);
    expect(filter.consume([0x90, 60, 100])).toBe(false);
  });

  it("does not recognise a message that was never sent", () => {
    const filter = new EchoFilter(clock().now);
    expect(filter.consume([0xfc])).toBe(false);
  });

  it("times a scheduled message from its wire time, so its echo is recognised when it comes back", () => {
    const c = clock();
    const filter = new EchoFilter(c.now);
    // Queued now for a wire time 800 ms ahead, as USB cues are queued by the scheduler's lookahead.
    filter.record([0xc0, 9], c.now() + 800);
    c.advance(805);
    expect(filter.consume([0xc0, 9])).toBe(true);
  });

  it("does not take a press that arrives before the scheduled message goes out", () => {
    const c = clock();
    const filter = new EchoFilter(c.now);
    filter.record([0xc0, 9], c.now() + 800);
    c.advance(300);
    expect(filter.consume([0xc0, 9])).toBe(false);
  });

  it("keeps a scheduled record for the echo window after its wire time, and no longer", () => {
    const c = clock();
    const filter = new EchoFilter(c.now);
    filter.record([0xc0, 9], c.now() + 100);
    c.advance(100 + ECHO_MS + 1);
    expect(filter.consume([0xc0, 9])).toBe(false);
  });
});

describe("double press", () => {
  const twice: Binding = { action: "transport.stop", source: "midi", match: { status: 0xfc }, doublePress: true };

  it("arms on the first press and runs on a second within the window", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    expect(router.midi([0xfc], [twice])).toEqual([{ kind: "armed", binding: twice }]);
    c.advance(DOUBLE_PRESS_MS - 100);
    expect(router.midi([0xfc], [twice])).toEqual([{ kind: "fire", binding: twice }]);
  });

  it("arms again when the second press comes too late", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    router.midi([0xfc], [twice]);
    c.advance(DOUBLE_PRESS_MS + 1);
    expect(router.midi([0xfc], [twice])).toEqual([{ kind: "armed", binding: twice }]);
  });

  it("works for a key as well as a MIDI message", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    const key: Binding = { action: "transport.stop", source: "key", match: { key: "Escape" }, doublePress: true };
    expect(router.key("Escape", [key])[0].kind).toBe("armed");
    c.advance(200);
    expect(router.key("Escape", [key])[0].kind).toBe("fire");
  });
});

describe("keys", () => {
  it("matches the key a performer presses, with letters in lower case", () => {
    const router = new RemoteRouter(clock().now);
    const bindings = defaultBindings();
    expect(firedActions(router.key("PageDown", bindings))).toEqual(["section.nextOrPage"]);
    expect(firedActions(router.key("ArrowLeft", bindings))).toEqual(["section.previousOrPage"]);
    expect(firedActions(router.key("T", bindings))).toEqual(["tempo.tap"]);
    expect(firedActions(router.key("x", bindings))).toEqual([]);
  });

  it("is never bound from a text field", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const slider = document.createElement("span");
    slider.setAttribute("role", "slider");
    const button = document.createElement("button");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(slider)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("is not a text field for an input that takes a click, but is one for a range", () => {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const radio = document.createElement("input");
    radio.type = "radio";
    const range = document.createElement("input");
    range.type = "range";
    const submit = document.createElement("input");
    submit.type = "submit";
    expect(isTypingTarget(checkbox)).toBe(false);
    expect(isTypingTarget(radio)).toBe(false);
    expect(isTypingTarget(submit)).toBe(false);
    expect(isTypingTarget(range)).toBe(true);
  });

  it("treats the stage-mode dialog as open for keys only when another dialog is not on top of it", () => {
    const dialog = (attributes: Record<string, string> = {}) => {
      const element = document.createElement("div");
      element.setAttribute("role", "dialog");
      element.setAttribute("data-state", "open");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      document.body.appendChild(element);
      return element;
    };
    expect(dialogOpen()).toBe(false);
    const stage = dialog({ "data-stage-mode": "" });
    expect(dialogOpen()).toBe(false);
    const other = dialog();
    expect(dialogOpen()).toBe(true);
    other.remove();
    stage.remove();
  });
});

describe("learn", () => {
  it("learns a program change with the bank selected before it as one match", () => {
    const bank = new BankTracker();
    const bankMsb = parseMidi([0xb2, 0, 1]);
    const bankLsb = parseMidi([0xb2, 32, 3]);
    for (const event of [bankMsb, bankLsb]) if (event) bank.observe(event);
    const step = learnStep(parseMidi([0xc2, 9])!, bank);
    expect(step).toEqual({
      kind: "match",
      match: { status: 0xc0, channel: 3, data1: 9, bank: 128 + 3 },
      seen: "Ch 3 · Program 9",
    });
  });

  it("learns a plain program change when no bank was selected", () => {
    expect(learnStep(parseMidi([0xc0, 4])!, new BankTracker())).toMatchObject({ kind: "match", match: { status: 0xc0, channel: 1, data1: 4 } });
  });

  it("waits on a bank select rather than learning it", () => {
    const step = learnStep(parseMidi([0xb0, 0, 2])!, new BankTracker());
    expect(step).toMatchObject({ kind: "wait", seen: "Ch 1 · CC 0 = 2. Now press the program change." });
  });

  it("learns a controller as momentary, on the half of the range its value is in", () => {
    const high = learnStep(parseMidi([0xb0, 80, 127])!, new BankTracker());
    expect(high).toMatchObject({ kind: "match", match: { status: 0xb0, channel: 1, data1: 80, data2Min: 64, data2Max: 127, mode: "momentary" } });
    const low = learnStep(parseMidi([0xb0, 80, 0])!, new BankTracker());
    expect(low).toMatchObject({ kind: "match", match: { data2Min: 0, data2Max: 63 } });
  });

  it("learns Start, Continue and Stop, but not the clock", () => {
    expect(learnStep({ status: 0xfa }, new BankTracker())).toMatchObject({ kind: "match", match: { status: 0xfa } });
    expect(learnStep({ status: 0xf8 }, new BankTracker())).toMatchObject({ kind: "ignore" });
  });

  it("does not learn pitch bend", () => {
    expect(learnStep(parseMidi([0xe0, 0, 64])!, new BankTracker())).toMatchObject({ kind: "ignore" });
  });

  it("returns nothing for our own echo", () => {
    const router = new RemoteRouter(clock().now);
    router.echo.record([0xfc]);
    expect(router.learnMidi([0xfc])).toBeNull();
  });
});

describe("conflicts", () => {
  const cc80 = defaultBindings()[3];

  it("treats the same control on overlapping channels and values as a clash", () => {
    const same: Binding = { action: "section.next", source: "midi", match: { status: 0xb0, channel: 1, data1: 80, data2Min: 100, data2Max: 127 } };
    expect(overlaps(cc80, same)).toBe(true);
  });

  it("allows the same controller on a different half of its range", () => {
    const low: Binding = { action: "section.next", source: "midi", match: { status: 0xb0, channel: 1, data1: 80, data2Min: 0, data2Max: 63 } };
    expect(overlaps(cc80, low)).toBe(false);
  });

  it("allows the same controller on a different channel, but an any-channel binding clashes with every channel", () => {
    const onOne: Binding = { action: "section.next", source: "midi", match: { status: 0xb0, channel: 1, data1: 80, data2Min: 64, data2Max: 127 } };
    const onTwo: Binding = { action: "section.previous", source: "midi", match: { status: 0xb0, channel: 2, data1: 80, data2Min: 64, data2Max: 127 } };
    expect(overlaps(onOne, onTwo)).toBe(false);
    expect(overlaps(cc80, onTwo)).toBe(true);
  });

  it("finds the clashing binding by its key or message", () => {
    const bindings = defaultBindings();
    expect(findConflict(bindings, { action: "section.arm", index: 1, source: "key", match: { key: "PageDown" } })).toBe(4);
    expect(findConflict(bindings, { action: "section.arm", index: 1, source: "key", match: { key: "F9" } })).toBe(-1);
  });
});

describe("saved bindings", () => {
  it("gives the defaults that match today's transport input and the page-turner keys", () => {
    const bindings = defaultBindings();
    expect(bindings).toContainEqual({ action: "transport.play", source: "midi", match: { status: 0xfa } });
    expect(bindings).toContainEqual({ action: "transport.stop", source: "midi", match: { status: 0xfc } });
    expect(bindings).toContainEqual({ action: "section.nextOrPage", source: "key", match: { key: "PageDown" } });
    const cc80Default = bindings.find((b) => b.source === "midi" && b.match.data1 === 80);
    expect(cc80Default).toEqual({
      action: "transport.playPause",
      source: "midi",
      match: { status: 0xb0, data1: 80, data2Min: 64, data2Max: 127, mode: "momentary" },
    });
  });

  it("keeps what is valid and drops what is not, without throwing", () => {
    const stored = [
      { action: "transport.stop", source: "midi", match: { status: 0xfc } },
      { action: "section.jump", source: "midi", match: { status: 0x90, data1: 40 } },
      { action: "section.jump", index: 70, source: "key", match: { key: "F2" } },
      { action: "not.real", source: "key", match: { key: "F3" } },
      { action: "transport.stop", source: "midi", match: { status: 0xf8 } },
      { action: "transport.play", source: "midi", match: { status: 0xb0, data1: 80, data2Min: 100, data2Max: 20 } },
      { action: "transport.play", source: "midi", match: { status: 0xb0, data1: 80, mode: "sometimes" } },
      { action: "transport.play", source: "midi", match: { status: 0xc0, data1: 3, bank: 99999 } },
      { action: "transport.play", source: "key", match: { key: "" } },
      { action: "tempo.tap", source: "key", match: { key: "t" } },
      null,
      "junk",
    ];
    expect(sanitizeBindings(stored)).toEqual([
      { action: "transport.stop", source: "midi", match: { status: 0xfc } },
      { action: "tempo.tap", source: "key", match: { key: "t" } },
    ]);
  });

  it("keeps the first of two bindings that clash", () => {
    const stored = [
      { action: "section.next", source: "key", match: { key: "PageDown" } },
      { action: "section.previous", source: "key", match: { key: "PageDown" } },
    ];
    expect(sanitizeBindings(stored)).toEqual([{ action: "section.next", source: "key", match: { key: "PageDown" } }]);
  });

  it("returns nothing for something that is not a list", () => {
    expect(sanitizeBindings(undefined)).toEqual([]);
    expect(sanitizeBindings({ 0: "x" })).toEqual([]);
  });

  it("describes a binding for the list and for a clash", () => {
    expect(describeBinding(defaultBindings()[3])).toBe("Any channel · CC 80 64–127 · Momentary");
    expect(describeBinding({ action: "section.next", source: "key", match: { key: "PageDown" }, doublePress: true })).toBe("Key PageDown · double press");
  });
});

describe("receive", () => {
  const programBinding: Binding = { action: "section.next", source: "midi", match: { status: 0xc0, channel: 1, data1: 9 } };
  const hitSong = (song: string) => () => ({ key: song, value: song });

  it("gives a message no binding claims to the song finder, once within the bounce window", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    expect(router.receive([0xc0, 5], [], hitSong("song-a")).song).toBe("song-a");
    // A pedal that sends the change twice loads once.
    expect(router.receive([0xc0, 5], [], hitSong("song-a")).song).toBeNull();
    c.advance(BOUNCE_MS);
    expect(router.receive([0xc0, 5], [], hitSong("song-a")).song).toBe("song-a");
  });

  it("does not ask the song finder when a binding claims the message, and fires the binding", () => {
    const router = new RemoteRouter(clock().now);
    const finder = vi.fn(hitSong("song-a"));
    const received = router.receive([0xc0, 9], [programBinding], finder);
    expect(finder).not.toHaveBeenCalled();
    expect(received.song).toBeNull();
    expect(firedActions(received.routes)).toEqual(["section.next"]);
  });

  it("keeps a claimed message from a song trigger even when the binding is bounced", () => {
    const c = clock();
    const router = new RemoteRouter(c.now);
    router.receive([0xc0, 9], [programBinding], hitSong("song-a"));
    const again = router.receive([0xc0, 9], [programBinding], hitSong("song-a"));
    expect(again.routes).toEqual([]);
    expect(again.song).toBeNull();
  });

  it("does not select a song for our own echoed output, and does not ask the finder for it", () => {
    const router = new RemoteRouter(clock().now);
    router.echo.record([0xc0, 5]);
    const finder = vi.fn(hitSong("song-a"));
    expect(router.receive([0xc0, 5], [], finder)).toEqual({ routes: [], song: null });
    expect(finder).not.toHaveBeenCalled();
  });

  it("reads Song Select with its number and no channel", () => {
    expect(parseMidi([0xf3, 12])).toEqual({ status: 0xf3, data1: 12 });
    expect(parseMidi([0xf3])).toBeNull();
    expect(parseMidi([0xf3, 128])).toBeNull();
  });

  it("reads a message that is not a message as nothing, and never throws", () => {
    const router = new RemoteRouter(clock().now);
    const finder = vi.fn(hitSong("song-a"));
    expect(router.receive([0x90], [], finder)).toEqual({ routes: [], song: null });
    expect(router.receive([], [programBinding], finder)).toEqual({ routes: [], song: null });
    expect(finder).not.toHaveBeenCalled();
  });
});

describe("timecode and clock coming back through THRU", () => {
  it("never fires a binding or selects a song: timecode is dropped before the song matcher is asked", () => {
    const router = new RemoteRouter(() => 0);
    const askedSong = vi.fn(() => ({ key: "any", value: 1 }));
    const timecode = [
      [0xf1, 0x72], // quarter frame
      [0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x21, 0x02, 0x03, 0x04, 0xf7], // full frame
    ];
    for (const bytes of timecode) {
      expect(router.receive(bytes, defaultBindings(), askedSong)).toEqual({ routes: [], song: null });
    }
    expect(askedSong).not.toHaveBeenCalled();
  });

  it("does not fire on the clock, and the song matcher answers only for Song Select and program change", () => {
    const router = new RemoteRouter(() => 0);
    expect(router.receive([0xf8], defaultBindings(), () => null)).toEqual({ routes: [], song: null });
    expect(router.midi([0xf8], defaultBindings())).toEqual([]);
  });

  it("ignores our own timecode when it is recorded and comes back", () => {
    let time = 0;
    const router = new RemoteRouter(() => time);
    router.echo.record([0xf1, 0x72], 0);
    time = 10;
    expect(router.readInput([0xf1, 0x72])).toBeNull();
  });
});

describe("default section keys", () => {
  it("binds PageDown, PageUp and the arrows to the page-or-section actions, so a PDF on screen turns its pages", () => {
    const keyed = defaultBindings()
      .filter((b) => b.source === "key")
      .map((b) => [(b.match as { key?: string }).key, b.action]);
    expect(keyed).toEqual(
      expect.arrayContaining([
        ["PageDown", "section.nextOrPage"],
        ["PageUp", "section.previousOrPage"],
        ["ArrowRight", "section.nextOrPage"],
        ["ArrowLeft", "section.previousOrPage"],
      ]),
    );
  });
});
