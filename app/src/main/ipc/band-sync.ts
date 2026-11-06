import { app, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { Duplex } from "node:stream";
import { join, resolve, sep } from "node:path";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { WebSocket, WebSocketServer } from "ws";
import { mergeAudienceState, type AudienceState, type AudienceUpdate } from "@shared/audience";
import {
  BAND_SYNC_LIMITS,
  BAND_SYNC_PROTOCOL,
  isFollowerAction,
  parseClientMessage,
  parseSyncPort,
  type ClientMessage,
  type FollowerAction,
  type ServerMessage,
} from "@shared/band-sync";
import type { BandSyncOptions, BandSyncStatus, LanAddress } from "@shared/host/band-sync";
import { HostError } from "@shared/ipc";
import { PinAuth } from "./band-sync-auth";
import { handle, sendTo } from "./handle";
import { onAudiencePublish } from "./display";
import { serial, writeJsonAtomic } from "./fs-atomic";

// Band sync (spec 44). Off until the performer starts it. The server listens on one private LAN address the performer picks, serves the
// follower page from a fixed list of built files, and speaks JSON over a WebSocket. It is not encrypted: the PIN is the only protection,
// so the page says so. Followers can only read the audience model and clock (spec 43) and, if the performer allows it, send transport
// actions. Those actions go to the performance screen, which runs them through the same registry as a bound key (spec 31).

const SETTINGS_FILE = "band-sync.json";
const FOLLOWER_PAGE = "follower.html";
const SOCKET_PATH = "/ws";
/** Sent with every page and file. The follower page runs its own script and styles, and talks only to its own origin. */
const FOLLOWER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");
const SECURITY_HEADERS = {
  "Content-Security-Policy": FOLLOWER_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
} as const;
/** Control messages are counted over this window. */
const CONTROL_WINDOW_MS = 1000;
/** A dropped follower gets this long to take the closing message and close frame before its socket is terminated. */
const CLOSE_GRACE_MS = 250;
/** The content types of the files a follower page can load. Anything else is refused when the files are read. */
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** The files a follower page loads, by the path it asks for. Built once at start; no request ever reaches the file system. */
export interface FollowerFile {
  body: Buffer;
  type: string;
}

/** The full list of served paths: `/` is the page, and the rest are the files it loads (scripts, styles, fonts). */
export type FollowerFiles = Map<string, FollowerFile>;

/** Only the assets a page references are served. A reference that leaves the build folder is refused, as is any file that is not in it. */
export async function followerFiles(root: string): Promise<FollowerFiles> {
  const files: FollowerFiles = new Map();
  const base = resolve(root);
  const load = async (relative: string): Promise<Buffer> => {
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep)) throw new Error("outside the build");
    return readFile(file);
  };
  const html = (await load(FOLLOWER_PAGE)).toString("utf8");
  files.set("/", { body: Buffer.from(html), type: TYPES[".html"] });
  const queue: string[] = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) queue.push(new URL(match[1], "http://band.sync/").pathname);
  while (queue.length) {
    const path = queue.shift() as string;
    if (files.has(path)) continue;
    const relative = path.replace(/^\/+/, "");
    const extension = relative.slice(relative.lastIndexOf("."));
    const type = TYPES[extension];
    if (!type || extension === ".html") throw new HostError("unsupported", "The follower page is incomplete. Build the app and try again.");
    const body = await load(relative);
    files.set(path, { body, type });
    if (extension === ".js") {
      for (const match of body.toString("utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+|\/[^"']+)["']/g)) {
        queue.push(new URL(match[1], `http://band.sync${path}`).pathname);
      }
    }
    if (extension === ".css") {
      for (const match of body.toString("utf8").matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) queue.push(new URL(match[1], `http://band.sync${path}`).pathname);
    }
  }
  return files;
}

/** An IPv4 address on a private network: 10/8, 172.16/12 or 192.168/16. Link-local, carrier-grade and public addresses are not. */
export function isLanAddress(address: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second] = octets;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/**
 * The host (and port) an Origin header names, or null when it is missing, the literal `null` that sandboxed and file pages send, or not a
 * URL at all. It never throws: a bad Origin is a refused connection, not an error in the app's main process.
 */
