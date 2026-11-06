import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MidiFileField } from "./MidiFileField";
import { encodeMidiFile } from "@/song/performance/smf";

afterEach(cleanup);

/** A format 0 file with one note-on at tick 96 (half a second at 120 BPM). */
const valid = new Uint8Array([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 77, 84, 114, 107, 0, 0, 0, 8, 96, 0x90, 60, 90, 0, 0xff, 0x2f, 0]);

it("saves a valid file with its name, and shows its size and length", async () => {
  const onChange = vi.fn();
  render(<MidiFileField file={null} onChange={onChange} />);
  const input = screen.getByLabelText("Song MIDI file input");
  fireEvent.change(input, { target: { files: [new File([valid], "lead.mid", { type: "audio/midi" })] } });
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.calls[0][0]).toMatchObject({ name: "lead.mid" });
});

it("refuses a file that is not MIDI, and saves nothing", async () => {
  const onChange = vi.fn();
  render(<MidiFileField file={null} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Song MIDI file input"), { target: { files: [new File(["not midi"], "notes.mid")] } });
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it("shows a saved file's summary and removes it", () => {
  const onChange = vi.fn();
  render(<MidiFileField file={encodeMidiFile("lead.mid", valid)} onChange={onChange} />);
  expect(screen.getByRole("status").textContent).toBe("lead.mid · 1 messages · 0.5 s");
  fireEvent.click(screen.getByText("Remove MIDI file"));
  expect(onChange).toHaveBeenCalledWith(null);
});
