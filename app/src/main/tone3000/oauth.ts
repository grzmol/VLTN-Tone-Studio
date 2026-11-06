// Embedded TONE3000 OAuth (plain sign-in, Select / Load Tone flows) in a WebContentsView layered over the main window.
// Pattern from tone-3000/t3k-api `electron/src/main/oauth.ts`: the view has no preload and its own persistent
// partition; main owns the PKCE verifier and `state`, cancels the navigation to the redirect URI and
// exchanges the code itself, so nothing has to listen on the redirect URI.
import { BrowserWindow, WebContentsView, session, shell } from "electron";
import type { FlowRequest, ViewBounds } from "@shared/host/tones";
import { isT3kUrl, T3K_ORIGIN } from "./api";
import { createPkce } from "./pkce";

export const PARTITION = "persist:tone3000";

export type RawFlowResult =
  | { status: "code"; code: string; verifier: string; toneId: number | null }
  | { status: "canceled" }
  | { status: "error"; message: string };

interface ActiveFlow {
  view: WebContentsView;
  win: BrowserWindow;
  state: string;
  verifier: string;
  resolve: (r: RawFlowResult) => void;
  detach: () => void;
}

let active: ActiveFlow | null = null;
let sessionLocked = false;

/** The TONE3000 pages get no device permissions (camera, mic, MIDI, notifications…). */
function lockSession(): void {
  if (sessionLocked) return;
  sessionLocked = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

export function authorizeUrl(clientId: string, redirectUri: string, challenge: string, state: string, req: FlowRequest): string {
  const url = new URL(`${T3K_ORIGIN}/api/v1/oauth/authorize`);
  const p = url.searchParams;
  p.set("client_id", clientId);
  p.set("redirect_uri", redirectUri);
  p.set("response_type", "code");
  p.set("code_challenge", challenge);
  p.set("code_challenge_method", "S256");
  p.set("state", state);
  p.set("menubar", "true");
  if (req.prompt) p.set("prompt", req.prompt);
  if (req.prompt === "load_tone" && req.toneId) p.set("tone_id", String(req.toneId));
  if (req.format) p.set("format", req.format);
  if (req.gears) p.set("gears", req.gears);
  if (req.architecture) p.set("architecture", req.architecture);
  return url.toString();
}

export function isRedirect(url: string, redirectUri: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(redirectUri);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

/** Only TONE3000 (and the intercepted redirect) may load in the view; anything else opens in the browser. */
function allowedInView(url: string): boolean {
  return isT3kUrl(url);
}

function openExternally(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:") void shell.openExternal(url);
  } catch {
    /* malformed URL */
  }
}

function round(b: ViewBounds): Electron.Rectangle {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
}

function settle(result: RawFlowResult | ((flow: ActiveFlow) => RawFlowResult)): void {
  const flow = active;
  if (!flow) return;
  active = null;
  flow.detach();
  if (!flow.win.isDestroyed()) {
    flow.win.contentView.removeChildView(flow.view);
    flow.win.webContents.focus();
  }
  // Closing synchronously inside a navigation event can crash; defer it.
  setImmediate(() => flow.view.webContents.close());
  flow.resolve(typeof result === "function" ? result(flow) : result);
}

/** Open the flow over `bounds`; resolves with the authorization code (state already verified) or the outcome. */
export function runFlow(win: BrowserWindow, clientId: string, redirectUri: string, req: FlowRequest, bounds: ViewBounds): Promise<RawFlowResult> {
  if (active) settle({ status: "canceled" });
  const { verifier, challenge, state } = createPkce();
  lockSession();

  return new Promise<RawFlowResult>((resolve) => {
    const view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    view.setBackgroundColor("#0b0b0d");
    win.contentView.addChildView(view);
    view.setBounds(round(bounds));
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      openExternally(url);
      return { action: "deny" };
    });

    // Server redirects fire will-redirect; client-side ones fire will-navigate.
    const onNavigate = (event: Electron.Event, url: string) => {
      if (isRedirect(url, redirectUri)) {
        event.preventDefault();
        const q = new URL(url).searchParams;
        const code = q.get("code");
        const error = q.get("error");
        const toneId = Number(q.get("tone_id")) || null;
        settle((flow) => {
          if (q.get("state") !== flow.state) return { status: "error", message: "TONE3000 sign-in failed a security check (state mismatch). Try again." };
          if (error) return error === "access_denied" ? { status: "canceled" } : { status: "error", message: `TONE3000 sign-in failed (${error})` };
          if (!code) return q.get("canceled") === "true" ? { status: "canceled" } : { status: "error", message: "TONE3000 returned no authorization code" };
          return { status: "code", code, verifier: flow.verifier, toneId };
        });
        return;
      }
      if (!allowedInView(url)) {
        event.preventDefault();
        openExternally(url);
      }
    };
    // Authorize can reject the request (bad key, unregistered redirect_uri) with an error page.
    const onDidNavigate = (_e: Electron.Event, url: string, status: number) => {
      if (status >= 400 && !isRedirect(url, redirectUri))
        settle({ status: "error", message: "TONE3000 rejected the sign-in request. The app's TONE3000 key or redirect address isn't accepted." });
    };
    // -3 is ERR_ABORTED, which our own preventDefault produces.
    const onFailLoad = (_e: Electron.Event, code: number, _d: string, url: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === -3 || isRedirect(url, redirectUri)) return;
      settle({ status: "error", message: "Can't reach TONE3000. Check your connection and try again." });
    };
    const onInput = (_e: Electron.Event, input: Electron.Input) => {
      if (input.type === "keyDown" && input.key === "Escape") settle({ status: "canceled" });
    };
    const onLoaded = () => {
      if (active?.view === view) wc.focus();
    };

    wc.on("will-redirect", onNavigate);
    wc.on("will-navigate", onNavigate);
    wc.on("did-navigate", onDidNavigate);
    wc.on("did-fail-load", onFailLoad);
    wc.on("before-input-event", onInput);
    wc.on("did-finish-load", onLoaded);

    active = {
      view,
      win,
      state,
      verifier,
      resolve,
      detach: () => {
        wc.off("will-redirect", onNavigate);
        wc.off("will-navigate", onNavigate);
        wc.off("did-navigate", onDidNavigate);
        wc.off("did-fail-load", onFailLoad);
        wc.off("before-input-event", onInput);
        wc.off("did-finish-load", onLoaded);
      },
    };
    void wc.loadURL(authorizeUrl(clientId, redirectUri, challenge, state, req));
    wc.focus();
  });
}

export function setFlowBounds(bounds: ViewBounds): void {
  active?.view.setBounds(round(bounds));
}

export function cancelFlow(): void {
  settle({ status: "canceled" });
}
