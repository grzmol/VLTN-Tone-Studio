import { describe, expect, it } from "vitest";
import type { AudienceModel } from "@shared/audience";
import { FollowerClient, reconnectDelay, sessionTokens, SESSION_KEY, type FollowerState, type SocketLike, type TokenStore } from "./follower-client";

/** A socket the test drives: it opens, receives and drops when told to. */
class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((text: string) => void) | null = null;
  onclose: (() => void) | null = null;
  send(text: string) {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  receive(message: unknown) {
    this.onmessage?.(JSON.stringify(message));
  }
  drop() {
    this.onclose?.();
  }
}

interface Timer {
  run: () => void;
  ms: number;
  cancelled: boolean;
}

const MODEL: AudienceModel = {
  songKey: "G",
  screen: "lyrics",
  blackout: false,
  blackBetweenSongs: false,
  title: "Song",
  nextTitle: null,
  timed: true,
  lines: [{ time: 0, heading: null, text: "Words", chords: [] }],
  showChords: false,
  fontScale: 1,
  rotation: 0,
  pdf: null,
};
const CLOCK = { songKey: "G", songPosition: 2, at: 1000, rate: 1, playing: true };

function harness(token: string | null = null) {
  const sockets: FakeSocket[] = [];
  const timers: Timer[] = [];
  let now = 1000;
  const saved = { value: token as string | null };
  const tokens: TokenStore = {
    get: () => saved.value,
    set: (next) => {
      saved.value = next;
    },
    clear: () => {
      saved.value = null;
    },
  };
  const client = new FollowerClient({
    url: "ws://band.test/ws",
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    tokens,
    now: () => now,
    setTimer: (run, ms) => {
      const timer: Timer = { run, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as Timer).cancelled = true;
    },
  });
  /** Runs the next live timer, the way the browser would when its delay ends. */
  const fire = (): number | null => {
    const next = timers.find((timer) => !timer.cancelled);
    if (!next) return null;
    next.cancelled = true;
    next.run();
    return next.ms;
  };
  const pending = () => timers.filter((timer) => !timer.cancelled);
  return {
    client,
    sockets,
    saved,
    fire,
    pending,
    setNow: (value: number) => {
      now = value;
    },
    state: (): FollowerState => client.getState(),
  };
}

describe("reconnectDelay", () => {
  it("starts at half a second, doubles, and stops at eight seconds", () => {
    expect([0, 1, 2, 3, 4].map(reconnectDelay)).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(reconnectDelay(9)).toBe(8000);
  });
});

