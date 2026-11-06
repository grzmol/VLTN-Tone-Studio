// Sign-in for band sync (spec 44): a random PIN for the session, failures counted per IP address, a lock-out after repeated failures,
// and session tokens that the followers keep so a dropped connection does not ask for the PIN again. Every session ends when the PIN
// changes or the sync stops. The PIN is the only protection on the local network, so the comparisons and the lock-out live here, where
// they can be tested without a socket.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { BAND_SYNC_LIMITS } from "@shared/band-sync";
import type { RefusalReason } from "@shared/band-sync";

/** Failures from one address before it is locked out, how long the first lock-out lasts, the longest it can grow to, and the window failures are counted in. */
export const LOCKOUT = {
  failures: 5,
  firstMs: 60_000,
  maxMs: 15 * 60_000,
  windowMs: 10 * 60_000,
} as const;

/** How long a session token is good for. A follower that has been away longer signs in again with the PIN. */
export const SESSION_MS = 12 * 60 * 60_000;

const MAX_SESSIONS = 256;
const MAX_ADDRESSES = 1024;

export type SignIn = { ok: true; token: string } | { ok: false; reason: Exclude<RefusalReason, "full">; retryAfter: number };
export type Resume = { ok: true } | { ok: false; reason: "token" | "locked"; retryAfter: number };

interface Failures {
  count: number;
  windowStart: number;
  strikes: number;
  lockedUntil: number;
}

/** A PIN of exactly the configured number of digits, from a CSPRNG. Every digit string of that length is equally likely. */
export function newPin(): string {
  const digits = BAND_SYNC_LIMITS.pinDigits;
  return randomInt(0, 10 ** digits).toString().padStart(digits, "0");
}

/** Compares two strings in constant time. Both are hashed first, so the comparison takes the same time whatever their lengths. */
export function sameSecret(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

export class PinAuth {
  private pin = "";
  private sessions = new Map<string, number>();
  private failures = new Map<string, Failures>();

  constructor(
    private now: () => number = () => Date.now(),
    private makePin: () => string = newPin,
  ) {}

  /** The PIN now in force, or null before the first `rotate`. */
  current(): string | null {
    return this.pin || null;
  }

  /** A new PIN. Every session is ended, so each follower signs in again with the new one. */
  rotate(): string {
    this.pin = this.makePin();
    this.sessions.clear();
    return this.pin;
  }

  /** Ends every session without changing the PIN. */
  endSessions(): void {
    this.sessions.clear();
  }

  /** Signs in with a PIN from an address. A correct PIN is refused while that address is locked out, so a lock cannot be tested. */
  signIn(address: string, attempt: string): SignIn {
    const locked = this.lockedFor(address);
    if (locked > 0) return { ok: false, reason: "locked", retryAfter: locked };
    // Before the first rotate there is no PIN, and an empty attempt must not match the empty string that stands for it.
    if (!this.pin || !sameSecret(attempt, this.pin)) {
      const after = this.recordFailure(address);
      return after > 0 ? { ok: false, reason: "locked", retryAfter: after } : { ok: false, reason: "pin", retryAfter: 0 };
    }
    this.failures.delete(address);
    return { ok: true, token: this.issue() };
  }

  /** Resumes a session from its token. A token that is unknown or expired counts as a failure, like a wrong PIN. */
  resume(address: string, token: string): Resume {
    const locked = this.lockedFor(address);
    if (locked > 0) return { ok: false, reason: "locked", retryAfter: locked };
    const expires = this.sessions.get(token);
    if (expires !== undefined && expires > this.now()) {
      this.failures.delete(address);
      return { ok: true };
    }
    this.sessions.delete(token);
    const after = this.recordFailure(address);
    return after > 0 ? { ok: false, reason: "locked", retryAfter: after } : { ok: false, reason: "token", retryAfter: 0 };
  }

  /** Whether a session token is still good, without counting it as a failure. */
  hasSession(token: string): boolean {
    const expires = this.sessions.get(token);
    return expires !== undefined && expires > this.now();
  }

  private issue(): string {
    const now = this.now();
    if (this.sessions.size >= MAX_SESSIONS) {
      for (const [token, expires] of this.sessions) if (expires <= now) this.sessions.delete(token);
      // Still full: the oldest session goes first.
      if (this.sessions.size >= MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value as string);
    }
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, now + SESSION_MS);
    return token;
  }

  /** Seconds left on a lock-out from this address, or 0 when it may try. */
  private lockedFor(address: string): number {
    const entry = this.failures.get(address);
    if (!entry || entry.lockedUntil <= this.now()) return 0;
    return Math.ceil((entry.lockedUntil - this.now()) / 1000);
  }

  /** Counts a failure. Returns the seconds of the lock-out it starts, or 0 when the address may still try. */
  private recordFailure(address: string): number {
    const now = this.now();
    this.prune(now);
    const entry = this.failures.get(address) ?? { count: 0, windowStart: now, strikes: 0, lockedUntil: 0 };
    if (now - entry.windowStart > LOCKOUT.windowMs) {
      entry.count = 0;
      entry.windowStart = now;
    }
    entry.count += 1;
    this.failures.set(address, entry);
    if (entry.count < LOCKOUT.failures) return 0;
    entry.strikes += 1;
    const span = Math.min(LOCKOUT.maxMs, LOCKOUT.firstMs * 2 ** (entry.strikes - 1));
    entry.lockedUntil = now + span;
    entry.count = 0;
    entry.windowStart = now;
    return Math.ceil(span / 1000);
  }

  /** Forgets addresses that are no longer locked and have no recent failures, so the table stays small. */
  private prune(now: number): void {
    if (this.failures.size < MAX_ADDRESSES) return;
    for (const [address, entry] of this.failures) {
      if (entry.lockedUntil <= now && now - entry.windowStart > LOCKOUT.windowMs) this.failures.delete(address);
    }
  }
}