export function originHost(origin: unknown): string | null {
  if (typeof origin !== "string") return null;
  try {
    return new URL(origin).host || null;
  } catch {
    return null;
  }
}

/**
 * Whether a Host header names this server: exactly `address:port`, or the bare address when the port is 80. Anything else, such as a
 * name that a hostile page has pointed at this address (DNS rebinding), is refused, so only a page opened by the address can talk to it.
 */
export function hostAllowed(host: unknown, address: string | null, port: number): boolean {
  if (typeof host !== "string" || !address) return false;
  return host === `${address}:${port}` || (port === 80 && host === address);
}

/** The private IPv4 addresses on this computer, with their interface names. Loopback and public addresses are never listed. */
export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): LanAddress[] {
  const found: LanAddress[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal || !isLanAddress(info.address)) continue;
      found.push({ address: info.address, name });
    }
  }
  return found;
}

/** The part of the server the performance screen sees. */
export interface BandSyncSnapshot {
  listening: boolean;
  address: string | null;
  port: number;
  pin: string | null;
  followers: number;
}

export interface BandSyncServerOptions {
  /** The renderer build folder, which holds the follower page. */
  root: string;
  now?: () => number;
  /** A follower asked for a transport action, and the server allows it. */
  onControl(action: FollowerAction): void;
  /** Followers came or went, or the listening state changed. */
  onChange(): void;
}

/** One connection. It is unsigned until it sends a PIN or a token that the server accepts. */
interface Peer {
  socket: WebSocket;
  address: string;
  signedIn: boolean;
  timer: NodeJS.Timeout | null;
  refused: number;
  controls: number[];
}

/**
 * The band sync server. It keeps the latest model and clock (the same state the audience window keeps), so a follower who signs in
 * late is sent the song at once. Nothing it does can reach the audio: the only thing it passes on is a checked transport action.
 */
export class BandSyncServer {
  private http: Server | null = null;
  private socketServer: WebSocketServer | null = null;
  private files: FollowerFiles = new Map();
  private auth: PinAuth;
  private peers = new Set<Peer>();
  private state: AudienceState = { model: null, clock: null };
  private address: string | null = null;
  private port = 0;
  private allowControl = false;

  constructor(private options: BandSyncServerOptions) {
    this.auth = new PinAuth(options.now);
  }

  get listening(): boolean {
    return this.http !== null;
  }

  snapshot(): BandSyncSnapshot {
    const signedIn = [...this.peers].filter((peer) => peer.signedIn).length;
    return { listening: this.listening, address: this.address, port: this.port, pin: this.listening ? this.auth.current() : null, followers: signedIn };
  }

  /**
   * Starts listening on `address` (which the caller has checked is a LAN address) and `port`. Port 0 picks a free port, for tests.
   * A new PIN is made for every start, so a PIN written down last time does not work.
   */
  async start(address: string, port: number, allowControl: boolean): Promise<void> {
    if (this.http) throw new HostError("invalid", "Band sync is already on.");
    this.files = await followerFiles(this.options.root).catch(() => {
      throw new HostError("unsupported", "The follower page is not in this build. Build the app first.");
    });
    const http = createServer((req, res) => this.serve(req, res));
    http.maxConnections = 64;
    const socketServer = new WebSocketServer({ noServer: true, maxPayload: BAND_SYNC_LIMITS.frameBytes, perMessageDeflate: false });
    http.on("upgrade", (req, socket, head) => this.upgrade(req, socket, head, socketServer));
    // A malformed request, or a connection the client resets, closes only that connection. Nothing here may reach the main process.
    http.on("clientError", (error, socket) => {
      this.log("client", error);
      socket.on("error", () => socket.destroy());
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      else socket.destroy();
    });
    http.on("error", (error) => this.log("server", error));
    socketServer.on("error", (error) => this.log("socket server", error));
    await new Promise<void>((resolve, reject) => {
      const fail = (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE") reject(new HostError("invalid", `Port ${port} is already in use. Choose another port.`));
        else if (e.code === "EADDRNOTAVAIL") reject(new HostError("invalid", "That network address is no longer on this computer. Choose another."));
        else reject(new HostError("internal", e.message));
      };
      http.once("error", fail);
      http.listen(port, address, () => {
        http.off("error", fail);
        resolve();
      });
    });
    const bound = http.address();
    this.port = typeof bound === "object" && bound ? bound.port : port;
    this.address = address;
    this.allowControl = allowControl;
    this.http = http;
    this.socketServer = socketServer;
    this.auth.rotate();
    this.options.onChange();
  }

