import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenBoundary, detailsText, errorLine } from "./ScreenBoundary";

// A child that throws while rendering until `broken` is cleared, so Reload screen can recover it.
let broken = true;
function FlakyRender() {
  if (broken) throw new Error("render boom");
  return <p>rendered child</p>;
}

function EffectCrash(): null {
  useEffect(() => {
    throw new Error("effect boom");
  }, []);
  return null;
}

beforeEach(() => {
  broken = true;
  // React logs every caught error to the console; the tests check the panel, not the log.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ScreenBoundary", () => {
  it("shows the panel when a child throws in render, with the one-line message", async () => {
    render(
      <ScreenBoundary name="Test screen">
        <FlakyRender />
      </ScreenBoundary>,
    );
    expect(await screen.findByText("This screen hit a problem.")).toBeTruthy();
    expect(screen.getByText("render boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload screen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
  });

  it("shows the panel when a child throws inside useEffect", async () => {
    render(
      <ScreenBoundary name="Test screen">
        <EffectCrash />
      </ScreenBoundary>,
    );
    expect(await screen.findByText("This screen hit a problem.")).toBeTruthy();
    expect(screen.getByText("effect boom")).toBeTruthy();
  });

  it("keeps siblings outside the boundary rendered", async () => {
    render(
      <>
        <ScreenBoundary name="Broken view">
          <FlakyRender />
        </ScreenBoundary>
        <p>sibling view</p>
      </>,
    );
    expect(await screen.findByText("This screen hit a problem.")).toBeTruthy();
    expect(screen.getByText("sibling view")).toBeTruthy();
  });

  it("Reload screen remounts the children", async () => {
    render(
      <ScreenBoundary name="Test screen">
        <FlakyRender />
      </ScreenBoundary>,
    );
    await screen.findByText("This screen hit a problem.");
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload screen" }));
    expect(await screen.findByText("rendered child")).toBeTruthy();
    expect(screen.queryByText("This screen hit a problem.")).toBeNull();
  });

  it("Copy details writes the message and component stack to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <ScreenBoundary name="Test screen">
        <FlakyRender />
      </ScreenBoundary>,
    );
    await screen.findByText("This screen hit a problem.");
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0];
    expect(copied).toContain("Screen: Test screen");
    expect(copied).toContain("render boom");
    expect(copied).toContain("Component stack:");
  });

  it("offers Reload app in the app scope", async () => {
    render(
      <ScreenBoundary name="app" scope="app">
        <FlakyRender />
      </ScreenBoundary>,
    );
    expect(await screen.findByText("This app hit a problem.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload app" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload screen" })).toBeNull();
  });
});

describe("error helpers", () => {
  it("keeps only the first line of a long message", () => {
    expect(errorLine(new Error("first line\nsecond line"))).toBe("first line");
  });

  it("truncates a very long message", () => {
    const line = errorLine(new Error("x".repeat(500)));
    expect(line.length).toBe(200);
    expect(line.endsWith("...")).toBe(true);
  });

  it("detailsText leaves out the component stack when there is none", () => {
    const text = detailsText("Stems", new Error("bad"), "");
    expect(text).toContain("Screen: Stems");
    expect(text).not.toContain("Component stack:");
  });
});
