import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Rc10rSetupCard, rc10rSummary, type Rc10rSetupState } from "./Rc10rSetupCard";
import { resolveDrums } from "@/song/band/drum-source";

afterEach(cleanup);

const ready = (over: Partial<Rc10rSetupState> = {}): Rc10rSetupState => {
  const base = { hasCues: true, transfer: "Transfer confirmed" as const, outputName: "GP-180", armed: true, choice: "pedal" as const, fallbackWhy: "" };
  const merged = { ...base, ...over };
  const drums = over.drums ?? resolveDrums({ choice: merged.choice, fallback: "generated", hasRhythmCues: merged.hasCues, armed: merged.armed && !!merged.outputName });
  return { ...merged, drums };
};
const actions = () => ({ onChoosePedalDrums: vi.fn(), onEnableMidi: vi.fn(), onChooseOutput: vi.fn(), onSendCues: vi.fn() });
const show = (state: Rc10rSetupState, a = actions()) => {
  render(
    <Rc10rSetupCard state={state} {...a}>
      <p>advanced</p>
    </Rc10rSetupCard>,
  );
  return a;
};
const line = (id: string) => document.querySelector(`[data-line="${id}"]`) as HTMLElement;

it("shows every line ticked and the ready summary when all is set", () => {
  show(ready());
  for (const id of ["cues", "transfer", "output", "send", "drums"]) expect(line(id).dataset.ok).toBe("true");
  expect(screen.getAllByText("Ready: the RC-10R plays drums").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /Build cues|Confirm transfer|Choose output|Turn on Send cues|Use pedal drums/ })).toBeNull();
  expect(within(line("output")).getByText(/GP-180/)).toBeTruthy();
});

it("marks missing cues and opens Details to build them", () => {
  show(ready({ hasCues: false }));
  expect(line("cues").dataset.ok).toBe("false");
  expect(document.querySelector("details")!.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Build cues…" }));
  expect(document.querySelector("details")!.open).toBe(true);
});

it("marks an unconfirmed transfer", () => {
  show(ready({ transfer: "Needs transfer confirmation" }));
  expect(line("transfer").dataset.ok).toBe("false");
  expect(line("transfer").textContent).toContain("Needs transfer confirmation");
  fireEvent.click(screen.getByRole("button", { name: "Confirm transfer…" }));
  expect(document.querySelector("details")!.open).toBe(true);
});

it("marks a missing output and offers the existing output actions", () => {
  const a = show(ready({ outputName: "", armed: false }));
  expect(line("output").dataset.ok).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Choose output" }));
  fireEvent.click(screen.getByRole("button", { name: "Enable system MIDI" }));
  expect(a.onChooseOutput).toHaveBeenCalled();
  expect(a.onEnableMidi).toHaveBeenCalled();
});

it("marks Send cues off and turns it on", () => {
  const a = show(ready({ armed: false }));
  expect(line("send").dataset.ok).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Turn on Send cues" }));
  expect(a.onSendCues).toHaveBeenCalled();
});

it("marks drums that are not the pedal and chooses pedal drums", () => {
  const a = show(ready({ choice: "generated" }));
  expect(line("drums").dataset.ok).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Use pedal drums for this song" }));
  expect(a.onChoosePedalDrums).toHaveBeenCalled();
});

it("says the fallback when the pedal was chosen but is not ready", () => {
  show(ready({ armed: false, fallbackWhy: "Send cues off" }));
  expect(screen.getAllByText(/Not ready: playing generated drums \(fallback\)/).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("status")[0].textContent).toContain("Send cues off");
});

it("keeps the advanced controls inside a collapsed Details", () => {
  show(ready());
  const details = document.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain("advanced");
});

it("summary follows resolveDrums", () => {
  const choice = "pedal" as const;
  expect(rc10rSummary({ choice, drums: resolveDrums({ choice, fallback: "original", hasRhythmCues: false, armed: true }) })).toBe(
    "Not ready: playing original drums (fallback)",
  );
  expect(rc10rSummary({ choice: "both", drums: resolveDrums({ choice: "both", fallback: "original", hasRhythmCues: true, armed: true }) })).toBe(
    "Not ready: this song plays both drums, not the RC-10R",
  );
});
