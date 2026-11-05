// @vitest-environment node
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as netConnect, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { AudienceClock, AudienceModel } from "@shared/audience";
import type { FollowerAction } from "@shared/band-sync";
import type { LanAddress } from "@shared/host/band-sync";

vi.mock("electron", () => ({
  app: { getPath: () => "/unused" },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {} },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}), on: () => {}, removeListener: () => {} },
}));

import { BandSyncServer, followerFiles, hostAllowed, isLanAddress, lanAddresses, originHost, parseSettings, parseStartOptions } from "./band-sync";

const MODEL: AudienceModel = {
  songKey: "A",
  screen: "lyrics",
  blackout: false,
  blackBetweenSongs: false,
  title: "Test song",
  nextTitle: null,
  timed: true,
  lines: [{ time: 0, heading: null, text: "Hello", chords: ["A"] }],
  showChords: true,
  fontScale: 1,
  rotation: 0,
  pdf: null,
};
const CLOCK: AudienceClock = { songKey: "A", songPosition: 3, at: 1_000, rate: 1, playing: true };

let root: string;
let outside: string;

beforeAll(async () => {
  // A build folder with the follower page, the files it loads (one of them through an import), and a file it does not load.
  const base = await mkdtemp(join(tmpdir(), "band-sync-test-"));
  root = join(base, "renderer");
  outside = join(base, "outside.txt");
  await mkdir(join(root, "assets"), { recursive: true });
  await writeFile(outside, "OUTSIDE THE BUILD");
  await writeFile(join(root, "follower.html"), '<!doctype html><script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">');
  await writeFile(join(root, "assets", "app.js"), 'import "./chunk.js";\nconsole.log("follower");');
  await writeFile(join(root, "assets", "chunk.js"), "export const shared = 1;");
  await writeFile(join(root, "assets", "app.css"), "body { margin: 0; }");
  await writeFile(join(root, "assets", "unlisted.js"), "console.log('not referenced');");
  await writeFile(join(root, "band-sync.json"), '{"secret":true}');
});

afterAll(async () => {
  await rm(join(root, ".."), { recursive: true, force: true });
});

/** A server with a recording control hook, and the test's own cleanup. */
const servers: BandSyncServer[] = [];
function serverWith(overrides: { onControl?: (action: FollowerAction) => void; now?: () => number } = {}) {
  const controls: FollowerAction[] = [];
  const server = new BandSyncServer({
    root,
    now: overrides.now,
    onControl: (action) => {
      controls.push(action);
      overrides.onControl?.(action);
    },
    onChange: () => {},
  });
  servers.push(server);
  return { server, controls };
}
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

/** Starts a server on a free loopback port and returns its address and PIN. */
async function started(allowControl = false, server = serverWith().server) {
  await server.start("127.0.0.1", 0, allowControl);
  const snapshot = server.snapshot();
  return { server, port: snapshot.port, pin: snapshot.pin as string };
}

interface Inbox {
  messages: Record<string, unknown>[];
  close: Promise<number>;
}

/** Opens a socket and collects what the server sends. Resolves once the socket is open; rejects when the server refuses the upgrade. */
function connect(port: number, options: { origin?: string; path?: string } = {}): Promise<{ ws: WebSocket; inbox: Inbox }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${options.path ?? "/ws"}`, options.origin ? { origin: options.origin } : undefined);
  const messages: Record<string, unknown>[] = [];
  ws.on("message", (data) => messages.push(JSON.parse(data.toString()) as Record<string, unknown>));
  ws.on("error", () => {});
  const close = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, inbox: { messages, close } }));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`refused with ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

