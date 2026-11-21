// The follower page's connection (spec 44), kept free of React and the DOM so it can be tested with a fake socket. It signs in with the
// PIN, keeps the session token the server gives it, pings to estimate the clock offset, and runs the song's clock from the snapshots the
// performer's app sends (the same model and clock the audience window uses, spec 43). A dropped connection is retried with a growing
// delay. A refused sign-in is not retried: the page asks for the PIN again instead.
import { parseAudienceUpdate, type AudienceClock, type AudienceModel } from "@shared/audience";
import { BAND_SYNC_PROTOCOL, parseServerMessage, type ClientMessage, type FollowerAction, type RefusalReason } from "@shared/band-sync";
import { estimateOffset, MAX_SAMPLES, pingSample, type PingSample } from "./clock-offset";

/** Where the session token is kept on this device: per tab, so it ends when the tab does. */
export const SESSION_KEY = "vltn.band.session.v1";
/** The first pings come quickly, so the clock is known soon after sign-in; then they slow down to keep it right. */
const FAST_PINGS = 8;
const FAST_PING_MS = 200;
const SLOW_PING_MS = 10_000;

/** The delay before retry number `attempt` (from 0): half a second, doubling, and never more than eight seconds. */
export function reconnectDelay(attempt: number): number {
  return Math.min(8000, 500 * 2 ** Math.min(attempt, 6));
}

/** The page's state. `connecting` and `reconnecting` retry on their own; `pin` waits for the follower to type the PIN. */
export type FollowerPhase = "connecting" | "pin" | "live" | "reconnecting";

export interface FollowerState {
  phase: FollowerPhase;
  /** One line for the page: what is happening, or why the PIN is needed. */
  message: string;
  model: AudienceModel | null;
  clock: AudienceClock | null;
  controlAllowed: boolean;
  /** Whether the clock offset is known yet. The song runs on this device's clock until it is. */
  synced: boolean;
  /** The last sign-in refusal, when there was one. */
  refusal: RefusalReason | null;
}

