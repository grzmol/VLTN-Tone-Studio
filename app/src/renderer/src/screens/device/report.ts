// Plain-text diagnostic report (Copy diagnostic report / Save report). No preset contents, no account data.
import type { DeviceHostStatus } from "@shared/host/device";
import type { ConnectionError, DeviceKey, MidiLogEntry, RequestError } from "@/state/device-types";
import { pedalName } from "@/state/device-model";
import { hostLines } from "@/state/host-lines";
import { formatLogLine } from "@/state/midi-log";
import type { Check } from "./guidance";
import type { BluetoothDiagnostics } from "@/bluetooth/connection";

export interface ReportInput {
  appVersion: string;
  platform: string;
  host: DeviceHostStatus | null;
  checks: Check[];
  status: string;
  mode: string;
  bluetooth?: { available: boolean; connecting: boolean; name: string | null; state: string; error: string | null };
  bluetoothDiagnostics?: BluetoothDiagnostics | null;
  portName: string | null;
  /** The pedal the connection is about: connected, being connected, on USB, else the last connected (guidance attachedDevice) */
  device: DeviceKey | null;
  connectionError: ConnectionError | null;
  lastError: RequestError | null;
  /** Monitor lines, only when the monitor is on */
  monitor: MidiLogEntry[] | null;
  /** Folder of the session log files; null when the log lives in this browser tab */
  logFolder: string | null;
  now?: number;
}

const MARK = { ok: "OK  ", warn: "WARN", fault: "FAIL", idle: "--  ", pending: "... " } as const;

export function buildReport(r: ReportInput): string {
  const h = r.host;
  const lines = [
    "VLTN Tone Studio diagnostic report",
    `Created: ${new Date(r.now ?? Date.now()).toISOString()}`,
    "",
    `App: ${r.appVersion}${h?.versions.electron ? ` (Electron ${h.versions.electron}, Chromium ${h.versions.chrome}, Node ${h.versions.node})` : h?.versions.chrome ? ` (browser, Chromium ${h.versions.chrome})` : ""}`,
    `Platform: ${r.platform}`,
    `OS: ${h?.os ?? "unknown"}`,
    "",
    "Checks:",
    ...r.checks.map((c) => `  [${MARK[c.state]}] ${c.name}: ${c.detail}${c.hint ? ` (${c.hint})` : ""}`),
    "",
    `Connection: ${r.status} (${r.mode})`,
    ...(r.bluetooth ? [
      `Bluetooth API: ${r.bluetooth.available ? 'available' : 'unavailable'}`,
      `Bluetooth MIDI: ${r.bluetooth.connecting ? 'connecting' : r.bluetooth.state}`,
      `Bluetooth device: ${r.bluetooth.name ?? 'none'}`,
      `Last Bluetooth error: ${r.bluetooth.error ?? 'none'}`,
    ] : []),
    ...(r.bluetoothDiagnostics ? [
      `Last Bluetooth session: ${r.bluetoothDiagnostics.device}`,
      `Bluetooth GATT writes completed: ${r.bluetoothDiagnostics.writes}`,
      `Bluetooth GATT notifications received: ${r.bluetoothDiagnostics.notifications}`,
      `Bluetooth MIDI messages decoded: ${r.bluetoothDiagnostics.messages}`,
    ] : []),
    `Pedal model: ${r.device ? pedalName(r.device) : "unknown"}`,
    `MIDI port: ${r.portName ?? "none"}`,
    `Visible MIDI ports: ${r.connectionError?.ports ? r.connectionError.ports.join(", ") || "none" : "not listed"}`,
    ...hostLines(h),
    `Session log: ${r.logFolder ? `${r.logFolder} (Save log in Diagnostics)` : "kept in this browser tab (Save log in Diagnostics)"}`,
    `Last connection error: ${r.connectionError ? `${r.connectionError.code}: ${r.connectionError.message}` : "none"}`,
    `Last request error: ${r.lastError ? `${r.lastError.code}: ${r.lastError.message} at ${new Date(r.lastError.at).toISOString()}` : "none"}`,
  ];
  if (r.monitor) {
    lines.push("", `MIDI monitor (last ${Math.min(50, r.monitor.length)} lines):`, ...r.monitor.slice(-50).map((e) => `  ${formatLogLine(e)}`));
  }
  return lines.join("\n") + "\n";
}
