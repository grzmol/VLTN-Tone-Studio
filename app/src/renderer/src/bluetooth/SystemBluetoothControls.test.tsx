import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ openSetup: vi.fn(), cancelSetup: vi.fn() }));
vi.mock("@/host", () => ({ host: { bluetoothMidi: mocks } }));
import { SystemBluetoothControls } from "./SystemBluetoothControls";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("offers a cancellable system launch and refreshes MIDI after the system app opens", async () => {
  let close!: () => void;
  mocks.openSetup.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        close = resolve;
      }),
  );
  mocks.cancelSetup.mockResolvedValue(undefined);
  const opening = vi.fn(),
    ready = vi.fn();
  render(<SystemBluetoothControls onOpening={opening} onReady={ready} />);
  fireEvent.click(screen.getByText("Open macOS MIDI setup"));
  expect(opening).toHaveBeenCalledOnce();
  expect(ready).not.toHaveBeenCalled();
  expect(screen.getByText("Cancel Bluetooth setup")).toBeTruthy();
  await act(async () => close());
  expect(ready).toHaveBeenCalledOnce();
  expect(screen.queryByText("Cancel Bluetooth setup")).toBeNull();
});
it("can cancel and retry a failed setup without running the ready callback", async () => {
  let cancel!: (error: Error) => void;
  mocks.openSetup
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          cancel = reject;
        }),
    )
    .mockResolvedValue(undefined);
  mocks.cancelSetup.mockImplementation(async () => cancel(new Error("Bluetooth setup cancelled")));
  const ready = vi.fn();
  render(<SystemBluetoothControls onReady={ready} />);
  fireEvent.click(screen.getByText("Open macOS MIDI setup"));
  await act(async () => fireEvent.click(screen.getByText("Cancel Bluetooth setup")));
  expect(ready).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("cancelled");
  await act(async () => fireEvent.click(screen.getByText("Open macOS MIDI setup")));
  expect(ready).toHaveBeenCalledOnce();
});
