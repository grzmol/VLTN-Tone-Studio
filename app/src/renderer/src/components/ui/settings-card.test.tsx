import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { SettingsCard } from "./settings-card";

/** The body a card button controls. */
function bodyOf(button: HTMLElement): HTMLElement {
  return document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

it("toggles its body from the title button", () => {
  render(
    <SettingsCard title="Outputs" storageKey="test-toggle" defaultOpen={false}>
      <p>Body text</p>
    </SettingsCard>,
  );
  const button = screen.getByRole("button", { name: "Outputs" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(bodyOf(button).hidden).toBe(true);
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(bodyOf(button).hidden).toBe(false);
});

it("remembers the open state per storage key", () => {
  const first = render(
    <SettingsCard title="Band sync" storageKey="test-remember" defaultOpen={true}>
      <p>Band body</p>
    </SettingsCard>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Band sync" }));
  expect(localStorage.getItem("vltn.card.test-remember")).toBe("closed");
  first.unmount();
  render(
    <SettingsCard title="Band sync" storageKey="test-remember" defaultOpen={true}>
      <p>Band body</p>
    </SettingsCard>,
  );
  expect(screen.getByRole("button", { name: "Band sync" }).getAttribute("aria-expanded")).toBe("false");
});

it("still opens and closes when storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  render(
    <SettingsCard title="Blocked" storageKey="test-throws" defaultOpen={false}>
      <p>Still here</p>
    </SettingsCard>,
  );
  const button = screen.getByRole("button", { name: "Blocked" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
});

it("keeps its actions usable while closed", () => {
  const onBlackout = vi.fn();
  render(
    <SettingsCard
      title="Audience display"
      storageKey="test-actions"
      defaultOpen={false}
      summary="Audience display is off"
      actions={<button onClick={onBlackout}>Blackout</button>}
    >
      <p>Hidden detail</p>
    </SettingsCard>,
  );
  expect(screen.getByText("Audience display is off")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Blackout" }));
  expect(onBlackout).toHaveBeenCalledTimes(1);
});

it("keeps the body mounted when closed", () => {
  let mounted = 0;
  let unmounted = 0;
  function Probe() {
    useEffect(() => {
      mounted += 1;
      return () => {
        unmounted += 1;
      };
    }, []);
    return <p>Probe</p>;
  }
  render(
    <SettingsCard title="Probe card" storageKey="test-mounted" defaultOpen={true}>
      <Probe />
    </SettingsCard>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Probe card" }));
  fireEvent.click(screen.getByRole("button", { name: "Probe card" }));
  expect(mounted).toBe(1);
  expect(unmounted).toBe(0);
  expect(screen.getByText("Probe")).toBeTruthy();
});