/** The part of a WebSocket the client uses. The page wraps the browser's socket in this; the tests use a fake. */
export interface SocketLike {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((text: string) => void) | null;
  onclose: (() => void) | null;
}

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export interface FollowerClientOptions {
  url: string;
  connect(url: string): SocketLike;
  tokens: TokenStore;
  now(): number;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** A WebSocket as the client's socket: the same events, with the text of a message. */
export function socketOf(url: string): SocketLike {
  const ws = new WebSocket(url);
  const socket: SocketLike = {
    send: (text) => ws.send(text),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => socket.onopen?.();
  ws.onmessage = (event: MessageEvent) => socket.onmessage?.(String(event.data));
  ws.onclose = () => socket.onclose?.();
  return socket;
}

const REFUSAL_TEXT: Record<RefusalReason, string> = {
  pin: "That PIN is not right. Check the PIN on the performer's screen.",
  token: "Your session has ended. Enter the PIN again.",
  locked: "Too many wrong PINs from this device. Wait, then try again.",
  full: "The band sync is full. Try again when a bandmate leaves.",
};

export class FollowerClient {
  private socket: SocketLike | null = null;
  private listeners = new Set<() => void>();
  private state: FollowerState = {
    phase: "connecting",
    message: "Connecting…",
    model: null,
    clock: null,
    controlAllowed: false,
    synced: false,
    refusal: null,
  };
  private stopped = false;
  /** The PIN typed on the page, sent with the next connection, then forgotten. */
  private pendingPin: string | null = null;
  /** True between sending a PIN and the server's answer. A dropped connection then asks for the PIN again. */
  private awaitingPin = false;
  private retries = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private pings = 0;
  private samples: PingSample[] = [];
  private offset = 0;

  constructor(private options: FollowerClientOptions) {}

  /** Starts the page: with a saved session the page connects at once; otherwise it asks for the PIN. */
  start(): void {
    this.stopped = false;
    if (this.options.tokens.get()) this.connect();
    else this.setState({ phase: "pin", message: "Enter the PIN shown on the performer's screen." });
  }

  /** The page is leaving: nothing is retried after this. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  /** Signs in with a PIN typed on the page. */
  submitPin(pin: string): void {
    if (this.stopped) return;
    this.pendingPin = pin;
    this.awaitingPin = true;
    this.clearTimers();
    this.retries = 0;
    this.connect();
  }

  /** Asks the performer's app to run a transport action. Only signed-in followers, and only when the performer allows it. */
  control(action: FollowerAction): void {
    if (this.state.phase !== "live" || !this.state.controlAllowed) return;
    this.send({ type: "control", action });
  }

  /** The performer's clock now, as this page estimates it. The song's position is worked out from this. */
  leaderNow(): number {
    return this.options.now() + this.offset;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): FollowerState => this.state;

  private connect(): void {
    this.socket?.close();
    const socket = this.options.connect(this.options.url);
    this.socket = socket;
    if (this.state.phase !== "live") this.setState({ phase: this.retries > 0 ? "reconnecting" : "connecting", message: "Connecting…" });
    socket.onopen = () => this.signIn(socket);
    socket.onmessage = (text) => this.receive(text);
    socket.onclose = () => this.closed(socket);
  }

  /** The first message on a new connection: the PIN the follower typed, or else the saved session. */
  private signIn(socket: SocketLike): void {
    if (this.socket !== socket) return;
    if (this.pendingPin !== null) {
      const pin = this.pendingPin;
      this.pendingPin = null;
      socket.send(JSON.stringify({ type: "hello", pin } satisfies ClientMessage));
      return;
    }
    const token = this.options.tokens.get();
    if (token) socket.send(JSON.stringify({ type: "hello", token } satisfies ClientMessage));
    else socket.close();
  }

  private receive(text: string): void {
    const message = parseServerMessage(text);
    if (!message) return;
    switch (message.type) {
      case "hello":
        return this.welcome(message.protocol, message.token, message.controlAllowed);
      case "control-allowed":
        if (this.state.phase === "live" && typeof message.allowed === "boolean") this.setState({ controlAllowed: message.allowed });
        return;
      case "refused":
        return this.refused(message.reason, message.retryAfter);
      case "song": {
        const update = this.checked({ model: message.model, clock: null });
        if (update?.model) this.setState({ model: update.model });
        return;
      }
      case "state": {
        const update = this.checked({ model: null, clock: message.clock });
        if (update?.clock) this.setState({ clock: update.clock });
        return;
      }
      case "pong":
        return this.pong(message.seq, message.t0, message.t1, message.t2);
      case "closing":
        return this.closing(message.reason);
      case "error":
        return;
    }
  }

  /** The model and clock go through the same check as the audience window's. A message that fails it is ignored, not shown. */
  private checked(update: { model: unknown; clock: unknown }) {
    try {
      return parseAudienceUpdate(update);
    } catch {
      return null;
    }
  }

  private welcome(protocol: number, token: string, controlAllowed: boolean): void {
    if (protocol !== BAND_SYNC_PROTOCOL || typeof token !== "string") {
      this.socket?.close();
      return;
    }
    this.options.tokens.set(token);
    this.awaitingPin = false;
    this.retries = 0;
    this.pings = 0;
    this.samples = [];
    this.setState({ phase: "live", message: "Following the performer.", controlAllowed, refusal: null });
    this.ping();
  }

  private refused(reason: RefusalReason, retryAfter: number): void {
    this.awaitingPin = false;
    if (reason === "token") this.options.tokens.clear();
    const wait = reason === "locked" && retryAfter > 0 ? ` Try again in ${retryAfter} seconds.` : "";
    this.clearTimers();
    this.setState({ phase: "pin", message: `${REFUSAL_TEXT[reason]}${wait}`, refusal: reason, model: null, clock: null, synced: false });
  }

  private closing(reason: "stopped" | "pin-changed"): void {
    if (reason === "pin-changed") {
      this.options.tokens.clear();
      this.clearTimers();
      this.setState({ phase: "pin", message: "The PIN was changed. Enter the new PIN.", refusal: null, synced: false });
      return;
    }
    // The sync stopped: the server is gone, so this page waits and tries again. Its session is revoked, so it will ask for the PIN then.
    this.setState({ phase: "reconnecting", message: "Band sync has stopped. Waiting for it to start again.", synced: false });
  }

  private closed(socket: SocketLike): void {
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.stopped || this.state.phase === "pin") return;
    if (this.awaitingPin) {
      this.awaitingPin = false;
      this.setState({ phase: "pin", message: "Could not reach the performer's app. Check the address and that band sync is on." });
      return;
    }
    this.clearPings();
    this.setState({ phase: "reconnecting", message: "Connection lost. Reconnecting…", synced: false });
    this.retryTimer = this.options.setTimer(() => {
      this.retryTimer = null;
      this.retries += 1;
      this.connect();
    }, reconnectDelay(this.retries));
  }

  private ping(): void {
    this.send({ type: "ping", seq: this.pings, t0: this.options.now() });
    this.pings += 1;
    this.pingTimer = this.options.setTimer(() => this.ping(), this.pings < FAST_PINGS ? FAST_PING_MS : SLOW_PING_MS);
  }

  private pong(seq: number, t0: number, t1: number, t2: number): void {
    if (!Number.isFinite(t1) || !Number.isFinite(t2) || !Number.isFinite(t0) || seq < 0) return;
    this.samples = [...this.samples, pingSample({ t0, t1, t2 }, this.options.now())].slice(-MAX_SAMPLES);
    const estimate = estimateOffset(this.samples);
    if (!estimate) return;
    this.offset = estimate.offset;
    if (!this.state.synced) this.setState({ synced: true });
  }

  private send(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private clearPings(): void {
    if (this.pingTimer !== null) this.options.clearTimer(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimers(): void {
    this.clearPings();
    if (this.retryTimer !== null) this.options.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(next: Partial<FollowerState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

/** The session token in this tab's session storage. A blocked or missing storage means there is no saved session. */
export function sessionTokens(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined): TokenStore {
  return {
    get: () => {
      try {
        return storage?.getItem(SESSION_KEY) ?? null;
      } catch {
        return null;
      }
    },
    set: (token) => {
      try {
        storage?.setItem(SESSION_KEY, token);
      } catch {
        // Without storage the page signs in again after a reload. That is the only effect.
      }
    },
    clear: () => {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        // Nothing saved, nothing to clear.
      }
    },
  };
}