/** Waits until the inbox holds a message of this type, and returns it. */
async function until(inbox: Inbox, type: string, ms = 2000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = inbox.messages.find((message) => message.type === type);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`no ${type} message; got ${JSON.stringify(inbox.messages)}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Signs in with a PIN and returns the socket, once the server has said hello. */
async function signedIn(port: number, pin: string) {
  const { ws, inbox } = await connect(port);
  ws.send(JSON.stringify({ type: "hello", pin }));
  await until(inbox, "hello");
  return { ws, inbox };
}

describe("the follower page", () => {
  it("serves the page with a strict content security policy", async () => {
    const { port } = await started();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toContain("/assets/app.js");
  });

  it("serves the files the page loads, including the ones it imports", async () => {
    const { port } = await started();
    expect((await fetch(`http://127.0.0.1:${port}/assets/app.js`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/assets/chunk.js`)).status).toBe(200);
    const css = await fetch(`http://127.0.0.1:${port}/assets/app.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("does not serve a file in the build that the page does not load", async () => {
    const { port } = await started();
    expect((await fetch(`http://127.0.0.1:${port}/assets/unlisted.js`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/band-sync.json`)).status).toBe(404);
  });

  it("refuses path traversal: nothing outside the build is ever served", async () => {
    const { port } = await started();
    const paths = [
      "/../outside.txt",
      "/%2e%2e/outside.txt",
      "/..%2foutside.txt",
      "/%2e%2e%2foutside.txt",
      "/assets/../../outside.txt",
      "/assets/%2e%2e/%2e%2e/outside.txt",
      "//etc/passwd",
      "/assets/app.js%00.txt",
      "/.env",
      "/follower.html",
      "/index.html",
    ];
    for (const path of paths) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const body = await res.text();
      expect([400, 404], path).toContain(res.status);
      expect(body, path).not.toContain("OUTSIDE");
    }
  });

  it("refuses methods other than GET and HEAD, and answers HEAD without a body", async () => {
    const { port } = await started();
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: "x" })).status).toBe(405);
    const head = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("will not start without the follower page in the build", async () => {
    const server = serverWith().server;
    server.stop();
    const missing = new BandSyncServer({ root: join(root, "nowhere"), onControl: () => {}, onChange: () => {} });
    servers.push(missing);
    await expect(missing.start("127.0.0.1", 0, false)).rejects.toThrow(/not in this build/);
    expect(missing.listening).toBe(false);
  });
});

describe("followerFiles", () => {
  it("lists the page and what it loads, by path", async () => {
    const files = await followerFiles(root);
    expect([...files.keys()].sort()).toEqual(["/", "/assets/app.css", "/assets/app.js", "/assets/chunk.js"]);
  });

  it("refuses a page that loads a file outside the build", async () => {
    const bad = join(root, "..", "escape");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "follower.html"), '<script src="../../outside.txt"></script>');
    await expect(followerFiles(bad)).rejects.toThrow();
  });

  it("refuses a page that loads another page", async () => {
    const bad = join(root, "..", "pages");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "follower.html"), '<script src="./other.html"></script>');
    await writeFile(join(bad, "other.html"), "<p>other</p>");
    await expect(followerFiles(bad)).rejects.toThrow(/incomplete/);
  });
});

describe("starting and stopping", () => {
  it("is off until started, and shows no PIN", () => {
    const { server } = serverWith();
    expect(server.listening).toBe(false);
    expect(server.snapshot()).toEqual({ listening: false, address: null, port: 0, pin: null, followers: 0 });
  });

  it("gives a six-digit PIN each time it starts", async () => {
    const { server } = serverWith();
    const first = await started(false, server);
    expect(first.pin).toMatch(/^\d{6}$/);
    server.stop();
    const second = await started(false, server);
    expect(second.pin).toMatch(/^\d{6}$/);
    expect(server.snapshot().listening).toBe(true);
  });

  it("refuses to start twice, and a port that is in use", async () => {
    const { server } = serverWith();
    await started(false, server);
    await expect(server.start("127.0.0.1", 0, false)).rejects.toThrow(/already on/);
    const other = serverWith().server;
    await expect(other.start("127.0.0.1", server.snapshot().port, false)).rejects.toThrow(/already in use/);
  });

  it("tells every follower when it stops, and ends their sessions", async () => {
    const { server, port, pin } = await started();
    const { inbox } = await signedIn(port, pin);
    server.stop();
    expect(await until(inbox, "closing")).toEqual({ type: "closing", reason: "stopped" });
    expect(await inbox.close).toBe(1001);
    expect(server.listening).toBe(false);
  });

  it("ends a session and disconnects the followers when the PIN changes", async () => {
    const { server, port, pin } = await started();
    const { inbox, ws } = await signedIn(port, pin);
    const hello = inbox.messages.find((message) => message.type === "hello") as { token: string };
    server.rotatePin();
    expect(await until(inbox, "closing")).toEqual({ type: "closing", reason: "pin-changed" });
    expect(await inbox.close).toBe(1008);
    ws.close();
    const withToken = await connect(port);
    withToken.ws.send(JSON.stringify({ type: "hello", token: hello.token }));
    expect(await until(withToken.inbox, "refused")).toMatchObject({ reason: "token" });
    // The old PIN is no good either. The server closes a refused socket, so the PIN goes on a new one.
    const withPin = await connect(port);
    withPin.ws.send(JSON.stringify({ type: "hello", pin }));
    expect(await until(withPin.inbox, "refused")).toMatchObject({ reason: "pin" });
  });
});

