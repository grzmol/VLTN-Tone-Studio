import { Button } from "@/components/ui/button";
import { ANNOTATION_COLOURS, type AnnotationTool } from "@/song/performance/pdf/annotations";
import type { ChartLayout } from "@/song/performance/pdf/layout";

/** The tools a performer can pick on the PDF. Annotation tools are left out in stage mode, where the chart is read only. */
const TOOLS: { tool: AnnotationTool; label: string }[] = [
  { tool: "pen", label: "Pen" },
  { tool: "highlighter", label: "Highlighter" },
  { tool: "text", label: "Text note" },
];

export interface PdfToolbarProps {
  layout: ChartLayout;
  onLayout(layout: ChartLayout): void;
  page: number;
  pages: number;
  onPage(direction: -1 | 1): void;
  /** Whether annotation and page-turn editing is offered (not in stage mode). */
  editing: boolean;
  tool: AnnotationTool;
  onTool(tool: AnnotationTool): void;
  colour: string;
  onColour(colour: string): void;
  onUndo(): void;
  onClearPage(): void;
  turns: number;
  onTurnNow(): void;
  onClearTurns(): void;
}

/** The PDF's controls: the layout, the page, the annotation tools and the page turns. Plain buttons, sized to read on a stand. */
export function PdfToolbar(props: PdfToolbarProps) {
  const { layout, page, pages, editing, tool, colour } = props;
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 text-sm" aria-label="PDF chart controls">
      <Button variant="outline" aria-pressed={layout === "scroll"} onClick={() => props.onLayout("scroll")}>
        Scroll
      </Button>
      <Button variant="outline" aria-pressed={layout === "page"} onClick={() => props.onLayout("page")}>
        Page
      </Button>
      <Button variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => props.onPage(-1)}>
        Previous
      </Button>
      <span className="tabular-nums text-silkscreen-3" aria-live="polite">
        Page {page} of {pages}
      </span>
      <Button variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => props.onPage(1)}>
        Next
      </Button>
      {editing && (
        <>
          <span className="ml-2 text-silkscreen-3">Mark:</span>
          {TOOLS.map((option) => (
            <Button key={option.tool} variant="outline" aria-pressed={tool === option.tool} onClick={() => props.onTool(tool === option.tool ? "none" : option.tool)}>
              {option.label}
            </Button>
          ))}
          <div className="flex items-center gap-1" role="group" aria-label="Mark colour">
            {ANNOTATION_COLOURS.map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`Colour ${value}`}
                aria-pressed={colour === value}
                onClick={() => props.onColour(value)}
                className={"size-6 rounded-full border border-seam " + (colour === value ? "ring-2 ring-sky-400" : "")}
                style={{ background: value }}
              />
            ))}
          </div>
          <Button variant="outline" onClick={props.onUndo}>
            Undo mark
          </Button>
          <Button variant="outline" onClick={props.onClearPage}>
            Clear page marks
          </Button>
          <span className="ml-2 text-silkscreen-3">Page turns: {props.turns}</span>
          <Button variant="outline" onClick={props.onTurnNow}>
            Turn page at this time
          </Button>
          <Button variant="outline" disabled={!props.turns} onClick={props.onClearTurns}>
            Clear page turns
          </Button>
        </>
      )}
    </div>
  );
}
