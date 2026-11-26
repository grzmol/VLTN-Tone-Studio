import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SongShapeControls } from "./SongShapeControls";
import type { PcmAudio } from "@/song/types";

const key = "vltn.performance.v1:shape-test";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Ten frames per second: sound from second 1 up to second 3, silence around it. */
const audio = (): PcmAudio => {
  const channel = new Float32Array(50);
  channel.fill(0.5, 10, 30);
  return { sampleRate: 10, channels: [channel] };
};

const stored = () => JSON.parse(localStorage.getItem(key + ":options") ?? "{}");

it("trims a song to its audible part with Auto, and saves it with the song's options", () => {
  const onChange = vi.fn();
  render(<SongShapeControls songKey={key} audio={audio()} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Auto" }));
  expect(stored()).toMatchObject({ trimStart: 1, trimEnd: 3 });
  expect(onChange).toHaveBeenCalled();
});

it("saves fades and the end behaviour, keeping other options", () => {
  localStorage.setItem(key + ":options", JSON.stringify({ firstBeat: 0.5 }));
  render(<SongShapeControls songKey={key} audio={audio()} onChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Fade out (s)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("At the end"), { target: { value: "loop" } });
  expect(stored()).toMatchObject({ firstBeat: 0.5, fadeOut: 2, endBehaviour: "loop" });
});

it("says so, and trims nothing, when the song is silent", () => {
  render(<SongShapeControls songKey={key} audio={{ sampleRate: 10, channels: [new Float32Array(20)] }} onChange={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Auto" }));
  expect(screen.getByRole("status").textContent).toContain("silent");
  expect(localStorage.getItem(key + ":options")).toBeNull();
});

it("offers only end silence and preserves the automatic start", () => {
  const onChange = vi.fn();
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 3 }} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Trim end silence (2 s)" }));
  expect(stored().trimStart).toBeUndefined();
  expect(stored().trimEnd).toBe(3);
  expect(onChange).toHaveBeenCalled();
});

it("does not offer a trim once one is set, and offers nothing without silence", () => {
  localStorage.setItem(key + ":options", JSON.stringify({ trimStart: 0.5, trimEnd: 3 }));
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 3 }} onChange={vi.fn()} />);
  expect(screen.queryByRole("button", { name: /Trim end silence/ })).toBeNull();
});

it("shows the silence skipped at the start when no trim start is set, and none once one is", () => {
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 3 }} onChange={vi.fn()} />);
  expect(screen.getByLabelText("Trim start (s)").getAttribute("placeholder")).toBe("1 (silence skipped)");
  fireEvent.change(screen.getByLabelText("Trim start (s)"), { target: { value: "0" } });
  expect(screen.getByLabelText("Trim start (s)").getAttribute("placeholder")).toBeNull();
  expect(stored()).toMatchObject({ trimStart: 0 });
});

it("shows automatic skipping and allows keeping the intro across reloads", () => {
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 5 }} onChange={vi.fn()} />);
  expect(screen.getByText(/Automatically skipping 1 s/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Trim end silence/ })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Play from the very start" }));
  expect(stored().trimStart).toBe(0);
  expect(screen.getByText(/Playing from the very start, including/)).toBeTruthy();
  cleanup();
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 5 }} onChange={vi.fn()} />);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(stored().trimStart).toBeUndefined();
  expect(screen.getByText(/Automatically skipping 1 s/)).toBeTruthy();
});

it("preserves a manual start when accepting the end silence", () => {
  localStorage.setItem(key + ":options", JSON.stringify({ trimStart: 0 }));
  render(<SongShapeControls songKey={key} audio={audio()} silence={{ start: 1, end: 3 }} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Trim end silence/ }));
  expect(stored()).toMatchObject({ trimStart: 0, trimEnd: 3 });
});

it("shows a stored trim end rounded to two decimals with a dot, and never saves by showing it", () => {
  localStorage.setItem(key + ":options", JSON.stringify({ trimStart: 0.0000226757369614, trimEnd: 329.99997732426306 }));
  const onChange = vi.fn();
  render(<SongShapeControls songKey={key} audio={audio()} onChange={onChange} />);
  const end = screen.getByLabelText("Trim end (s)") as HTMLInputElement;
  expect(end.value).toBe("330");
  expect((screen.getByLabelText("Trim start (s)") as HTMLInputElement).value).toBe("0");
  fireEvent.focus(end);
  fireEvent.blur(end);
  expect(onChange).not.toHaveBeenCalled();
  expect(stored().trimEnd).toBe(329.99997732426306);
});

it("takes a comma as the decimal mark and keeps half-typed text without saving it", () => {
  render(<SongShapeControls songKey={key} audio={audio()} onChange={vi.fn()} />);
  const end = screen.getByLabelText("Trim end (s)") as HTMLInputElement;
  fireEvent.change(end, { target: { value: "12,5" } });
  expect(stored().trimEnd).toBe(12.5);
  fireEvent.change(end, { target: { value: "12,5x" } });
  expect(end.value).toBe("12,5x");
  expect(stored().trimEnd).toBe(12.5);
  fireEvent.blur(end);
  expect(end.value).toBe("12.5");
});