describe("signing in", () => {
  it("refuses a wrong PIN, and closes that connection", async () => {
    const { port, pin } = await started();
    const wrong = pin === "000000" ? "111111" : "000000";
    const { ws, inbox } = await connect(port);
    ws.send(JSON.stringify({ type: "hello", pin: wrong }));
    expect(await until(inbox, "refused")).toEqual({ type: "refused", reason: "pin", retryAfter: 0 });
    expect(await inbox.close).toBe(1008);
  });

  it("gives the followers a session, and the song as it stands", async () => {
    const { server, port, pin } = await started();
    server.publish({ model: MODEL, clock: CLOCK });
    const { inbox } = await signedIn(port, pin);
    expect(inbox.messages.find((m) => m.type === "hello")).toMatchObject({ protocol: 1, controlAllowed: false });
    expect(await until(inbox, "song")).toMatchObject({ type: "song", model: { title: "Test song" } });
    expect(await until(inbox, "state")).toEqual({ type: "state", clock: CLOCK });
  });

  it("keeps the song while the sync is off, so a sync started mid-song has it at once", async () => {
    const { server } = await started();
    server.stop();
    server.publish({ model: MODEL, clock: CLOCK });
    const { port, pin } = await started(false, server);
    const { inbox } = await signedIn(port, pin);
    expect(await until(inbox, "song")).toMatchObject({ model: { title: "Test song" } });
  });

  it("sends a published change to the followers signed in", async () => {
    const { server, port, pin } = await started();
    const { inbox } = await signedIn(port, pin);
    server.publish({ model: null, clock: { ...CLOCK, songPosition: 9 } });
    expect(await until(inbox, "state")).toMatchObject({ clock: { songPosition: 9 } });
  });

  it("refuses the lock-out after five wrong PINs, and does not check the right one while locked", async () => {
    const { port, pin } = await started();
    const wrong = pin === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const { ws, inbox } = await connect(port);
      ws.send(JSON.stringify({ type: "hello", pin: wrong }));
      await until(inbox, "refused");
    }
    const { ws, inbox } = await connect(port);
    ws.send(JSON.stringify({ type: "hello", pin }));
    const refused = await until(inbox, "refused");
    expect(refused).toMatchObject({ reason: "locked" });
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
  });

  it("refuses a sign-in with a token it does not know", async () => {
    const { port } = await started();
    const { ws, inbox } = await connect(port);
    ws.send(JSON.stringify({ type: "hello", token: "unknown-session-token-0123456789" }));
    expect(await until(inbox, "refused")).toMatchObject({ reason: "token" });
  });

  it("lets a follower resume with its token after a dropped connection", async () => {
    const { port, pin } = await started();
    const first = await signedIn(port, pin);
    const token = (first.inbox.messages.find((m) => m.type === "hello") as { token: string }).token;
    first.ws.close();
    const again = await connect(port);
    again.ws.send(JSON.stringify({ type: "hello", token }));
    expect(await until(again.inbox, "hello")).toMatchObject({ token });
  });

  it("refuses a sign-in when the room is full", async () => {
    const { port, pin } = await started();
    const sockets = [];
    for (let i = 0; i < 8; i++) sockets.push(await signedIn(port, pin));
    const { ws, inbox } = await connect(port);
    ws.send(JSON.stringify({ type: "hello", pin }));
    expect(await until(inbox, "refused")).toMatchObject({ reason: "full" });
    for (const socket of sockets) socket.ws.close();
  });

  it("caps the connections that have not signed in", async () => {
    const { port } = await started();
    const pending = [];
    for (let i = 0; i < 8; i++) pending.push((await connect(port)).ws);
    const ninth = await connect(port);
    expect(await ninth.inbox.close).toBe(1013);
    for (const socket of pending) socket.close();
  });

  it("refuses a page on another site that tries to open the socket", async () => {
    const { port } = await started();
    await expect(connect(port, { origin: "http://evil.example" })).rejects.toThrow(/403/);
    const same = await connect(port, { origin: `http://127.0.0.1:${port}` });
    same.ws.close();
  });

  it("refuses a request or socket whose Host is not the address and port it listens on", async () => {
    const { port, pin } = await started();
    const ask = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const socket = netConnect(port, "127.0.0.1", () => socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
        let reply = "";
        socket.on("data", (chunk) => (reply += chunk.toString()));
        socket.on("close", () => resolve(Number(/^HTTP\/1\.1 (\d+)/.exec(reply)?.[1])));
        socket.on("error", reject);
      });
    expect(await ask(`127.0.0.1:${port}`)).toBe(200);
    expect(await ask(`rebind.example:${port}`)).toBe(403);
    expect(await ask("127.0.0.1")).toBe(403);
    expect(await ask(`127.0.0.1:${port + 1}`)).toBe(403);
    const good = await signedIn(port, pin);
    good.ws.close();
    const bad = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: `rebind.example:${port}` } });
    const status = await new Promise<number>((resolve) => {
      bad.on("error", () => {});
      bad.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    });
    expect(status).toBe(403);
  });

  it("checks a Host header exactly", () => {
    expect(hostAllowed("10.0.0.5:5790", "10.0.0.5", 5790)).toBe(true);
    expect(hostAllowed("10.0.0.5", "10.0.0.5", 5790)).toBe(false);
    expect(hostAllowed("10.0.0.5", "10.0.0.5", 80)).toBe(true);
    expect(hostAllowed("10.0.0.5:80", "10.0.0.5", 80)).toBe(true);
    expect(hostAllowed("evil.example:5790", "10.0.0.5", 5790)).toBe(false);
    expect(hostAllowed("10.0.0.5:5790.evil.example", "10.0.0.5", 5790)).toBe(false);
    expect(hostAllowed(undefined, "10.0.0.5", 5790)).toBe(false);
    expect(hostAllowed("10.0.0.5:5790", null, 5790)).toBe(false);
  });

  it("refuses an Origin of null, the value sandboxed and file pages send", async () => {
    const { port } = await started();
    await expect(connect(port, { origin: "null" })).rejects.toThrow(/403/);
  });

  it("refuses an Origin that is not a URL, and the server keeps running", async () => {
    const { port, pin } = await started();
    await expect(connect(port, { origin: "::::" })).rejects.toThrow(/403/);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
    await signedIn(port, pin);
  });

  it("parses an Origin without ever throwing", () => {
    expect(originHost("http://127.0.0.1:8787")).toBe("127.0.0.1:8787");
    expect(originHost("null")).toBeNull();
    expect(originHost("::::")).toBeNull();
    expect(originHost("")).toBeNull();
    expect(originHost(undefined)).toBeNull();
    expect(originHost(["http://a"])).toBeNull();
  });

  it("survives a client that resets the connection in the middle of the handshake", async () => {
    const { port, pin } = await started();
    // A complete upgrade request, then a reset: the server's upgrade handler is running when the socket errors.
    const raw: Socket = netConnect(port, "127.0.0.1");
    await new Promise((resolve) => raw.once("connect", resolve));
    const handshake = [
      "GET /ws HTTP/1.1",
      "Host: 127.0.0.1",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
    ];
    raw.write(handshake.join("\r\n") + "\r\n\r\n");
    raw.resetAndDestroy();
    // A request cut off part-way, reset as well.
    const partial: Socket = netConnect(port, "127.0.0.1");
    await new Promise((resolve) => partial.once("connect", resolve));
    partial.write("GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpg");
    partial.resetAndDestroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
    const { inbox } = await signedIn(port, pin);
    expect(inbox.messages.some((m) => m.type === "hello")).toBe(true);
  });

  it("closes a malformed HTTP request on its own, and the server keeps serving", async () => {
    const { port } = await started();
    const garbage: Socket = netConnect(port, "127.0.0.1");
    await new Promise((resolve) => garbage.once("connect", resolve));
    garbage.on("error", () => {});
    garbage.resume();
    garbage.write("\x00\x01 not http at all\r\n\r\n");
    await new Promise((resolve) => garbage.once("close", resolve));
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(200);
  });

  it("refuses a socket path that is not the sync's", async () => {
    const { port } = await started();
    await expect(connect(port, { path: "/elsewhere" })).rejects.toThrow(/404/);
  });

  it("refuses everything but a sign-in before the follower has signed in", async () => {
    const { port } = await started();
    const { ws, inbox } = await connect(port);
    ws.send(JSON.stringify({ type: "ping", seq: 0, t0: 1 }));
    expect(await until(inbox, "error")).toEqual({ type: "error", message: "Sign in first." });
  });
});

