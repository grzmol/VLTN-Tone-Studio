import { app, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { access, constants, readFile, readdir, readlink, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { release, arch } from "node:os";
import { promisify } from "node:util";
import { VALETON_VID, deviceForUsbPid, profileFor } from "@shared/devices";
import { MIDI2_DRIVER_RE, type DeviceHostStatus, type LinuxSeqAccess, type UsbDeviceInfo, type UsbInterfaceInfo, type VendorAppsRunning } from "@shared/host/device";
import { HostError } from "@shared/ipc";
import { handle, showOpenDialog, showSaveDialog } from "./handle";
import { chooseSuitePath } from "./app";

const run = promisify(execFile);
const EXEC = { timeout: 8000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 };
const SUITE_RE = /valeton\s*suite/i;
/** Image name of Valeton's GP-200 editor (GP-200.exe confirmed; the LT and JR names are assumed). */
const GP200_EDITOR_EXE_RE = /^gp-200(lt|jr)?\.exe$/i;
/** GP-200 editor in a process command line: the macOS bundle, or the Windows build under Wine. */
const GP200_EDITOR_PATH_RE = /[\\/]GP-200(LT|JR)?(\.app[\\/]|\.exe\b)/i;
const MAX_REPORT = 1024 * 1024;

interface UsbScan {
  usb: UsbDeviceInfo[];
  driver: string | null;
  usbInterfaces: UsbInterfaceInfo[] | null;
}

/**
 * The pedal's MIDI interface among `ifaces`: the one its profile names (measured on the GP-5 and GP-200; the GP-50
 * shares the GP-5's layout), else the first with the MIDIStreaming class, else the first bound to a MIDI 2.0 driver.
 * Only products that are a pedal in normal mode count.
 */
function pedalMidiInterface(ifaces: UsbInterfaceInfo[]): UsbInterfaceInfo | null {
  for (const pid of new Set(ifaces.map((i) => i.productId))) {
    const device = deviceForUsbPid(pid);
    if (!device) continue;
    const own = ifaces.filter((i) => i.productId === pid);
    const measured = profileFor(device).usbMidiInterface;
    const hit =
      (measured !== null ? own.find((i) => i.iface === measured) : undefined) ??
      own.find((i) => i.midi) ??
      own.find((i) => MIDI2_DRIVER_RE.test(i.service ?? "") || MIDI2_DRIVER_RE.test(i.name ?? ""));
    if (hit) return hit;
  }
  return null;
}

const readText = (path: string) => readFile(path, "utf8").then((s) => s.trim(), () => null);

// ------------------------------------------------------------------------------------------------ Linux

/** /sys/bus/usb/devices: Valeton devices, their config-1 interfaces, and the driver bound to the pedal's MIDI interface. */
async function linuxUsb(): Promise<UsbScan> {
  const root = "/sys/bus/usb/devices";
  const entries = await readdir(root);
  const usb: UsbDeviceInfo[] = [];
  const usbInterfaces: UsbInterfaceInfo[] = [];
  for (const entry of entries) {
    if (entry.includes(":")) continue; // interfaces, not devices
    const vendor = await readText(join(root, entry, "idVendor"));
    if (!vendor || parseInt(vendor, 16) !== VALETON_VID) continue;
    const productId = parseInt((await readText(join(root, entry, "idProduct"))) ?? "0", 16);
    usb.push({ vendorId: VALETON_VID, productId, product: await readText(join(root, entry, "product")) });
    for (const name of entries.filter((e) => e.startsWith(`${entry}:1.`))) {
      const dir = join(root, name);
      const [num, cls, sub] = await Promise.all(["bInterfaceNumber", "bInterfaceClass", "bInterfaceSubClass"].map((f) => readText(join(dir, f))));
      if (num === null) continue;
      const service = await readlink(join(dir, "driver")).then((p) => basename(p), () => null);
      usbInterfaces.push({ productId, iface: parseInt(num, 16), service, name: null, midi: cls === "01" && sub === "03" });
    }
  }
  return { usb, driver: pedalMidiInterface(usbInterfaces)?.service ?? null, usbInterfaces };
}

async function groupName(gid: number): Promise<string | null> {
  const groups = (await readText("/etc/group")) ?? "";
  for (const line of groups.split("\n")) {
    const [name, , id] = line.split(":");
    if (Number(id) === gid) return name;
  }
  return null;
}

async function linuxSeq(): Promise<LinuxSeqAccess> {
  const path = "/dev/snd/seq";
  const st = await stat(path).catch(() => null);
  if (!st) return { path, exists: false, accessible: false, group: null, inGroup: false };
  const accessible = await access(path, constants.R_OK | constants.W_OK).then(
    () => true,
    () => false,
  );
  const gids = process.getgroups?.() ?? [];
  return { path, exists: true, accessible, group: await groupName(st.gid), inGroup: gids.includes(st.gid) };
}

// ------------------------------------------------------------------------------------------------ Windows

interface PnpRow {
  PNPDeviceID?: string | null;
  Name?: string | null;
  Service?: string | null;
  CompatibleID?: string | string[] | null;
}

/**
 * `Get-CimInstance Win32_PnPEntity | ConvertTo-Json` for VID_84EF: one object or an array. The composite parent names
 * the device; its children (MI_xx) are the interfaces, `Service` is the bound driver ("usbaudio", "usbmidi2", Valeton's
 * ASIO driver) and a CompatibleID with Class_01&SubClass_03 marks the MIDIStreaming interface.
 */
export function parseWindowsPnp(stdout: string): { usb: UsbDeviceInfo[]; driver: string | null; usbInterfaces: UsbInterfaceInfo[] } {
  const parsed: unknown = stdout.trim() ? JSON.parse(stdout) : [];
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as PnpRow[];
  const usb = new Map<number, UsbDeviceInfo>();
  const usbInterfaces: UsbInterfaceInfo[] = [];
  for (const row of rows) {
    const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(&MI_([0-9A-F]{2}))?/i.exec(row?.PNPDeviceID ?? "");
    if (!m) continue;
    const productId = parseInt(m[2], 16);
    // Prefer the composite parent row for the name; children (MI_xx) still prove the device is present.
    if (!m[3]) {
      usb.set(productId, { vendorId: VALETON_VID, productId, product: row.Name ?? null });
      continue;
    }
    if (!usb.has(productId)) usb.set(productId, { vendorId: VALETON_VID, productId, product: null });
    const compat = row.CompatibleID == null ? [] : Array.isArray(row.CompatibleID) ? row.CompatibleID : [row.CompatibleID];
    usbInterfaces.push({
      productId,
      iface: parseInt(m[4], 16),
      service: row.Service || null,
      name: row.Name || null,
      midi: compat.some((id) => /Class_01&SubClass_03/i.test(id)),
    });
  }
  const midi = pedalMidiInterface(usbInterfaces);
  const driver = midi ? [midi.service, midi.name].filter(Boolean).join(", ") || null : null;
  return { usb: [...usb.values()], driver, usbInterfaces };
}

async function windowsUsb(): Promise<UsbScan> {
  const ps =
    "Get-CimInstance Win32_PnPEntity -Filter \"PNPDeviceID LIKE 'USB\\\\VID_84EF%'\" | Select-Object PNPDeviceID,Name,Service,CompatibleID | ConvertTo-Json -Compress";
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], EXEC);
  return parseWindowsPnp(stdout);
}

