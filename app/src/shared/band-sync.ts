// The band sync protocol (spec 44): JSON messages over a WebSocket on the local network, between the performer's desktop app and the
// bandmates' browsers. The followers send only the messages listed in `ClientMessage`; the server checks every one with
// `parseClientMessage` before it acts on it. The leader sends the same model and clock snapshot the audience display uses (spec 43),
// so a follower runs its clock the same way the audience window does.
import type { AudienceClock, AudienceModel } from "./audience";
import { HostError } from "./ipc";

export const BAND_SYNC_PROTOCOL = 1;

/** Bounds on the sync server. A follower's message is a few dozen bytes, so the frame limit is small on purpose. */
export const BAND_SYNC_LIMITS = {
  /** The largest message a follower may send. A bigger frame closes the connection before it is parsed. */
  frameBytes: 4096,
  /** The sign-in PIN has this many digits. */
  pinDigits: 6,
  /** Followers signed in at once. */
  followers: 8,
  /** Connections that have not signed in yet. */
  pending: 8,
  /** A connection that has not signed in within this long is closed. */
  signInMs: 10_000,
  /** Control messages a follower may send each second. Extra ones are dropped. */
  controlPerSecond: 4,
  /** Messages a follower may send that the server refuses, before the connection is closed. */
  refusedMessages: 3,
  /** Unsent bytes a follower may have queued before it is dropped, so a stalled phone never holds the server up. */
  queuedBytes: 1_000_000,
  /** The port a new sync starts on, when none was chosen. */
  defaultPort: 8787,
  portMin: 1024,
  portMax: 65535,
} as const;

/** The transport actions a follower may ask for. Anything else is refused. Each one goes through the performance screen's action registry. */
export const FOLLOWER_ACTIONS = ["transport.play", "transport.playPause", "transport.stop"] as const;
export type FollowerAction = (typeof FOLLOWER_ACTIONS)[number];

/** Why a sign-in was refused: a wrong PIN, a session token that is no longer valid, a lock-out after too many failures, or a full room. */
export type RefusalReason = "pin" | "token" | "locked" | "full";

/** What a follower sends. A `hello` carries the PIN the first time and the session token after that. */
export type ClientMessage =
  | { type: "hello"; pin: string; token?: undefined }
  | { type: "hello"; token: string; pin?: undefined }
  | { type: "ping"; seq: number; t0: number }
  | { type: "control"; action: FollowerAction };

/** What the server sends. `song` carries the audience model, `state` the clock snapshot, and `pong` answers a ping with the server's times. */
export type ServerMessage =
  | { type: "hello"; protocol: number; token: string; controlAllowed: boolean }
  | { type: "control-allowed"; allowed: boolean }
  | { type: "refused"; reason: RefusalReason; retryAfter: number }
  | { type: "song"; model: AudienceModel }
  | { type: "state"; clock: AudienceClock }
  | { type: "pong"; seq: number; t0: number; t1: number; t2: number }
  | { type: "error"; message: string }
  | { type: "closing"; reason: "stopped" | "pin-changed" };

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const PIN = new RegExp(`^\\d{${BAND_SYNC_LIMITS.pinDigits}}$`);

export function isFollowerAction(value: unknown): value is FollowerAction {
  return typeof value === "string" && (FOLLOWER_ACTIONS as readonly string[]).includes(value);
}

function invalid(what: string): never {
  throw new HostError("invalid", `Band sync: ${what}.`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks one message from a follower. Anything that is not exactly one of the shapes in `ClientMessage` is refused with a HostError
 * ("invalid"), and a frame over the limit is refused before it is parsed. Unknown fields are dropped, not passed on.
 */
export function parseClientMessage(raw: string): ClientMessage {
  if (new TextEncoder().encode(raw).length > BAND_SYNC_LIMITS.frameBytes) invalid("the message is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    invalid("the message is not JSON");
  }
  if (!isObject(value)) invalid("the message must be an object");
  switch (value.type) {
    case "hello": {
      if (typeof value.pin === "string" && value.token === undefined) {
        if (!PIN.test(value.pin)) invalid("the PIN is not valid");
        return { type: "hello", pin: value.pin };
      }
      if (typeof value.token === "string" && value.pin === undefined) {
        if (!TOKEN.test(value.token)) invalid("the session is not valid");
        return { type: "hello", token: value.token };
      }
      return invalid("hello needs a PIN or a session, not both");
    }
    case "ping": {
      const { seq, t0 } = value;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) invalid("the ping number is not valid");
      if (typeof t0 !== "number" || !Number.isFinite(t0)) invalid("the ping time is not valid");
      return { type: "ping", seq, t0 };
    }
    case "control": {
      if (!isFollowerAction(value.action)) invalid("that action is not one a follower can run");
      return { type: "control", action: value.action };
    }
    default:
      return invalid("the message type is not known");
  }
}

/**
 * Reads a message from the server, for the follower page. Only the shape of the envelope is checked here; the model and the clock are
 * checked with `parseAudienceUpdate` before the page uses them. A message that is not JSON or has no type is null, and the caller ignores it.
 */
export function parseServerMessage(raw: string): ServerMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value) || typeof value.type !== "string") return null;
  return value as unknown as ServerMessage;
}

/** A port from the settings: a whole number in the range a sync may use. */
export function parseSyncPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < BAND_SYNC_LIMITS.portMin || value > BAND_SYNC_LIMITS.portMax) {
    throw new HostError("invalid", `Choose a port from ${BAND_SYNC_LIMITS.portMin} to ${BAND_SYNC_LIMITS.portMax}.`);
  }
  return value;
}
