// Session log, renderer side: connection events, errors, host checks and MIDI lines are batched and handed to the host
// (desktop: rotated files in userData/logs; browser: memory). Always on, independent of the MIDI monitor.
import { sessionLogLine } from "@shared/host/log";
import { host } from "@/host";
import { pedalName } from "./device-model";
import type { DeviceState } from "./device-types";
import { hostLines } from "./host-lines";

const FLUSH_MS = 1000;
/** Flush early past this many lines (a backup logs thousands of frames). */
const FLUSH_LINES = 1000;

let pending: string[] = [];
let timer: number | undefined;
/** A failing host is reported once, not on every flush. */
let warned = false;

export function sessionLog(kind: string, text: string, at = Date.now()): void {
  pending.push(sessionLogLine(kind, text, at));
  if (pending.length >= FLUSH_LINES) void flushSessionLog();
  else timer ??= window.setTimeout(() => void flushSessionLog(), FLUSH_MS);
}

/** Hand the pending lines to the host now (before reading the log back). Logging never fails its caller. */
export async function flushSessionLog(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  try {
    await host.log.append(batch);
  } catch (e) {
    if (!warned) console.warn("[log] couldn't write the session log", e);
    warned = true;
  }
}

/** What changed between two device store states, as session log entries ([kind, text]). */
export function deviceLogEntries(p: DeviceState, s: DeviceState): [string, string][] {
  const out: [string, string][] = [];
  if (s.status !== p.status) {
    if (s.status === "connecting") out.push(["Event", `Connecting (${s.mode === "mock" ? "simulator" : s.mode === 'bluetooth' ? 'Bluetooth MIDI' : "USB MIDI"})`]);
    else if (s.status === "connected") out.push(["Event", `Connected to the ${pedalName(s.device)}${s.portName ? ` on "${s.portName}"` : ""}`]);
    else if (s.status === "disconnected") out.push(["Event", `Disconnected (${s.disconnectReason === "lost" ? "the pedal went away" : "by the user"})`]);
  }
  if (s.error && s.error !== p.error)
    out.push(["Error", `Connection failed: ${s.error.code}: ${s.error.message}${s.error.ports ? ` (visible ports: ${s.error.ports.join(", ") || "none"})` : ""}`]);
  if (s.lastError && s.lastError !== p.lastError) out.push(["Error", `Request failed: ${s.lastError.code}: ${s.lastError.message}`]);
  if (s.firmware && s.firmware !== p.firmware) out.push(["Event", `Firmware ${s.firmware}`]);
  if (s.busy?.kind !== p.busy?.kind) {
    if (p.busy) out.push(["Event", `Finished: ${p.busy.kind}`]);
    if (s.busy) out.push(["Event", `Started: ${s.busy.label}`]);
  }
  // The host is checked every few seconds while the app waits for the pedal: log what it saw only when that changes.
  if (s.hostStatus && s.hostStatus !== p.hostStatus) {
    const now = hostLines(s.hostStatus).join("; ");
    if (!p.hostStatus || now !== hostLines(p.hostStatus).join("; ")) out.push(["Host", `${s.hostStatus.os}; ${now}`]);
  }
  return out;
}

/** Uncaught errors and rejections of the renderer go into the log; the pending lines are flushed when the page goes away. */
export function logUncaughtErrors(): void {
  window.addEventListener("error", (e) => sessionLog("Error", `Uncaught: ${e.message}${e.filename ? ` at ${e.filename}:${e.lineno}` : ""}`));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason as { name?: string; message?: string } | undefined;
    sessionLog("Error", `Unhandled rejection: ${r?.message ? `${r.name ?? "Error"}: ${r.message}` : String(e.reason)}`);
  });
  window.addEventListener("pagehide", () => void flushSessionLog());
}