// ------------------------------------------------------------------------------------------------ macOS

/** IORegistry USB plane: blocks with "idVendor" = 34031 (0x84EF). */
async function macUsb(): Promise<UsbScan> {
  const { stdout } = await run("ioreg", ["-p", "IOUSB", "-l", "-w0"], EXEC);
  const usb: UsbDeviceInfo[] = [];
  for (const block of stdout.split(/\+-o /)) {
    const vendor = /"idVendor" = (\d+)/.exec(block);
    if (!vendor || Number(vendor[1]) !== VALETON_VID) continue;
    const product = /"idProduct" = (\d+)/.exec(block);
    const name = /"USB Product Name" = "([^"]*)"/.exec(block);
    usb.push({ vendorId: VALETON_VID, productId: Number(product?.[1] ?? 0), product: name?.[1] ?? null });
  }
  // CoreMIDI drives class-compliant MIDI without a vendor driver.
  return { usb, driver: usb.some((d) => deviceForUsbPid(d.productId)) ? "CoreMIDI (class compliant)" : null, usbInterfaces: null };
}

// ------------------------------------------------------------------------------------------------ shared

/** `tasklist /FO CSV /NH`: only the image name (first column) counts, so "GP-200 Tone Desk.exe" is not the editor. */
export function parseTasklist(stdout: string): VendorAppsRunning {
  const images = stdout.split(/\r?\n/).map((line) => /^"([^"]*)"/.exec(line.trim())?.[1] ?? "");
  return { suite: images.some((i) => SUITE_RE.test(i)), gp200Editor: images.some((i) => GP200_EDITOR_EXE_RE.test(i)) };
}

