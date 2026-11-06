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