describe("messages from a signed-in follower", () => {
  it("answers a ping with the server's two times", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "ping", seq: 4, t0: 123.5 }));
    const pong = await until(inbox, "pong");
    expect(pong).toMatchObject({ seq: 4, t0: 123.5 });
    expect(Number(pong.t1)).toBeLessThanOrEqual(Number(pong.t2));
  });

  it("accepts a frame just under the limit", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "ping", seq: 1, t0: 1, pad: "x".repeat(3500) }));
    expect(await until(inbox, "pong")).toMatchObject({ seq: 1 });
  });

  it("closes a connection that sends a frame over the limit", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "ping", seq: 1, t0: 1, pad: "x".repeat(6000) }));
    expect(await inbox.close).toBe(1009);
  });

  it("answers each message it cannot use, and closes the connection after a few", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "loadSong" }));
    ws.send(JSON.stringify({ type: "control", action: "transport.panic" }));
    ws.send(JSON.stringify({ type: "hello" }));
    expect(await inbox.close).toBe(1008);
    expect(inbox.messages.filter((m) => m.type === "error").length).toBe(3);
  });

  it("closes a peer that sends a frame that is not JSON, and leaves the other followers alone", async () => {
    const { port, pin } = await started();
    const bad = await signedIn(port, pin);
    const good = await signedIn(port, pin);
    bad.ws.send("{not json");
    expect(await bad.inbox.close).toBe(1008);
    good.ws.send(JSON.stringify({ type: "ping", seq: 7, t0: 1 }));
    expect(await until(good.inbox, "pong")).toMatchObject({ seq: 7 });
  });

  it("refuses a binary frame", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await until(inbox, "error")).toEqual({ type: "error", message: "Messages must be text." });
  });

  it("refuses a second sign-in on a connection that is already signed in", async () => {
    const { port, pin } = await started();
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "hello", pin }));
    expect(await until(inbox, "error")).toEqual({ type: "error", message: "Already signed in." });
  });

  it("passes no control on while remote control is off", async () => {
    const { port, pin, server } = await started(false);
    const { ws, inbox } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "control", action: "transport.stop" }));
    expect(await until(inbox, "error")).toEqual({ type: "error", message: "Remote control is off." });
    expect(server.snapshot().listening).toBe(true);
  });

  it("passes a transport action on to the performer's app while remote control is on", async () => {
    const { server, controls } = serverWith();
    const { port, pin } = await started(true, server);
    const { ws } = await signedIn(port, pin);
    ws.send(JSON.stringify({ type: "control", action: "transport.playPause" }));
    await vi.waitFor(() => expect(controls).toEqual(["transport.playPause"]));
  });

  it("tells signed-in followers at once when remote control is switched, and enforces it on the next command", async () => {
    const { server, controls } = serverWith();
    const { port, pin } = await started(false, server);
    const { ws, inbox } = await signedIn(port, pin);
    const waiting = await connect(port);
    server.setAllowControl(true);
    await vi.waitFor(() => expect(inbox.messages).toContainEqual({ type: "control-allowed", allowed: true }));
    expect(waiting.inbox.messages).toEqual([]);
    ws.send(JSON.stringify({ type: "control", action: "transport.play" }));
    await vi.waitFor(() => expect(controls).toEqual(["transport.play"]));
    server.setAllowControl(false);
    await vi.waitFor(() => expect(inbox.messages).toContainEqual({ type: "control-allowed", allowed: false }));
    ws.send(JSON.stringify({ type: "control", action: "transport.stop" }));
    expect(await until(inbox, "error")).toEqual({ type: "error", message: "Remote control is off." });
    expect(controls).toEqual(["transport.play"]);
  });

  it("limits how many controls a follower can send each second", async () => {
    const { server, controls } = serverWith();
    const { port, pin } = await started(true, server);
    const { ws, inbox } = await signedIn(port, pin);
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ type: "control", action: "transport.play" }));
    await vi.waitFor(() => expect(inbox.messages.some((m) => m.type === "error")).toBe(true));
    expect(controls.length).toBe(4);
    expect(inbox.messages.find((m) => m.type === "error")).toEqual({ type: "error", message: "Too many controls. Wait a moment." });
  });
});

