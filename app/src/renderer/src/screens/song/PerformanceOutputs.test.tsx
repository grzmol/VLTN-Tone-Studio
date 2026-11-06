import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PerformanceOutputs } from "./PerformanceOutputs";
import { useOutputSettings } from "@/song/audio/output-settings";
import { DEFAULT_OUTPUTS } from "@/song/audio/outputs";

const devices = [
  { kind: "audiooutput", deviceId: "usb-4", label: "Interface" },
  { kind: "audiooutput", deviceId: "hp", label: "Headphones" },
];

function player(outputChannels = 4) {
  return { outputChannels, testTone: vi.fn() };
}

beforeEach(() => {
  localStorage.setItem("vltn.card.outputs", "open");
  useOutputSettings.setState({ config: DEFAULT_OUTPUTS });
  vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: async () => devices, addEventListener: vi.fn(), removeEventListener: vi.fn() } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists the devices and remembers the main device by ID and label", async () => {
  render(<PerformanceOutputs player={player()} />);
  const main = screen.getByLabelText("Main device");
  await waitFor(() => expect(main.querySelector('option[value="usb-4"]')).not.toBeNull());
  fireEvent.change(main, { target: { value: "usb-4" } });
  expect(useOutputSettings.getState().config).toMatchObject({ deviceId: "usb-4", label: "Interface" });
});

it("keeps a saved device that is not connected visible", async () => {
  useOutputSettings.setState({ config: { ...DEFAULT_OUTPUTS, deviceId: "gone", label: "Studio interface" } });
  render(<PerformanceOutputs player={player()} />);
  expect(await screen.findByRole("option", { name: "Studio interface (not connected)" })).toBeTruthy();
});

it("offers only the channel pairs the main device has", async () => {
  const { unmount } = render(<PerformanceOutputs player={player(2)} />);
  expect(screen.getByLabelText("Click outputs").querySelectorAll("option")).toHaveLength(1);
  unmount();
  render(<PerformanceOutputs player={player(4)} />);
  expect(screen.getByLabelText("Click outputs").querySelectorAll("option")).toHaveLength(2);
});

it("sets a bus's channel pair and gain", () => {
  render(<PerformanceOutputs player={player(6)} />);
  fireEvent.change(screen.getByLabelText("Aux 1 outputs"), { target: { value: "4" } });
  expect(useOutputSettings.getState().config.buses.aux1.channels).toEqual([4, 5]);
  fireEvent.change(screen.getByLabelText("Aux 1 gain"), { target: { value: "0.5" } });
  expect(useOutputSettings.getState().config.buses.aux1.gain).toBe(0.5);
});

it("plays a tone on one bus at a time", () => {
  const tone = player();
  render(<PerformanceOutputs player={tone} />);
  fireEvent.click(screen.getByRole("button", { name: "Test Aux 2" }));
  expect(tone.testTone).toHaveBeenCalledTimes(1);
  expect(tone.testTone).toHaveBeenCalledWith("aux2");
});

it("sends the click to its own device, which takes away its channel pair", async () => {
  render(<PerformanceOutputs player={player(4)} />);
  const click = screen.getByLabelText("Click device");
  await waitFor(() => expect(click.querySelector('option[value="hp"]')).not.toBeNull());
  fireEvent.change(click, { target: { value: "hp" } });
  expect(useOutputSettings.getState().config.clickDevice).toEqual({ deviceId: "hp", label: "Headphones" });
  expect(screen.queryByLabelText("Click outputs")).toBeNull();
  fireEvent.change(click, { target: { value: "" } });
  expect(useOutputSettings.getState().config.clickDevice).toBeNull();
});
