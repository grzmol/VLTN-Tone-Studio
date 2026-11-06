import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { chartTokens, type ChartTokenKind } from "@/song/performance/chart-tokens";

/**
 * The chart's text box, with search, undo and colours for the chart's grammar. It is loaded on demand from the analysis panel, so the
 * CodeMirror code is not in the app until someone opens the chart editor. Keys in the editor are CodeMirror's own, and the remote key
 * bindings ignore them because the editor's text is a text field (`isTypingTarget`).
 */

/** Marks a change that came from the parent, so the editor does not report it back as the user's edit. */
const fromParent = Annotation.define<boolean>();

/** Keeps the document's own line breaks. `sliceDoc` joins lines with the separator, where `toString` would use `\n` and change the saved chart. */
function lineSeparator(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

const marks: Record<ChartTokenKind, Decoration> = {
  timestamp: Decoration.mark({ class: "cm-chart-timestamp" }),
  chord: Decoration.mark({ class: "cm-chart-chord" }),
  heading: Decoration.mark({ class: "cm-chart-heading" }),
  comment: Decoration.mark({ class: "cm-chart-comment" }),
  colour: Decoration.mark({ class: "cm-chart-colour" }),
  midi: Decoration.mark({ class: "cm-chart-midi" }),
  macro: Decoration.mark({ class: "cm-chart-macro" }),
  directive: Decoration.mark({ class: "cm-chart-directive" }),
};

/** The colours for the lines on screen. Each line's tokens are added in order, and a line is added once even when two ranges touch it. */
function colour(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = view.state.doc;
  let done = 0;
  for (const range of view.visibleRanges) {
    const last = doc.lineAt(range.to).number;
    for (let number = Math.max(done + 1, doc.lineAt(range.from).number); number <= last; number++) {
      const line = doc.line(number);
      for (const token of chartTokens(line.text)) ranges.push(marks[token.kind].range(line.from + token.from, line.from + token.to));
    }
    done = Math.max(done, last);
  }
  return Decoration.set(ranges, true);
}

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = colour(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = colour(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The colours come from the app's theme tokens, so the editor follows the theme. Its panels and gutters match the page's glass. */
const theme = EditorView.theme(
  {
    "&": { color: "var(--silkscreen-2)", backgroundColor: "transparent", fontSize: "0.875rem", maxHeight: "32rem" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--silkscreen)", padding: "0.5rem 0" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--silkscreen-4)", borderRight: "1px solid var(--seam)" },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.04)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--silkscreen-2)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgb(255 255 255 / 0.18)" },
    ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)", borderColor: "var(--seam)" },
    ".cm-textfield": { backgroundColor: "transparent", color: "var(--silkscreen)", border: "1px solid var(--seam-strong)", borderRadius: "0.25rem" },
    ".cm-button": { backgroundImage: "none", backgroundColor: "transparent", color: "var(--silkscreen-2)", border: "1px solid var(--seam-strong)" },
    ".cm-searchMatch": { backgroundColor: "rgb(250 204 21 / 0.3)" },
    ".cm-searchMatch-selected": { backgroundColor: "rgb(250 204 21 / 0.6)" },
    ".cm-chart-timestamp": { color: "var(--block-mod)", fontWeight: "600" },
    ".cm-chart-chord": { color: "var(--block-pre)", fontWeight: "600" },
    ".cm-chart-heading": { color: "var(--silkscreen)", fontWeight: "700" },
    ".cm-chart-comment": { color: "var(--silkscreen-4)", fontStyle: "italic" },
    ".cm-chart-colour": { color: "var(--block-dly)" },
    ".cm-chart-midi": { color: "var(--block-eq)" },
    ".cm-chart-macro": { color: "var(--block-rvb)", fontWeight: "600" },
    ".cm-chart-directive": { color: "var(--block-ns)" },
  },
  { dark: true },
);

function createState(doc: string, label: string, hint: string, onChange: (text: string) => void): EditorState {
  const extensions: Extension[] = [
    EditorState.lineSeparator.of(lineSeparator(doc)),
    lineNumbers(),
    history(),
    search({ top: true }),
    // Mod-h opens the same panel as Mod-f, which already shows its replace field.
    keymap.of([{ key: "Mod-h", run: openSearchPanel, preventDefault: true }, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
    placeholder(hint),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": label }),
    highlight,
    theme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((t) => t.annotation(fromParent))) onChange(update.state.sliceDoc());
    }),
  ];
  return EditorState.create({ doc, extensions });
}

/** A chart's text box. `value` is the saved text; `onChange` gets the new text after each edit, with its line breaks as they were. */
export default function ChartCodeEditor({
  value,
  label,
  hint,
  onChange,
}: {
  value: string;
  label: string;
  hint: string;
  onChange: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // The listener is created once, so it reads the latest callback through a ref.
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: createState(value, label, hint, (text) => changed.current(text)),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
    // The editor is created once. Later values are applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === value) return;
    // A different line break means a different separator, which only a new state can carry. History is lost then, which is rare.
    if (editor.state.facet(EditorState.lineSeparator) !== lineSeparator(value)) {
      editor.setState(createState(value, label, hint, (text) => changed.current(text)));
      return;
    }
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, annotations: fromParent.of(true) });
  }, [value, label, hint]);

  return <div ref={host} className="w-full overflow-hidden rounded border border-seam" />;
}
