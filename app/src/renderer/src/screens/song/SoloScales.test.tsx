import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSettingsCache, getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { SoloScales } from "./SoloScales";

const KEY = "solo-test-song";

type Props = React.ComponentProps<typeof SoloScales>;
const show = (props: Partial<Props> = {}) => render(<SoloScales songKey="A minor" shift={0} capo={0} storageKey={KEY} {...props} />);
const saved = () => readOptions<Record<string, unknown>>(KEY, {});
const frets = () => screen.getAllByTestId("neck-note").map((n) => n.textContent);
const lit = () =>
  screen
    .getAllByTestId("neck-note")
    .filter((n) => n.getAttribute("data-dimmed") === "false")
    .map((n) => Number(n.textContent));
const select = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  localStorage.clear();
  clearSettingsCache();
});
afterEach(cleanup);

describe("SoloScales", () => {
  it("opens on the minor pentatonic from the song key", () => {
    show();
    expect((screen.getByLabelText("Scale") as HTMLSelectElement).value).toBe("minorPentatonic");
    expect((screen.getByLabelText("Root") as HTMLSelectElement).value).toBe("key");
    expect(screen.getByText("A minor pentatonic.")).toBeTruthy();
    expect(screen.getByRole("img", { name: "A minor pentatonic, whole neck" })).toBeTruthy();
  });

  it("uses the relative minor for a major key and says why", () => {
    show({ songKey: "A major" });
    expect(screen.getByText("F# minor pentatonic: the same notes as A major pentatonic, the song's key.")).toBeTruthy();
  });

  it("saves the scale and root with the other options", () => {
    setSetting(KEY, ":options", JSON.stringify({ beats: 3 }));
    show();
    select("Scale", "dorian");
    select("Root", "4");
    expect(saved()).toMatchObject({ beats: 3, soloScale: { scale: "dorian", root: 4 } });
    select("Root", "key");
    expect(saved().soloScale).toEqual({ scale: "dorian" });
    expect(getSetting(KEY, ":options")).toContain("beats");
  });

  it("starts from the saved choice", () => {
    setSetting(KEY, ":options", JSON.stringify({ soloScale: { scale: "blues", root: 2 } }));
    show();
    expect((screen.getByLabelText("Scale") as HTMLSelectElement).value).toBe("blues");
    expect(screen.getByText("D blues.")).toBeTruthy();
  });

  it("highlights the chosen position and its copy an octave up", () => {
    show();
    const dimmed = () => screen.getAllByTestId("neck-note").filter((n) => n.getAttribute("data-dimmed") === "true").length;
    expect(dimmed()).toBe(0);
    select("Position", "1");
    expect(dimmed()).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: "A minor pentatonic, position 1" })).toBeTruthy();
    select("Position", "all");
    expect(dimmed()).toBe(0);
  });

  it("switches between frets and notes, and remembers it", () => {
    const { unmount } = show();
    expect(frets()[0]).toMatch(/^\d+$/);
    select("Show", "note");
    expect(frets()[0]).toMatch(/^[A-G]/);
    expect(localStorage.getItem("vltn.soloScale.labels")).toBe("note");
    unmount();
    show();
    expect((screen.getByLabelText("Show") as HTMLSelectElement).value).toBe("note");
  });

  it("counts frets from the capo and moves the shapes down", () => {
    const { unmount } = show();
    select("Position", "1");
    const first = Math.min(...lit());
    unmount();
    show({ shift: -2, capo: 2 });
    expect(screen.getByText(/Frets are counted from the capo \(capo 2\)\./)).toBeTruthy();
    expect(screen.getByText(/^G minor pentatonic/)).toBeTruthy();
    select("Position", "1");
    const lowest = Math.min(...lit());
    expect(lowest).toBe(first - 2);
  });

  it("asks for a key when none is known", () => {
    show({ songKey: undefined });
    expect(screen.getByText("Set the song's key to see the scale.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