/** A socket that takes messages but never finishes a close handshake, like a client that ignores the close frame. */
class StubbornSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  closeCalls: number[] = [];
  terminated = false;
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close(code: number) {
    this.closeCalls.push(code);
  }
  terminate() {
    this.terminated = true;
  }
  say(message: object) {
    this.emit("message", Buffer.from(JSON.stringify(message)), false);
  }
}

describe("a follower that ignores the close frame", () => {
  async function stubbornFollower(allowControl: boolean) {
    const { server, controls } = serverWith();
    const { pin } = await started(allowControl, server);
    const socket = new StubbornSocket();
    (server as unknown as { accept(socket: unknown, address: string): void }).accept(socket, "10.0.0.9");
    socket.say({ type: "hello", pin });
    expect(socket.sent[0]).toMatchObject({ type: "hello" });
    return { server, controls, socket, pin };
  }

  it("is cut off after a new PIN, and cannot control anything meanwhile", async () => {
    vi.useFakeTimers();
    try {
      const { server, controls, socket } = await stubbornFollower(true);
      server.rotatePin();
      expect(socket.sent.at(-1)).toEqual({ type: "closing", reason: "pin-changed" });
      expect(socket.closeCalls).toEqual([1008]);
      expect(server.snapshot().followers).toBe(0);
      socket.say({ type: "control", action: "transport.stop" });
      expect(controls).toEqual([]);
      vi.advanceTimersByTime(1000);
      expect(socket.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is cut off when the sync stops", async () => {
    vi.useFakeTimers();
    try {
      const { server, socket } = await stubbornFollower(false);
      server.stop();
      expect(socket.sent.at(-1)).toEqual({ type: "closing", reason: "stopped" });
      vi.advanceTimersByTime(1000);
      expect(socket.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not terminated if it does close in time", async () => {
    vi.useFakeTimers();
    try {
      const { server, socket } = await stubbornFollower(false);
      server.rotatePin();
      socket.emit("close");
      vi.advanceTimersByTime(1000);
      expect(socket.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("LAN addresses", () => {
  it("accepts private IPv4 addresses only", () => {
    for (const address of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20"]) expect(isLanAddress(address)).toBe(true);
    for (const address of ["172.15.0.1", "172.32.0.1", "8.8.8.8", "169.254.10.1", "100.64.0.1", "127.0.0.1", "256.1.1.1", "fe80::1", "example.com"]) {
      expect(isLanAddress(address)).toBe(false);
    }
  });

  it("lists this computer's private addresses with their interface names", () => {
    const interfaces = {
      en0: [
        { address: "192.168.1.20", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      utun3: [{ address: "100.100.1.2", family: "IPv4", internal: false }],
      en1: [{ address: "203.0.113.7", family: "IPv4", internal: false }],
    } as unknown as Parameters<typeof lanAddresses>[0];
    expect(lanAddresses(interfaces)).toEqual([{ address: "192.168.1.20", name: "en0" }]);
  });

  it("checks a start request against the list and the port", () => {
    const list: LanAddress[] = [{ address: "192.168.1.20", name: "en0" }];
    expect(parseStartOptions({ address: "192.168.1.20", port: 8787, allowControl: false }, list)).toEqual({
      address: "192.168.1.20",
      port: 8787,
      allowControl: false,
    });
    expect(() => parseStartOptions({ address: "0.0.0.0", port: 8787, allowControl: false }, list)).toThrow(/from the list/);
    expect(() => parseStartOptions({ address: "192.168.1.20", port: 80, allowControl: false }, list)).toThrow(/Choose a port/);
    expect(() => parseStartOptions({ address: "192.168.1.20", port: 8787, allowControl: "yes" }, list)).toThrow(/on or off/);
    expect(() => parseStartOptions(null, list)).toThrow();
  });

  it("reads saved settings, and falls back to the defaults for anything damaged", () => {
    expect(parseSettings({ address: "192.168.1.9", port: 9000, allowControl: true })).toEqual({ address: "192.168.1.9", port: 9000, allowControl: true });
    expect(parseSettings({ address: "8.8.8.8", port: 80, allowControl: "yes" })).toEqual({ address: null, port: 8787, allowControl: false });
    expect(parseSettings("damaged")).toEqual({ address: null, port: 8787, allowControl: false });
  });
});