/** `ps -A -o args=`: macOS app bundles, or the Windows builds under Wine on Linux. */
export function parsePs(stdout: string): VendorAppsRunning {
  return { suite: SUITE_RE.test(stdout), gp200Editor: GP200_EDITOR_PATH_RE.test(stdout) };
}

async function vendorAppsRunning(): Promise<VendorAppsRunning | null> {
  try {
    if (process.platform === "win32") return parseTasklist((await run("tasklist", ["/FO", "CSV", "/NH"], EXEC)).stdout);
    return parsePs((await run("ps", ["-A", "-o", "args="], EXEC)).stdout);
  } catch {
    return null;
  }
}

async function usbAndDriver(): Promise<{ usb: UsbDeviceInfo[] | null; driver: string | null; usbInterfaces: UsbInterfaceInfo[] | null }> {
  try {
    if (process.platform === "linux") return await linuxUsb();
    if (process.platform === "win32") return await windowsUsb();
    if (process.platform === "darwin") return await macUsb();
  } catch {
    /* enumeration unavailable (sandbox, missing tool): report unknown rather than "not found" */
  }
  return { usb: null, driver: null, usbInterfaces: null };
}

const OS_NAME: Partial<Record<NodeJS.Platform, string>> = { linux: "Linux", win32: "Windows", darwin: "macOS" };

async function status(): Promise<DeviceHostStatus> {
  const [{ usb, driver, usbInterfaces }, vendorApps, seq] = await Promise.all([
    usbAndDriver(),
    vendorAppsRunning(),
    process.platform === "linux" ? linuxSeq() : Promise.resolve(null),
  ]);
  return {
    checkedAt: Date.now(),
    os: `${OS_NAME[process.platform] ?? process.platform} ${process.platform === "darwin" ? process.getSystemVersion() : release()} ${arch()}`,
    versions: { app: app.getVersion(), electron: process.versions.electron ?? null, chrome: process.versions.chrome ?? null, node: process.versions.node ?? null },
    usb,
    driver,
    linuxSeq: seq,
    usbInterfaces,
    vendorApps,
  };
}

export function registerDeviceIpc(getWindow: () => BrowserWindow | null): void {
  handle("device:status", () => status());

  handle("device:saveReport", async (_e, text: unknown, fileName: unknown) => {
    if (typeof text !== "string" || text.length > MAX_REPORT) throw new HostError("invalid", "The report must be text under 1 MB");
    const name = typeof fileName === "string" && /^[\w.-]+\.txt$/.test(fileName) ? fileName : "valeton-diagnostics.txt";
    const opts = { defaultPath: join(app.getPath("documents"), name), filters: [{ name: "Text", extensions: ["txt"] }] };
    const res = await showSaveDialog(getWindow(), opts);
    if (res.canceled || !res.filePath) return null;
    await writeFile(res.filePath, text, "utf8");
    return res.filePath;
  });

  handle("device:pickSuitePath", async () => {
    const opts: Electron.OpenDialogOptions = {
      title: "Choose Valeton Suite",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "Programs", extensions: ["exe"] }]
          : process.platform === "darwin"
            ? [{ name: "Applications", extensions: ["app"] }]
            : [{ name: "All files", extensions: ["*"] }],
      defaultPath: process.platform === "darwin" ? "/Applications" : undefined,
    };
    const res = await showOpenDialog(getWindow(), opts);
    if (res.canceled || !res.filePaths[0]) return null;
    // The main process keeps the path (app:launchSuite only launches a path stored here).
    await chooseSuitePath(res.filePaths[0]);
    return res.filePaths[0];
  });
}