  /** Stops listening. Every follower is told the sync stopped, and every session ends. */
  stop(): void {
    if (!this.http) return;
    this.dropAll({ type: "closing", reason: "stopped" }, 1001, "stopped");
    this.auth.endSessions();
    this.socketServer?.close();
    this.http.close();
    this.http.closeAllConnections();
    this.http = null;
    this.socketServer = null;
    this.address = null;
    this.options.onChange();
  }

  /** A new PIN. Every follower is disconnected and must sign in again with it. */
  rotatePin(): void {
    if (!this.http) return;
    this.dropAll({ type: "closing", reason: "pin-changed" }, 1008, "pin changed");
    this.auth.rotate();
    this.options.onChange();
  }

  /**
   * Ends every connection now. The peers leave the set first, so nothing they send afterwards is heard. The closing message is sent,
   * the close handshake is started and the socket is terminated shortly after, because a client that ignores the close frame would
   * otherwise keep its connection until the library's own timeout (30 seconds).
   */
  private dropAll(closing: ServerMessage, code: number, reason: string): void {
    const dropped = [...this.peers];
    this.peers.clear();
    for (const peer of dropped) {
      if (peer.timer) clearTimeout(peer.timer);
      peer.timer = null;
      if (peer.signedIn) this.send(peer, closing);
      peer.signedIn = false;
      peer.socket.close(code, reason);
      // The closing message and close frame get a moment to leave. A client that does not answer is then cut off.
      const cutOff = setTimeout(() => peer.socket.terminate(), CLOSE_GRACE_MS);
      cutOff.unref();
      peer.socket.once("close", () => clearTimeout(cutOff));
    }
  }

  /** The performer flipped "allow control". Every signed-in follower is told at once; the next command is checked against it. */
  setAllowControl(allowControl: boolean): void {
    this.allowControl = allowControl;
    for (const peer of this.peers) {
      if (peer.signedIn) this.send(peer, { type: "control-allowed", allowed: allowControl });
    }
  }

  /**
   * The audience model and clock from the performance screen. It is kept even while band sync is off, so a sync that starts during a
   * song has the song at once. Signed-in followers get the change as it happens.
   */
  publish(update: AudienceUpdate): void {
    this.state = mergeAudienceState(this.state, update);
    if (!this.http) return;
    const signedIn = [...this.peers].filter((peer) => peer.signedIn);
    if (!signedIn.length) return;
    if (update.model) this.broadcast(signedIn, { type: "song", model: update.model });
    if (update.clock) this.broadcast(signedIn, { type: "state", clock: update.clock });
  }

  private broadcast(peers: Peer[], message: ServerMessage): void {
    // Serialised once for every follower. A stalled socket is dropped rather than queued for.
    const text = JSON.stringify(message);
    for (const peer of peers) {
      if (peer.socket.bufferedAmount > BAND_SYNC_LIMITS.queuedBytes) {
        peer.socket.terminate();
        continue;
      }
      peer.socket.send(text);
    }
  }

  private send(peer: Peer, message: ServerMessage): void {
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(JSON.stringify(message));
  }

  private serve(req: IncomingMessage, res: ServerResponse): void {
    try {
      this.answer(req, res);
    } catch (error) {
      this.log("request", error);
      res.destroy();
    }
  }

