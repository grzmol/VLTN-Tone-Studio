import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { undo } from "@codemirror/commands";
import { findNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTypingTarget } from "@/song/performance/bindings";
import ChartCodeEditor from "./ChartCodeEditor";

const chart = "[00:01] [Am]Your lyrics {midi:pc 1 12}\n# Chorus\n[00:05] [C]Words // note";

function editor(text: string, onChange = vi.fn()) {
  const view = render(<ChartCodeEditor label="Lyrics and MIDI chart" value={text} hint="Chart" onChange={onChange} />);
  const content = screen.getByLabelText("Lyrics and MIDI chart");
  const cm = EditorView.findFromDOM(content)!;
  return { ...view, content, cm, onChange };
}

describe("ChartCodeEditor", () => {
  afterEach(cleanup);

  it("shows the chart and keeps its text exactly", () => {
    const { cm, onChange } = editor(chart);
    expect(cm.state.sliceDoc()).toBe(chart);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps spaces, tabs, a trailing newline and CRLF line breaks", () => {
    const text = "[00:01] [Am]  two  spaces\tand a tab \r\n# Heading\r\n[00:02] [C]end\r\n";
    const { cm } = editor(text);
    expect(cm.state.sliceDoc()).toBe(text);
  });

  it("reports typing with the text as the user left it", () => {
    const { cm, onChange } = editor(chart);
    act(() => {
      cm.dispatch({ changes: { from: cm.state.doc.length, insert: "\n[00:09] [G]More" }, userEvent: "input.type" });
    });
    expect(onChange).toHaveBeenLastCalledWith(chart + "\n[00:09] [G]More");
  });

  it("undoes an edit back to the value it started with", () => {
    const { cm, onChange } = editor(chart);
    act(() => {
      cm.dispatch({ changes: { from: 0, insert: "[D]" }, userEvent: "input.type" });
    });
    expect(onChange).toHaveBeenLastCalledWith("[D]" + chart);
    act(() => {
      undo(cm);
    });
    expect(cm.state.sliceDoc()).toBe(chart);
    expect(onChange).toHaveBeenLastCalledWith(chart);
  });

  it("undoes with Ctrl+Z from the keyboard", () => {
    const { cm, content, onChange } = editor(chart);
    act(() => {
      cm.dispatch({ changes: { from: 0, insert: "[D]" }, userEvent: "input.type" });
    });
    fireEvent.keyDown(content, { key: "z", ctrlKey: true });
    expect(cm.state.sliceDoc()).toBe(chart);
    expect(onChange).toHaveBeenLastCalledWith(chart);
  });

  it("opens search with Ctrl+F and finds a chord", () => {
    const { cm, content } = editor(chart);
    fireEvent.keyDown(content, { key: "f", ctrlKey: true });
    expect(document.querySelector(".cm-search")).not.toBeNull();
    act(() => {
      cm.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "[C]" })) });
      findNext(cm);
    });
    const { from, to } = cm.state.selection.main;
    expect(cm.state.doc.sliceString(from, to)).toBe("[C]");
  });

  it("follows a new value from the parent without reporting it back", () => {
    const { cm, onChange, rerender } = editor(chart);
    rerender(<ChartCodeEditor label="Lyrics and MIDI chart" value="[00:03] [F]Imported" hint="Chart" onChange={onChange} />);
    expect(cm.state.sliceDoc()).toBe("[00:03] [F]Imported");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is a typing target, so remote keys do not run while it has focus", () => {
    const { content } = editor(chart);
    // The key events of the editor come from its content element, which is the focused, editable node.
    expect(content.getAttribute("contenteditable")).toBe("true");
    expect(isTypingTarget(content)).toBe(true);
  });
});
