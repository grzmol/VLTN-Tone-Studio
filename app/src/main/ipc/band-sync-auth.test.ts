import { describe, expect, it } from "vitest";
import { LOCKOUT, PinAuth, SESSION_MS, newPin, sameSecret } from "./band-sync-auth";

/** An auth with a clock the test moves, and a PIN the test chooses. */
function harness(pins = ["123456"]) {
  let now = 1_000_000;
  let next = 0;
  const auth = new PinAuth(
    () => now,
    () => pins[Math.min(next++, pins.length - 1)],
  );
  return {
    auth,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A failed attempt from one address. */
function miss(auth: PinAuth, address = "10.0.0.9") {
  return auth.signIn(address, "000000");
}

describe("newPin", () => {
  it("is always six digits, zero-padded", () => {
    for (let i = 0; i < 200; i++) expect(newPin()).toMatch(/^\d{6}$/);
  });
});

describe("sameSecret", () => {
  it("is true only for equal text", () => {
    expect(sameSecret("123456", "123456")).toBe(true);
    expect(sameSecret("", "")).toBe(true);
    expect(sameSecret("123456", "123457")).toBe(false);
    expect(sameSecret("123456", "1234567")).toBe(false);
    expect(sameSecret("", "123456")).toBe(false);
  });
});

describe("PinAuth sign-in", () => {
  it("gives a session token for the right PIN", () => {
    const { auth } = harness();
    auth.rotate();
    const result = auth.signIn("10.0.0.5", "123456");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.token.length).toBeGreaterThanOrEqual(40);
  });

  it("refuses a wrong PIN, and reports no lock-out yet", () => {
    const { auth } = harness();
    auth.rotate();
    expect(auth.signIn("10.0.0.5", "654321")).toEqual({ ok: false, reason: "pin", retryAfter: 0 });
  });

  it("refuses an attempt that is not six digits, the same as a wrong one", () => {
    const { auth } = harness();
    auth.rotate();
    expect(auth.signIn("10.0.0.5", "12")).toEqual({ ok: false, reason: "pin", retryAfter: 0 });
  });

  it("has no PIN before the first rotate, so nothing signs in", () => {
    const { auth } = harness();
    expect(auth.current()).toBeNull();
    expect(auth.signIn("10.0.0.5", "")).toEqual({ ok: false, reason: "pin", retryAfter: 0 });
  });

  it("gives a new PIN on each rotate, and the old one stops working", () => {
    const { auth } = harness(["111111", "222222"]);
    auth.rotate();
    expect(auth.signIn("10.0.0.5", "111111").ok).toBe(true);
    auth.rotate();
    expect(auth.current()).toBe("222222");
    expect(auth.signIn("10.0.0.5", "111111")).toMatchObject({ ok: false, reason: "pin" });
    expect(auth.signIn("10.0.0.5", "222222").ok).toBe(true);
  });
});

describe("PinAuth session tokens", () => {
  it("resumes a session from its token", () => {
    const { auth } = harness();
    auth.rotate();
    const result = auth.signIn("10.0.0.5", "123456");
    if (!result.ok) throw new Error("expected a session");
    expect(auth.resume("10.0.0.5", result.token)).toEqual({ ok: true });
    expect(auth.hasSession(result.token)).toBe(true);
  });

  it("ends every session when the PIN changes", () => {
    const { auth } = harness(["123456", "654321"]);
    auth.rotate();
    const result = auth.signIn("10.0.0.5", "123456");
    if (!result.ok) throw new Error("expected a session");
    auth.rotate();
    expect(auth.resume("10.0.0.5", result.token)).toMatchObject({ ok: false, reason: "token" });
  });

  it("ends the sessions without changing the PIN when they are cleared", () => {
    const { auth } = harness();
    auth.rotate();
    const result = auth.signIn("10.0.0.5", "123456");
    if (!result.ok) throw new Error("expected a session");
    auth.endSessions();
    expect(auth.resume("10.0.0.5", result.token)).toMatchObject({ ok: false, reason: "token" });
    expect(auth.current()).toBe("123456");
  });

  it("expires a session after its time", () => {
    const { auth, advance } = harness();
    auth.rotate();
    const result = auth.signIn("10.0.0.5", "123456");
    if (!result.ok) throw new Error("expected a session");
    advance(SESSION_MS - 1);
    expect(auth.resume("10.0.0.5", result.token).ok).toBe(true);
    advance(2);
    expect(auth.resume("10.0.0.5", result.token)).toMatchObject({ ok: false, reason: "token" });
  });

  it("refuses an unknown token as a failure, the same as a wrong PIN", () => {
    const { auth } = harness();
    auth.rotate();
    expect(auth.resume("10.0.0.5", "not-a-session-token-at-all")).toEqual({ ok: false, reason: "token", retryAfter: 0 });
  });
});

describe("PinAuth lock-out", () => {
  it("locks an address after five wrong PINs, for a minute", () => {
    const { auth } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures - 1; i++) expect(miss(auth)).toMatchObject({ reason: "pin" });
    expect(miss(auth)).toEqual({ ok: false, reason: "locked", retryAfter: 60 });
  });

  it("refuses even the right PIN while the address is locked, so the lock cannot be tested", () => {
    const { auth } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures; i++) miss(auth);
    expect(auth.signIn("10.0.0.9", "123456")).toEqual({ ok: false, reason: "locked", retryAfter: 60 });
  });

  it("lets the address try again once the lock has run out", () => {
    const { auth, advance } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures; i++) miss(auth);
    advance(LOCKOUT.firstMs);
    expect(auth.signIn("10.0.0.9", "123456").ok).toBe(true);
  });

  it("doubles each later lock-out", () => {
    const { auth, advance } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures; i++) miss(auth);
    advance(LOCKOUT.firstMs);
    let last = 0;
    for (let i = 0; i < LOCKOUT.failures - 1; i++) miss(auth);
    const second = miss(auth);
    if (second.ok || second.reason !== "locked") throw new Error("expected a second lock-out");
    last = second.retryAfter;
    expect(last).toBe(120);
  });

  it("never locks for longer than the cap, however many lock-outs there have been", () => {
    const { auth, advance } = harness();
    auth.rotate();
    let retry = 0;
    for (let round = 0; round < 12; round++) {
      for (let i = 0; i < LOCKOUT.failures; i++) {
        const result = miss(auth);
        if (!result.ok && result.reason === "locked") retry = result.retryAfter;
      }
      advance(LOCKOUT.maxMs + 1);
    }
    expect(retry).toBeLessThanOrEqual(LOCKOUT.maxMs / 1000);
    expect(retry).toBe(LOCKOUT.maxMs / 1000);
  });

  it("counts failures only within the window, so slow guessing does not lock", () => {
    const { auth, advance } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures - 1; i++) miss(auth);
    advance(LOCKOUT.windowMs + 1);
    for (let i = 0; i < LOCKOUT.failures - 1; i++) expect(miss(auth)).toMatchObject({ reason: "pin" });
  });

  it("forgets earlier failures after a right PIN", () => {
    const { auth } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures - 1; i++) miss(auth);
    expect(auth.signIn("10.0.0.9", "123456").ok).toBe(true);
    for (let i = 0; i < LOCKOUT.failures - 1; i++) expect(miss(auth)).toMatchObject({ reason: "pin" });
  });

  it("locks each address on its own", () => {
    const { auth } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures; i++) miss(auth, "10.0.0.9");
    expect(auth.signIn("10.0.0.10", "123456").ok).toBe(true);
  });

  it("counts a bad session token against the address like a bad PIN", () => {
    const { auth } = harness();
    auth.rotate();
    for (let i = 0; i < LOCKOUT.failures; i++) auth.resume("10.0.0.9", "guess-guess-guess-guess");
    expect(auth.signIn("10.0.0.9", "123456")).toMatchObject({ ok: false, reason: "locked" });
  });
});