  private answer(req: IncomingMessage, res: ServerResponse): void {
    if (!hostAllowed(req.headers.host, this.address, this.port)) {
      res.writeHead(403, SECURITY_HEADERS).end();
      return;
    }
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" }).end();
      return;
    }
    let path: string;
    try {
      path = new URL(req.url ?? "/", "http://band.sync").pathname;
    } catch {
      res.writeHead(400, SECURITY_HEADERS).end();
      return;
    }
    const file = this.files.get(path);
    if (!file) {
      res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    // The page itself is never cached, so a new build is picked up. Its files have hashed names, so they can be kept.
    const cache = path === "/" ? {} : { "Cache-Control": "public, max-age=86400" };
    res.writeHead(200, { ...SECURITY_HEADERS, ...cache, "Content-Type": file.type, "Content-Length": file.body.length });
    res.end(head ? undefined : file.body);
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, socketServer: WebSocketServer): void {
    // A client that resets the connection during the handshake raises an error on the raw socket. Without a listener that is fatal.
    socket.on("error", () => socket.destroy());
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    try {
      if (!hostAllowed(req.headers.host, this.address, this.port)) return refuse("403 Forbidden");
      let path: string;
      try {
        path = new URL(req.url ?? "/", "http://band.sync").pathname;
      } catch {
        return refuse("400 Bad Request");
      }
      if (path !== SOCKET_PATH) return refuse("404 Not Found");
      // A browser page on another site cannot open this socket: its origin is not this server's. A missing Origin is a program, not a page.
      const origin = req.headers.origin;
      if (origin !== undefined && originHost(origin) !== (req.headers.host ?? null)) return refuse("403 Forbidden");
      if (this.peers.size >= BAND_SYNC_LIMITS.followers + BAND_SYNC_LIMITS.pending) return refuse("503 Service Unavailable");
      socketServer.handleUpgrade(req, socket, head, (ws) => this.accept(ws, req.socket.remoteAddress ?? "unknown"));
    } catch (error) {
      this.log("upgrade", error);
      socket.destroy();
    }
  }

  private accept(socket: WebSocket, address: string): void {
    const pending = [...this.peers].filter((peer) => !peer.signedIn).length;
    if (pending >= BAND_SYNC_LIMITS.pending) {
      socket.close(1013, "try again");
      return;
    }
    const peer: Peer = { socket, address, signedIn: false, timer: null, refused: 0, controls: [] };
    this.peers.add(peer);
    peer.timer = setTimeout(() => {
      if (!peer.signedIn) socket.close(1008, "sign in first");
    }, BAND_SYNC_LIMITS.signInMs);
    socket.on("message", (data, isBinary) => this.guard(peer, "message", () => this.receive(peer, data.toString(), isBinary)));
    // Without a listener an error on a socket would end the app. A broken socket is logged and dropped; its close follows.
    socket.on("error", (error) => this.log("socket", error));
    socket.on("close", () => this.guard(peer, "close", () => this.forget(peer)));
  }

  private forget(peer: Peer): void {
    if (peer.timer) clearTimeout(peer.timer);
    const wasSignedIn = peer.signedIn;
    this.peers.delete(peer);
    if (wasSignedIn) this.options.onChange();
  }

