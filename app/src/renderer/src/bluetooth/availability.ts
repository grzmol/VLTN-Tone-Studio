import type { DeviceKey } from "@shared/devices";

/** Pedals that can be linked over Bluetooth MIDI. */
const BLUETOOTH_PEDALS: readonly DeviceKey[] = ["gp150", "gp180"];

/** The Bluetooth controls belong to the GP-150 family, and only where the browser or app has Web Bluetooth. */
export function bluetoothOffered(device: DeviceKey | null, nav: { bluetooth?: unknown } | undefined = typeof navigator === "undefined" ? undefined : navigator): boolean {
  return device !== null && BLUETOOTH_PEDALS.includes(device) && Boolean(nav?.bluetooth);
}
