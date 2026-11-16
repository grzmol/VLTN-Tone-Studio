import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CMD } from "@/gp150/lib/protocol.mjs";
import { parsePrst } from "@/gp150/lib/prst.mjs";
import { useDevice, getDriver } from "@/state/device";
import { Gp150Driver } from "@/state/driver/gp150-driver";
import { resetStageActivity, setStageBusy } from "@/state/stage-activity";
import { NamSlots } from "./NamSlots";

const mock = () => (getDriver() as Gp150Driver).mock!;
beforeEach(async () => {
  resetStageActivity();
  await useDevice.getState().connect("mock", { mockDevice: "gp180" });
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  resetStageActivity();
  await useDevice.getState().disconnect();
});

async function readSlots() {
  fireEvent.click(screen.getByRole("button", { name: "Read NAM slots" }));
  await waitFor(() => expect(screen.getByText(/NAM slots 1–100/)).toBeTruthy());
  fireEvent.click(screen.getByText(/NAM slots 1–100/));
}

it("lists the simulator's 100 NAM slots and confirms a rename without modifying its preset or SnapTones", async () => {
  const original = mock().editBuffer.slice();
  render(<NamSlots />);
  await readSlots();
  expect(screen.getAllByRole("button", { name: /^Rename NAM slot/ })).toHaveLength(100);
  expect(screen.queryByRole("button", { name: "Rename NAM slot 0" })).toBeNull();
  expect(screen.getByRole("button", { name: "Rename NAM slot 100" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Rename NAM slot 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "NAM name" }), { target: { value: "Lead NAM" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mock().namNames[1].name).toBe("NAM 1");
  fireEvent.click(screen.getByRole("button", { name: "Rename NAM slot 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "NAM name" }), { target: { value: "Lead NAM" } });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByText("Lead NAM")).toBeTruthy();
  expect(mock().snapToneNames[1].name).toBe("Factory 1");
  expect(mock().editBuffer).toEqual(original);
  expect(mock().received.some((m) => m.cmd === CMD.NAM_UPLOAD)).toBe(false);
});

it("updates the preset mode live, tracks an unsaved change and preserves its settings on save", async () => {
  const before = parsePrst(mock().editBuffer);
  render(<NamSlots />);
  expect(screen.getByText("This preset uses: SnapTone")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Use NAM for this preset" }));
  await waitFor(() => expect(parsePrst(mock().editBuffer).namMode).toBe(1));
  expect(screen.getByText("This preset uses: NAM")).toBeTruthy();
  expect(useDevice.getState().unsavedChanges).toBe(1);
  expect(parsePrst(mock().editBuffer)).toMatchObject({ name: before.name, tempo: before.tempo, volume: before.volume, blocks: before.blocks });
  await useDevice.getState().saveToSlot(before.slot);
  expect(parsePrst(mock().presets[before.slot]).namMode).toBe(1);
  expect(useDevice.getState().unsavedChanges).toBe(0);
});

it("keeps a failed rename open and refuses empty or unsupported names", async () => {
  render(<NamSlots />);
  await readSlots();
  fireEvent.click(screen.getByRole("button", { name: "Rename NAM slot 1" }));
  const input = screen.getByRole("textbox", { name: "NAM name" });
  for (const value of ["", "   ", "écho"]) {
    fireEvent.change(input, { target: { value } });
    expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.change(input, { target: { value: "Lead" } });
  vi.spyOn(getDriver()!, "renameNam").mockRejectedValueOnce(new Error("Readback failed"));
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("Readback failed"));
  expect(mock().namNames[1].name).toBe("NAM 1");
});

it("blocks NAM traffic during a performance and hides the panel for other pedal families", async () => {
  setStageBusy(true, "nam-test");
  const before = mock().received.length;
  const view = render(<NamSlots />);
  expect((screen.getByRole("button", { name: "Read NAM slots" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  await expect(useDevice.getState().readNams()).rejects.toThrow("Stop the performance");
  await expect(useDevice.getState().renameNam(1, "Blocked")).rejects.toThrow("Stop the performance");
  expect(() => useDevice.getState().setNamMode(1)).toThrow("Stop the performance");
  expect(mock().received).toHaveLength(before);
  useDevice.setState({ features: [] });
  view.rerender(<NamSlots />);
  expect(screen.queryByLabelText("NAM slots")).toBeNull();
});

it("drops an unconfirmed rename when the pedal connection changes", async () => {
  render(<NamSlots />);
  await readSlots();
  fireEvent.click(screen.getByRole("button", { name: "Rename NAM slot 1" }));
  fireEvent.change(screen.getByRole("textbox", { name: "NAM name" }), { target: { value: "Old pedal" } });
  await useDevice.getState().disconnect();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await useDevice.getState().connect("mock", { mockDevice: "gp180" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Read NAM slots" })).toBeTruthy());
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mock().namNames[1].name).toBe("NAM 1");
});