  /** Runs one connection's handler. An error in it ends that connection only, and is logged. */
  private guard(peer: Peer, where: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      this.log(where, error);
      peer.socket.terminate();
    }
  }

  private log(where: string, error: unknown): void {
    console.warn(`[band-sync] ${where}: ${error instanceof Error ? error.message : String(error)}`);
  }

  private receive(peer: Peer, text: string, isBinary: boolean): void {
    // A peer that was dropped (new PIN, stop) is no longer in the set. Whatever it still sends is ignored.
    if (!this.peers.has(peer)) {
      peer.socket.terminate();
      return;
    }
    if (isBinary) return this.refuse(peer, "Messages must be text.");
    // A frame that is not JSON is not a band follower. That connection is closed; others are not affected.
    try {
      JSON.parse(text);
    } catch {
      peer.socket.close(1008, "not JSON");
      return;
    }
    let message: ClientMessage;
    try {
      message = parseClientMessage(text);
    } catch (e) {
      return this.refuse(peer, e instanceof Error ? e.message : "The message is not valid.");
    }
    if (!peer.signedIn) {
      if (message.type !== "hello") return this.refuse(peer, "Sign in first.");
      return this.signIn(peer, message);
    }
    switch (message.type) {
      case "hello":
        return this.refuse(peer, "Already signed in.");
      case "ping": {
        // The server's two times, read as the ping arrives and as the pong leaves. The follower's clock estimator uses both (spec 44).
        const t1 = this.now();
        this.send(peer, { type: "pong", seq: message.seq, t0: message.t0, t1, t2: this.now() });
        return;
      }
      case "control":
        return this.control(peer, message.action);
    }
  }

  private signIn(peer: Peer, message: Extract<ClientMessage, { type: "hello" }>): void {
    if (message.pin !== undefined) {
      const result = this.auth.signIn(peer.address, message.pin);
      if (!result.ok) return this.refuseSignIn(peer, result.reason, result.retryAfter);
      return this.admit(peer, result.token);
    }
    const token = message.token;
    const result = this.auth.resume(peer.address, token);
    if (!result.ok) return this.refuseSignIn(peer, result.reason, result.retryAfter);
    return this.admit(peer, token);
  }

  /** A sign-in that failed. The socket closes, so a follower must try again on a new one; the lock-out is counted per address. */
  private refuseSignIn(peer: Peer, reason: "pin" | "token" | "locked", retryAfter: number): void {
    this.send(peer, { type: "refused", reason, retryAfter });
    peer.socket.close(1008, "refused");
  }

  /** A signed-in follower: it gets its session token, whether it just signed in or resumed, and the song as it stands. */
  private admit(peer: Peer, token: string): void {
    if (this.signedInCount() >= BAND_SYNC_LIMITS.followers) {
      this.send(peer, { type: "refused", reason: "full", retryAfter: 0 });
      peer.socket.close(1013, "full");
      return;
    }
    peer.signedIn = true;
    if (peer.timer) clearTimeout(peer.timer);
    peer.timer = null;
    this.send(peer, { type: "hello", protocol: BAND_SYNC_PROTOCOL, token, controlAllowed: this.allowControl });
    if (this.state.model) this.send(peer, { type: "song", model: this.state.model });
    if (this.state.clock) this.send(peer, { type: "state", clock: this.state.clock });
    this.options.onChange();
  }

  private control(peer: Peer, action: FollowerAction): void {
    if (!peer.signedIn || !this.peers.has(peer)) return;
    if (!this.allowControl) return this.send(peer, { type: "error", message: "Remote control is off." });
    const now = this.now();
    peer.controls = peer.controls.filter((at) => now - at < CONTROL_WINDOW_MS);
    if (peer.controls.length >= BAND_SYNC_LIMITS.controlPerSecond) return this.send(peer, { type: "error", message: "Too many controls. Wait a moment." });
    peer.controls.push(now);
    if (isFollowerAction(action)) this.options.onControl(action);
  }

  /** A message that is not allowed. Each one is answered; after a few the connection is closed, so a broken follower cannot keep talking. */
  private refuse(peer: Peer, message: string): void {
    peer.refused += 1;
    this.send(peer, { type: "error", message });
    if (peer.refused >= BAND_SYNC_LIMITS.refusedMessages) peer.socket.close(1008, "too many refused messages");
  }

  private signedInCount(): number {
    return [...this.peers].filter((peer) => peer.signedIn).length;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

/** The settings the performer chose. Band sync is never switched on by this file: it starts off every time the app opens. */
export interface BandSyncSettings {
  address: string | null;
  port: number;
  allowControl: boolean;
}

export const DEFAULT_SETTINGS: BandSyncSettings = { address: null, port: BAND_SYNC_LIMITS.defaultPort, allowControl: false };

/** Reads the saved settings. A damaged file gives the defaults; a port that is out of range is replaced by the default. */
export function parseSettings(value: unknown): BandSyncSettings {
  if (typeof value !== "object" || value === null) return { ...DEFAULT_SETTINGS };
  const saved = value as Record<string, unknown>;
  let port: number = BAND_SYNC_LIMITS.defaultPort;
  try {
    port = parseSyncPort(saved.port);
  } catch {
    port = BAND_SYNC_LIMITS.defaultPort;
  }
  return {
    address: typeof saved.address === "string" && isLanAddress(saved.address) ? saved.address : null,
    port,
    allowControl: saved.allowControl === true,
  };
}

/** Checks what the settings panel sends for a start: a LAN address from this computer's list and a valid port. */
export function parseStartOptions(value: unknown, addresses: LanAddress[]): BandSyncOptions {
  if (typeof value !== "object" || value === null) throw new HostError("invalid", "Choose a network address to start band sync.");
  const options = value as Record<string, unknown>;
  if (typeof options.address !== "string" || !addresses.some((entry) => entry.address === options.address)) {
    throw new HostError("invalid", "Choose a network address from the list.");
  }
  if (typeof options.allowControl !== "boolean") throw new HostError("invalid", "Remote control must be on or off.");
  return { address: options.address, port: parseSyncPort(options.port), allowControl: options.allowControl };
}

/**
 * Registers band sync's IPC. Only the performance window may call it. Its state goes to that window only, and every audience update
 * is also given to the server, whether or not it is listening.
 */
export function registerBandSyncIpc(getWindow: () => BrowserWindow | null, root: string): { stop(): void; dispose(): void } {
  const file = () => join(app.getPath("userData"), SETTINGS_FILE);
  let settings: BandSyncSettings = DEFAULT_SETTINGS;
  let loaded = false;
  const load = async () => {
    if (loaded) return;
    loaded = true;
    try {
      settings = parseSettings(JSON.parse(await readFile(file(), "utf8")));
    } catch {
      settings = { ...DEFAULT_SETTINGS };
    }
  };
  const save = () => serial(file(), () => writeJsonAtomic(file(), settings)).catch(() => {});
  const server = new BandSyncServer({
    root,
    onControl: (action) => sendTo(getWindow, "band-sync:control", action),
    onChange: () => emit(),
  });
  const status = (): BandSyncStatus => {
    const addresses = lanAddresses();
    const snapshot = server.snapshot();
    const chosen = settings.address && addresses.some((entry) => entry.address === settings.address) ? settings.address : (addresses[0]?.address ?? null);
    const address = snapshot.listening ? snapshot.address : chosen;
    let message: string;
    if (snapshot.listening) {
      const control = settings.allowControl ? " Followers can play, pause and stop." : " Followers can only follow the song.";
      message = `Listening at ${snapshot.address}:${snapshot.port}. ${snapshot.followers} follower${snapshot.followers === 1 ? "" : "s"} signed in.${control}`;
    } else if (!addresses.length) message = "No local network address. Connect this computer to Wi-Fi or Ethernet.";
    else message = "Band sync is off. Nothing is listening on the network.";
    return {
      listening: snapshot.listening,
      address,
      port: snapshot.listening ? snapshot.port : settings.port,
      url: snapshot.listening && snapshot.address ? `http://${snapshot.address}:${snapshot.port}/` : null,
      pin: snapshot.pin,
      followers: snapshot.followers,
      allowControl: settings.allowControl,
      addresses,
      message,
    };
  };
  const emit = () => sendTo(getWindow, "band-sync:status", status());
  const mainOnly = (event: IpcMainInvokeEvent) => {
    if (event.sender.id !== getWindow()?.webContents.id) throw new HostError("unauthorized", "Only the performance screen controls band sync.");
  };
  handle("band-sync:status", async (event) => {
    mainOnly(event);
    await load();
    return status();
  });
  handle("band-sync:start", async (event, options: unknown) => {
    mainOnly(event);
    await load();
    const parsed = parseStartOptions(options, lanAddresses());
    await server.start(parsed.address, parsed.port, parsed.allowControl);
    settings = { address: parsed.address, port: parsed.port, allowControl: parsed.allowControl };
    void save();
    return status();
  });
  handle("band-sync:stop", (event) => {
    mainOnly(event);
    server.stop();
    return status();
  });
  handle("band-sync:newPin", (event) => {
    mainOnly(event);
    server.rotatePin();
    return status();
  });
  handle("band-sync:setAllowControl", (event, allowControl: unknown) => {
    mainOnly(event);
    if (typeof allowControl !== "boolean") throw new HostError("invalid", "Remote control must be on or off.");
    settings = { ...settings, allowControl };
    server.setAllowControl(allowControl);
    void save();
    return status();
  });
  // Every audience update reaches the server, so a sync that starts mid-song already has the song.
  const unsubscribe = onAudiencePublish((update) => server.publish(update));
  return {
    stop: () => server.stop(),
    dispose: () => {
      unsubscribe();
      server.stop();
    },
  };
}
