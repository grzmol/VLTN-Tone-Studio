import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@shared/host/song";
import { DeviceError, useDevice } from "@/state/device";
import { describeError, resolveBackupSource } from "./write-helpers";

const files = vi.hoisted(() => ({ listCollections: vi.fn(), listPresets: vi.fn() }));
vi.mock("@/host", () => ({ host: { files } }));

const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("describeError", () => {
  afterEach(() => useDevice.setState({ device: null }));

  it("keeps the store's plain refusal for a feature behind Experimental pedal commands", () => {
    useDevice.setState({ device: "gp200" });
    const locked = new DeviceError("unsafe", "This needs Experimental pedal commands, which you can turn on in Settings.");
    expect(describeError(locked)).toBe(locked.message);
    expect(describeError(failure("unsafe", "refusing to send a destructive frame"))).toMatch(/data looked wrong\. Nothing was sent/);
  });

  it("says a GP-200 write the pedal read back nothing for isn't confirmed, and an unacknowledged GP-5 frame left the slot alone", () => {
    useDevice.setState({ device: "gp200" });
    expect(describeError(failure("verify", "slot 12-C not verified after 3 writes: the pedal did not answer the read-back"), 46)).toBe(
      "The GP-200 didn't answer when Tone Studio read slot 12-C back, so the write isn't confirmed. Retry, or restore slot 12-C from the backup.",
    );
    useDevice.setState({ device: "gp5" });
    expect(describeError(failure("verify", "frame 4/26 not acknowledged after 3 attempts; slot 7 unchanged"), 7)).toMatch(/discarded the write\. Slot 07 was not changed/);
  });
});

describe("resolveBackupSource", () => {
  const slot = 3;
  const older = new Uint8Array([9, 9, 9]);
  const current = new Uint8Array([1, 2, 3]);
  beforeEach(() => {
    files.listCollections.mockResolvedValue([{ id: "backups", kind: "backup", device: "gp5", createdAt: "2026-10-01T10:00:00.000Z" }]);
    // A backup taken before the preset in slot 3 was edited and saved under the same name.
    files.listPresets.mockResolvedValue([{ slot, name: "Lead", prst: older }]);
    useDevice.setState({
      device: "gp5",
      slot: 1,
      saved: null,
      unsavedChanges: 1,
      features: [],
      names: Array.from({ length: 4 }, (_, i) => ({ slot: i, name: i === slot ? "Lead" : "" })),
      slotHashes: new Map(),
    });
  });
  afterEach(() => useDevice.setState({ device: null, slotHashes: new Map() }));

  it("flags a same-name backup as stale when the pedal's slot holds different bytes", async () => {
    useDevice.setState({ slotHashes: new Map([[slot, await sha256Hex(current)]]) });
    expect(await resolveBackupSource(slot)).toMatchObject({ kind: "backup", prst: older, stale: true });
  });

  it("trusts the backup when its bytes are the ones the store last saw in the slot", async () => {
    useDevice.setState({ slotHashes: new Map([[slot, await sha256Hex(older)]]) });
    expect(await resolveBackupSource(slot)).toMatchObject({ kind: "backup", prst: older, stale: false });
  });

  it("treats the backup as stale when the store has no fingerprint for the slot", async () => {
    expect(await resolveBackupSource(slot)).toMatchObject({ kind: "backup", stale: true });
  });
});