describe("FollowerClient sign-in", () => {
  it("asks for the PIN, and opens nothing, when this tab has no session", () => {
    const { client, sockets, state } = harness();
    client.start();
    expect(sockets).toHaveLength(0);
    expect(state()).toMatchObject({ phase: "pin" });
  });

  it("connects at once with a saved session", () => {
    const { client, sockets } = harness("saved-session-token-0123456789");
    client.start();
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    expect(sockets[0].sent).toEqual([{ type: "hello", token: "saved-session-token-0123456789" }]);
  });

  it("sends the typed PIN, and on acceptance keeps the session and starts the clock", () => {
    const { client, sockets, saved, state, pending } = harness();
    client.start();
    client.submitPin("123456");
    const socket = sockets[0];
    socket.open();
    expect(socket.sent).toEqual([{ type: "hello", pin: "123456" }]);
    socket.receive({ type: "hello", protocol: 1, token: "new-session-token-0123456789", controlAllowed: true });
    expect(state()).toMatchObject({ phase: "live", controlAllowed: true, refusal: null });
    expect(saved.value).toBe("new-session-token-0123456789");
    expect(socket.sent.filter((m) => m.type === "ping")).toHaveLength(1);
    expect(pending().length).toBeGreaterThan(0);
  });

  it("does not send the PIN a second time after a reconnect, and the session is used instead", () => {
    const { client, sockets, fire } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed: false });
    sockets[0].drop();
    fire();
    sockets[1].open();
    expect(sockets[1].sent).toEqual([{ type: "hello", token: "session-token-abcdefghijkl" }]);
  });

  it("shows a refused PIN, and does not retry it on its own", () => {
    const { client, sockets, state, pending } = harness();
    client.start();
    client.submitPin("000000");
    sockets[0].open();
    sockets[0].receive({ type: "refused", reason: "pin", retryAfter: 0 });
    expect(state()).toMatchObject({ phase: "pin", refusal: "pin" });
    expect(state().message).toMatch(/not right/);
    sockets[0].drop();
    expect(pending()).toHaveLength(0);
  });

  it("tells the follower how long a lock-out lasts", () => {
    const { client, sockets, state } = harness();
    client.start();
    client.submitPin("000000");
    sockets[0].open();
    sockets[0].receive({ type: "refused", reason: "locked", retryAfter: 60 });
    expect(state().message).toMatch(/Try again in 60 seconds/);
  });

  it("forgets a session the server no longer accepts, and asks for the PIN", () => {
    const { client, sockets, saved, state } = harness("stale-session-token-0123456789");
    client.start();
    sockets[0].open();
    sockets[0].receive({ type: "refused", reason: "token", retryAfter: 0 });
    expect(saved.value).toBeNull();
    expect(state()).toMatchObject({ phase: "pin", refusal: "token" });
  });

  it("asks for the new PIN when the performer changes it, and forgets the session", () => {
    const { client, sockets, saved, state, pending } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed: false });
    sockets[0].receive({ type: "closing", reason: "pin-changed" });
    sockets[0].drop();
    expect(saved.value).toBeNull();
    expect(state()).toMatchObject({ phase: "pin" });
    expect(state().message).toMatch(/new PIN/);
    expect(pending()).toHaveLength(0);
  });

  it("says so when it cannot reach the app with a PIN, rather than retrying", () => {
    const { client, sockets, state, pending } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].drop();
    expect(state().phase).toBe("pin");
    expect(state().message).toMatch(/Could not reach/);
    expect(pending()).toHaveLength(0);
  });
});

describe("FollowerClient connection", () => {
  it("retries a dropped connection with a growing delay, and resumes with the session", () => {
    const { client, sockets, fire, state } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed: false });
    sockets[0].drop();
    expect(state()).toMatchObject({ phase: "reconnecting", synced: false });
    expect(fire()).toBe(500);
    sockets[1].drop();
    expect(fire()).toBe(1000);
    sockets[2].open();
    expect(sockets[2].sent).toEqual([{ type: "hello", token: "session-token-abcdefghijkl" }]);
  });

  it("keeps trying while the sync is stopped, and asks for the PIN once it is back", () => {
    const { client, sockets, fire, state } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed: false });
    sockets[0].receive({ type: "closing", reason: "stopped" });
    expect(state().phase).toBe("reconnecting");
    sockets[0].drop();
    expect(fire()).toBe(500);
    sockets[1].open();
    sockets[1].receive({ type: "refused", reason: "token", retryAfter: 0 });
    expect(state().phase).toBe("pin");
  });

  it("stops retrying when the page leaves", () => {
    const { client, sockets, pending } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed: false });
    client.stop();
    expect(sockets[0].closed).toBe(true);
    sockets[0].drop();
    expect(pending()).toHaveLength(0);
  });

  it("answers a welcome from another protocol by closing it", () => {
    const { client, sockets } = harness();
    client.start();
    client.submitPin("123456");
    sockets[0].open();
    sockets[0].receive({ type: "hello", protocol: 2, token: "session-token-abcdefghijkl", controlAllowed: false });
    expect(sockets[0].closed).toBe(true);
  });
});

