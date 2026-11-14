import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NeckDiagram } from "./NeckDiagram";
import { scalePositions } from "@/song/performance/scales";

// A minor pentatonic, position 1: the box at the 5th fret
const position = scalePositions(9, "minorPentatonic")[0];

function renderDiagram(props: Partial<React.ComponentProps<typeof NeckDiagram>> = {}) {
  return render(<NeckDiagram notes={position.notes} labels="fret" flats={false} title="A minor pentatonic, position 1" {...props} />);
}

describe("NeckDiagram", () => {
  afterEach(cleanup);

  it("draws one circle per note and names the scale for screen readers", () => {
    renderDiagram();
    expect(screen.getAllByTestId("neck-note")).toHaveLength(position.notes.length);
    expect(screen.getByRole("img", { name: "A minor pentatonic, position 1" })).toBeTruthy();
  });

  it("fills the roots and outlines the other notes", () => {
    renderDiagram();
    const notes = screen.getAllByTestId("neck-note");
    const roots = notes.filter((note) => note.getAttribute("data-root") === "true");
    expect(roots).toHaveLength(position.notes.filter((note) => note.root).length);
    expect(roots[0].querySelector("circle")?.getAttribute("class")).toContain("fill-sky-400");
    const other = notes.find((note) => note.getAttribute("data-root") === "false");
    expect(other?.querySelector("circle")?.getAttribute("class")).toContain("fill-background");
  });

  it("writes fret numbers or note names inside the circles", () => {
    const { unmount } = renderDiagram({ labels: "fret" });
    expect(screen.getAllByTestId("neck-note")[0].textContent).toBe("5");
    unmount();
    renderDiagram({ labels: "note" });
    expect(screen.getAllByTestId("neck-note")[0].textContent).toBe("A");
  });

  it("spells note names with sharps or flats", () => {
    // A#/Bb minor pentatonic has Db/C# in it
    const notes = scalePositions(10, "minorPentatonic")[0].notes;
    const { unmount } = renderDiagram({ notes, labels: "note", flats: true });
    const flatLabels = screen.getAllByTestId("neck-note").map((note) => note.textContent);
    expect(flatLabels).toContain("Db");
    expect(flatLabels).not.toContain("C#");
    unmount();
    renderDiagram({ notes, labels: "note", flats: false });
    const sharpLabels = screen.getAllByTestId("neck-note").map((note) => note.textContent);
    expect(sharpLabels).toContain("C#");
    expect(sharpLabels).not.toContain("Db");
  });

  it("keeps every note at full strength with no highlight", () => {
    renderDiagram();
    expect(screen.getAllByTestId("neck-note").every((note) => note.getAttribute("data-dimmed") === "false")).toBe(true);
  });

  it("dims the notes outside the highlighted spans", () => {
    renderDiagram({ highlight: [{ fromFret: 5, toFret: 5 }] });
    for (const note of screen.getAllByTestId("neck-note")) {
      const onFifth = note.textContent === "5";
      expect(note.getAttribute("data-dimmed")).toBe(String(!onFifth));
      expect(note.getAttribute("opacity")).toBe(onFifth ? "1" : "0.25");
    }
  });

  it("lists the frets of each string from high e to low E, like tab", () => {
    renderDiagram();
    const lines = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["high e: 5 8", "B: 5 8", "G: 5 7", "D: 5 7", "A: 5 7", "low E: 5 8"]);
  });
});
