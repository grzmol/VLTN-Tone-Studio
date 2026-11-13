import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useDevice } from "@/state/device";
import { useKnownPresetNames, usePresetNames } from "./use-preset-names";

afterEach(() => {
  cleanup();
  localStorage.clear();
  useDevice.setState({ device: null, status: "idle", names: [], lastConnectedAt: null });
});

it("returns the same objects across a re-render until the pedal's names change", () => {
  useDevice.setState({ device: "gp180", status: "connected", names: [{ slot: 0, name: "Clean" }] });
  const known = renderHook(() => useKnownPresetNames());
  const picker = renderHook(() => usePresetNames("gp180"));
  const [first, firstPicker] = [known.result.current, picker.result.current];
  expect(first?.names[0]).toBe("Clean");
  known.rerender();
  picker.rerender();
  expect(known.result.current).toBe(first);
  expect(picker.result.current).toBe(firstPicker);
  act(() => useDevice.setState({ names: [{ slot: 0, name: "Crunch" }] }));
  expect(known.result.current).not.toBe(first);
  expect(known.result.current?.names[0]).toBe("Crunch");
  expect(picker.result.current.presetNames?.names[0]).toBe("Crunch");
});
