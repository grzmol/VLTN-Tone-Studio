import { FRET_COUNT, noteName } from "@/song/performance/scales";
import type { NeckNote } from "@/song/performance/scales";

/** A span of frets, both ends included. */
export interface FretSpan {
  fromFret: number;
  toFret: number;
}

export interface NeckDiagramProps {
  notes: NeckNote[];
  /** Write the fret number or the note name inside each circle */
  labels: "fret" | "note";
  /** Spell note names with flats instead of sharps */
  flats: boolean;
  /** Notes inside one of these spans are full strength and the rest are dimmed. No spans means the whole neck is full strength. */
  highlight?: FretSpan[];
  /** Names what is shown, for screen readers */
  title: string;
  /** Highest fret drawn. Defaults to FRET_COUNT. */
  fretCount?: number;
}

// Layout in SVG units. The width of one fret cell is fixed so the numbers stay readable, and the wrapper scrolls on a narrow screen.
const FRET_WIDTH = 44;
const STRING_GAP = 28;
const NUT_X = 40;
const TOP = 18;
const NOTE_RADIUS = 11;
const FRET_MARKERS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_MARKER = 12;
const STRING_COUNT = 6;
// Names for the hidden list, high e first, like the lines of a tab
const STRING_NAMES = ["high e", "B", "G", "D", "A", "low E"];

function inSpan(fret: number, spans: FretSpan[]): boolean {
  return spans.some((span) => fret >= span.fromFret && fret <= span.toFret);
}

/**
 * The guitar neck drawn like tab: high e at the top, low E at the bottom, the nut on the left. Roots are filled with the accent colour and
 * the other notes are outlined. Standard tuning is assumed.
 */
export function NeckDiagram({ notes, labels, flats, highlight, title, fretCount = FRET_COUNT }: NeckDiagramProps) {
  const width = NUT_X + fretCount * FRET_WIDTH + 12;
  const stringsBottom = TOP + (STRING_COUNT - 1) * STRING_GAP;
  const height = stringsBottom + 36;
  const spans = highlight ?? [];

  const fretCentre = (fret: number): number => (fret === 0 ? NUT_X - 16 : NUT_X + (fret - 0.5) * FRET_WIDTH);
  const stringY = (string: number): number => TOP + (STRING_COUNT - 1 - string) * STRING_GAP;
  const middleY = (TOP + stringsBottom) / 2;

  const tabLines = STRING_NAMES.map((name, row) => {
    const string = STRING_COUNT - 1 - row;
    const frets = notes
      .filter((note) => note.string === string)
      .map((note) => note.fret)
      .sort((a, b) => a - b);
    return { name, frets };
  });

  return (
    <div className="overflow-x-auto">
      <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="max-w-none text-foreground">
        {/* Fret markers, behind everything else */}
        {FRET_MARKERS.filter((fret) => fret <= fretCount).map((fret) => (
          <circle key={fret} cx={fretCentre(fret)} cy={middleY} r={4} className="fill-seam" />
        ))}
        {DOUBLE_MARKER <= fretCount &&
          [-STRING_GAP, STRING_GAP].map((offset) => <circle key={offset} cx={fretCentre(DOUBLE_MARKER)} cy={middleY + offset} r={4} className="fill-seam" />)}

        {/* Fret wires, with a heavier nut */}
        {Array.from({ length: fretCount + 1 }, (_, fret) => (
          <line
            key={fret}
            x1={NUT_X + fret * FRET_WIDTH}
            x2={NUT_X + fret * FRET_WIDTH}
            y1={TOP}
            y2={stringsBottom}
            strokeWidth={fret === 0 ? 4 : 1}
            className={fret === 0 ? "stroke-silkscreen-3" : "stroke-seam"}
          />
        ))}

        {/* Strings */}
        {Array.from({ length: STRING_COUNT }, (_, string) => (
          <line
            key={string}
            x1={NUT_X}
            x2={NUT_X + fretCount * FRET_WIDTH}
            y1={stringY(string)}
            y2={stringY(string)}
            strokeWidth={1}
            className="stroke-seam-strong"
          />
        ))}

        {/* Fret numbers under the neck */}
        {Array.from({ length: fretCount }, (_, i) => (
          <text key={i + 1} x={fretCentre(i + 1)} y={stringsBottom + 26} textAnchor="middle" fontSize={11} className="fill-silkscreen-3">
            {i + 1}
          </text>
        ))}

        {/* Scale notes */}
        {notes.map((note) => {
          const dimmed = spans.length > 0 && !inSpan(note.fret, spans);
          const label = labels === "fret" ? String(note.fret) : noteName(note.pc, flats);
          return (
            <g
              key={`${note.string}-${note.fret}`}
              data-testid="neck-note"
              data-root={note.root}
              data-dimmed={dimmed}
              opacity={dimmed ? 0.25 : 1}
              className={note.root ? "text-sky-400" : "text-silkscreen-2"}
            >
              <circle
                cx={fretCentre(note.fret)}
                cy={stringY(note.string)}
                r={NOTE_RADIUS}
                strokeWidth={1.5}
                className={note.root ? "fill-sky-400 stroke-sky-400" : "fill-background stroke-current"}
              />
              <text
                x={fretCentre(note.fret)}
                y={stringY(note.string)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={labels === "note" ? 10 : 11}
                fontWeight={600}
                className={note.root ? "fill-slate-950" : "fill-foreground"}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="sr-only" aria-label={`${title}, frets on each string`}>
        {tabLines.map((line) => (
          <li key={line.name}>
            {line.name}: {line.frets.length ? line.frets.join(" ") : "no notes"}
          </li>
        ))}
      </ul>
    </div>
  );
}