describe("FollowerClient song and clock", () => {
  function live(controlAllowed: boolean) {
    const harnessed = harness();
    harnessed.client.start();
    harnessed.client.submitPin("123456");
    harnessed.sockets[0].open();
    harnessed.sockets[0].receive({ type: "hello", protocol: 1, token: "session-token-abcdefghijkl", controlAllowed });
    return harnessed;
  }

  it("takes the model and the clock the performer sends", () => {
    const { sockets, state } = live(false);
    sockets[0].receive({ type: "song", model: MODEL });
    sockets[0].receive({ type: "state", clock: CLOCK });
    expect(state().model?.title).toBe("Song");
    expect(state().clock).toEqual(CLOCK);
  });

  it("ignores a message whose model or clock is not what the audience window would accept", () => {
    const { sockets, state } = live(false);
    sockets[0].receive({ type: "song", model: { ...MODEL, screen: "video" } });
    sockets[0].receive({ type: "state", clock: { ...CLOCK, rate: 99 } });
    expect(state().model).toBeNull();
    expect(state().clock).toBeNull();
  });

  it("shows or hides the controls when the performer flips remote control", () => {
    const { sockets, state } = live(false);
    sockets[0].receive({ type: "control-allowed", allowed: true });
    expect(state().controlAllowed).toBe(true);
    sockets[0].receive({ type: "control-allowed", allowed: false });
    expect(state().controlAllowed).toBe(false);
  });

  it("ignores a message that is not JSON", () => {
    const { sockets, state } = live(false);
    sockets[0].onmessage?.("{nope");
    expect(state().phase).toBe("live");
  });

  it("estimates the performer's clock from pongs, and reports it once known", () => {
    const { client, sockets, state, setNow } = live(false);
    // The performer's clock runs 5000 ms ahead of this device. A ping leaves at 1000, and the pong arrives at 1020.
    const ping = sockets[0].sent.find((m) => m.type === "ping") as { seq: number; t0: number };
    setNow(1020);
    sockets[0].receive({ type: "pong", seq: ping.seq, t0: ping.t0, t1: 6010, t2: 6010 });
    expect(state().synced).toBe(true);
    expect(client.leaderNow()).toBe(1020 + 5000);
  });

  it("ignores a pong with a time that is not a number", () => {
    const { client, sockets, state } = live(false);
    sockets[0].receive({ type: "pong", seq: 0, t0: 1, t1: Number.NaN, t2: 3 });
    expect(state().synced).toBe(false);
    expect(client.leaderNow()).toBe(1000);
  });

  it("sends a control only when live and allowed by the performer", () => {
    const allowed = live(true);
    allowed.client.control("transport.stop");
    expect(allowed.sockets[0].sent.at(-1)).toEqual({ type: "control", action: "transport.stop" });
    const denied = live(false);
    denied.client.control("transport.stop");
    expect(denied.sockets[0].sent.some((m) => m.type === "control")).toBe(false);
  });

  it("pings quickly at first, and then slowly", () => {
    const { sockets, fire } = live(false);
    const delays = [fire(), fire(), fire()];
    expect(delays).toEqual([200, 200, 200]);
    expect(sockets[0].sent.filter((m) => m.type === "ping").length).toBeGreaterThan(3);
  });
});

describe("sessionTokens", () => {
  it("keeps the session in the tab's session storage", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
    const tokens = sessionTokens(storage);
    tokens.set("token-abcdefghijklmnop");
    expect(data.get(SESSION_KEY)).toBe("token-abcdefghijklmnop");
    expect(tokens.get()).toBe("token-abcdefghijklmnop");
    tokens.clear();
    expect(tokens.get()).toBeNull();
  });

  it("does nothing, and does not throw, when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const tokens = sessionTokens(blocked);
    expect(tokens.get()).toBeNull();
    expect(() => tokens.set("x")).not.toThrow();
    expect(() => tokens.clear()).not.toThrow();
    expect(sessionTokens(undefined).get()).toBeNull();
  });
});
