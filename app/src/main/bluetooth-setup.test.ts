// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ shell: {} }));
vi.mock("./ipc/handle", () => ({ handle: vi.fn() }));
import { BluetoothSetupLauncher } from "./bluetooth-setup";
afterEach(() => vi.useRealTimers());
it("times out an unresponsive launch without blocking the app, and allows a retry", async () => {
  vi.useFakeTimers();
  let finishOld!: (error: string) => void;
  const launch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue("");
  const setup = new BluetoothSetupLauncher(launch);
  const failed = setup.open().catch((error: Error) => error.message);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await failed).toContain("did not respond");
  const retry = setup.open();
  finishOld("");
  await retry;
  expect(launch).toHaveBeenCalledTimes(2);
});
it("can cancel and retry without a late result from the first request changing the second", async () => {
  let finishOld!: (error: string) => void;
  const launch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue("");
  const setup = new BluetoothSetupLauncher(launch);
  const cancelled = setup.open().catch((error: { code: string }) => error.code);
  await Promise.resolve();
  setup.cancel();
  expect(await cancelled).toBe("cancelled");
  const retry = setup.open();
  finishOld("failed");
  await retry;
});
it("reports launch errors and prevents overlapping requests", async () => {
  let finish!: (error: string) => void;
  const setup = new BluetoothSetupLauncher(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const failed = setup.open().catch((error: Error) => error.message);
  await expect(setup.open()).rejects.toThrow("already opening");
  finish("unavailable");
  expect(await failed).toContain("Could not open Audio MIDI Setup");
});
