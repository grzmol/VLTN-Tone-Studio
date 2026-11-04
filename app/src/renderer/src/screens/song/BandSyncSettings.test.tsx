import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BandSyncStatus } from "@shared/host/band-sync";
import { BandSyncSettings } from "./BandSyncSettings";

const api = vi.hoisted(() => ({
  status: vi.fn(),
  onStatus: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  newPin: vi.fn(),
  setAllowControl: vi.fn(),
  onControl: vi.fn(),
}));
const host = vi.hoisted(() => ({ bandSync: undefined as unknown }));
vi.mock("@/host", () => ({ host }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,AAAA")) } }));

// Radix's Select measures its list with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const off = (patch: Partial<BandSyncStatus> = {}): BandSyncStatus => ({
  listening: false,
  address: "192.168.1.20",
  port: 8787,
  url: null,
  pin: null,
  followers: 0,
  allowControl: false,
  addresses: [{ address: "192.168.1.20", name: "en0" }],
  message: "Band sync is off. Nothing is listening on the network.",
  ...patch,
});

const on = (patch: Partial<BandSyncStatus> = {}): BandSyncStatus =>
  off({
    listening: true,
    url: "http://192.168.1.20:8787/",
    pin: "482910",
    followers: 1,
    message: "Listening at 192.168.1.20:8787. 1 follower signed in. Followers can only follow the song.",
    ...patch,
  });

beforeEach(() => {
  localStorage.setItem("vltn.card.band-sync", "open");
  api.status.mockResolvedValue(off());
  api.onStatus.mockReturnValue(() => {});
  api.start.mockResolvedValue(on());
  api.stop.mockResolvedValue(off());
  api.newPin.mockResolvedValue(on({ pin: "100200" }));
  api.setAllowControl.mockResolvedValue(off({ allowControl: true }));
  host.bandSync = api;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BandSyncSettings", () => {
  it("shows nothing where there is no band sync (the browser build)", () => {
    host.bandSync = undefined;
    const { container } = render(<BandSyncSettings />);
    expect(container.innerHTML).toBe("");
  });

  it("is off until the performer starts it, and starts on the chosen address and port", async () => {
    render(<BandSyncSettings />);
    expect(await screen.findByText("Band sync is off. Nothing is listening on the network.")).toBeTruthy();
    expect(screen.queryByText("PIN:")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start band sync" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith({ address: "192.168.1.20", port: 8787, allowControl: false }));
  });

  it("does not start with a port that is out of range", async () => {
    render(<BandSyncSettings />);
    await screen.findByText("Band sync is off. Nothing is listening on the network.");
    fireEvent.change(screen.getByLabelText("Band sync port"), { target: { value: "99999" } });
    expect((screen.getByRole("button", { name: "Start band sync" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says plainly that it is listening, with the address, the PIN and a way to stop", async () => {
    api.status.mockResolvedValue(on());
    render(<BandSyncSettings />);
    expect(await screen.findByText("Listening")).toBeTruthy();
    expect(screen.getByText("http://192.168.1.20:8787/")).toBeTruthy();
    expect(screen.getByText("482910")).toBeTruthy();
    expect(screen.getByAltText("QR code with the band sync address")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop band sync" }));
    await waitFor(() => expect(api.stop).toHaveBeenCalled());
  });

  it("makes a new PIN on request", async () => {
    api.status.mockResolvedValue(on());
    render(<BandSyncSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "New PIN" }));
    await waitFor(() => expect(api.newPin).toHaveBeenCalled());
    expect(await screen.findByText("100200")).toBeTruthy();
  });

  it("allows remote transport only when the performer ticks it", async () => {
    render(<BandSyncSettings />);
    const box = await screen.findByLabelText("Allow followers to control playback");
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    await waitFor(() => expect(api.setAllowControl).toHaveBeenCalledWith(true));
  });

  it("shows a refusal from the app, such as a port that is in use", async () => {
    api.start.mockRejectedValue(new Error("Port 8787 is already in use. Choose another port."));
    render(<BandSyncSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Start band sync" }));
    expect(await screen.findByText(/already in use/)).toBeTruthy();
  });
});
