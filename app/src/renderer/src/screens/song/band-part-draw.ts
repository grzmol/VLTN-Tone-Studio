// Draws one section of the part view on a canvas (a chorus has about 700 notes, too many for elements). The sizes here are CSS pixels; the
// canvas is scaled for the screen's pixel ratio by the caller. The positions come from band-part-layout.ts.

import { BARS_PER_LINE, DRUM_LANES, noteName, type DrumDot, type DrumLane, type PartBar, type SectionLayout } from "./band-part-layout";

/** The width of the left gutter, where the lane names and the bass note names go. */
export const GUTTER = 40;
const CHORD_HEIGHT = 20;
const LANE_HEIGHT = 14;
const TOMS_HEIGHT = 26;
const BASS_HEIGHT = 64;
/** The row under the bass for the bar numbers, and the gap between lines. */
const NUMBER_HEIGHT = 14;
const LINE_GAP = 10;
/** Two note names are never drawn closer than this, in pixels. */
const LABEL_SPACING = 11;
const DRUMS_TOP = CHORD_HEIGHT;
const DRUMS_HEIGHT = LANE_HEIGHT * (DRUM_LANES.length - 1) + TOMS_HEIGHT;
const BASS_TOP = DRUMS_TOP + DRUMS_HEIGHT + 6;
/** The height of one line of four bars, with the gap under it. */
export const LINE_HEIGHT = BASS_TOP + BASS_HEIGHT + NUMBER_HEIGHT + LINE_GAP;

const LANE_NAMES: Record<DrumLane, string> = { crash: "Crash", ride: "Ride", "open-hat": "Open", hat: "Hat", toms: "Toms", snare: "Snare", kick: "Kick" };

/** The colours the view draws with, read from the page so a theme change reaches the canvas. */
export interface PartColours {
  drums: string;
  bass: string;
  text: string;
  /** The brighter text of the chord names and the bar numbers. */
  strong: string;
  line: string;
  /** The section's own tint, behind the chord names. */
  section: string;
}

/** The top and height of a drum lane inside a line, in pixels. */
function laneBox(lane: DrumLane): { top: number; height: number } {
  let top = DRUMS_TOP;
  for (const name of DRUM_LANES) {
    const height = name === "toms" ? TOMS_HEIGHT : LANE_HEIGHT;
    if (name === lane) return { top, height };
    top += height;
  }
  return { top, height: LANE_HEIGHT };
}

/** The vertical centre of a dot, where the toms' three heights share the toms lane. */
function dotY(dot: DrumDot): number {
  const { top, height } = laneBox(dot.lane);
  if (dot.lane !== "toms") return top + height / 2;
  return top + 4 + dot.height * ((height - 8) / 2);
}

/** The width of one bar on a canvas `width` pixels wide. */
export const barWidth = (width: number): number => (width - GUTTER) / BARS_PER_LINE;

/** The left edge of the bar at `column` of a line. */
export const barLeft = (width: number, column: number): number => GUTTER + column * barWidth(width);

function drawBar(
  ctx: CanvasRenderingContext2D,
  bar: PartBar,
  left: number,
  top: number,
  width: number,
  layout: SectionLayout,
  colours: PartColours,
  markTint?: string,
) {
  const { drums, bass, text, strong, line } = colours;
  if (bar.fill) {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = drums;
    ctx.fillRect(left, top + DRUMS_TOP, width, DRUMS_HEIGHT);
    ctx.globalAlpha = 1;
  }
  if (markTint) {
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = markTint;
    ctx.fillRect(left, top + DRUMS_TOP, width, BASS_TOP + BASS_HEIGHT - DRUMS_TOP);
    ctx.globalAlpha = 1;
  }
  // Bar lines: a phrase end is heavier.
  ctx.strokeStyle = line;
  ctx.lineWidth = bar.phraseEnd ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(left + width, top + DRUMS_TOP - 2);
  ctx.lineTo(left + width, top + BASS_TOP + BASS_HEIGHT);
  ctx.stroke();

  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = strong;
  for (const chord of bar.chords) ctx.fillText(chord.name, left + 3 + chord.x * width, top + CHORD_HEIGHT / 2);
  if (bar.crashOnOne) {
    ctx.fillStyle = drums;
    ctx.beginPath();
    ctx.moveTo(left + 3, top + DRUMS_TOP - 1);
    ctx.lineTo(left + 9, top + DRUMS_TOP - 1);
    ctx.lineTo(left + 6, top + DRUMS_TOP - 5);
    ctx.fill();
  }

  for (const dot of bar.drums) {
    const radius = dot.ghost ? 2.2 : 2.5 + (dot.velocity / 127) * 2.2;
    const x = left + 4 + dot.x * (width - 8);
    ctx.globalAlpha = dot.ghost ? 1 : 0.45 + (dot.velocity / 127) * 0.55;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, top + dotY(dot), radius, 0, Math.PI * 2);
    if (dot.hollow) {
      ctx.strokeStyle = drums;
      ctx.stroke();
    } else {
      ctx.fillStyle = drums;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // The bar's number, counted from the section's start, under the bass.
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillStyle = text;
  ctx.fillText(String(bar.number), left + 4, top + BASS_TOP + BASS_HEIGHT + NUMBER_HEIGHT / 2);

  const scale = layout.bassScale;
  if (!scale) return;
  const span = Math.max(1, scale.high - scale.low);
  const y = (pitch: number) => top + BASS_TOP + 8 + (1 - (pitch - scale.low) / span) * (BASS_HEIGHT - 20);
  for (const note of bar.bass) {
    const x = left + 4 + note.x * (width - 8);
    const length = Math.max(3, note.width * (width - 8));
    const noteTop = y(note.pitch) - 3;
    ctx.globalAlpha = 0.5 + (note.velocity / 127) * 0.5;
    ctx.strokeStyle = bass;
    ctx.fillStyle = bass;
    ctx.lineWidth = 1.5;
    if (note.dead) {
      ctx.beginPath();
      ctx.moveTo(x, noteTop);
      ctx.lineTo(x + 6, noteTop + 6);
      ctx.moveTo(x + 6, noteTop);
      ctx.lineTo(x, noteTop + 6);
      ctx.stroke();
      continue;
    }
    ctx.fillRect(x, noteTop, length, 6);
    if (note.slide) {
      ctx.beginPath();
      ctx.moveTo(x - 6, noteTop + 9);
      ctx.lineTo(x, noteTop + 3);
      ctx.stroke();
    }
    // A note the performer set by hand has an outline.
    if (note.byHand) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = text;
      ctx.strokeRect(x - 1.5, noteTop - 1.5, length + 3, 9);
    }
  }
  ctx.globalAlpha = 1;
}

/** Draws every line of a section. `marked` gives a bar a tint, for a bar the performer marked. */
export function drawSection(
  ctx: CanvasRenderingContext2D,
  layout: SectionLayout,
  width: number,
  colours: PartColours,
  marked: (bar: PartBar) => string | undefined = () => undefined,
) {
  ctx.clearRect(0, 0, width, layout.lines.length * LINE_HEIGHT);
  const w = barWidth(width);
  layout.lines.forEach((line, row) => {
    const top = row * LINE_HEIGHT;
    ctx.fillStyle = colours.section;
    ctx.fillRect(GUTTER, top, w * line.length, CHORD_HEIGHT - 2);
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colours.text;
    for (const lane of DRUM_LANES) {
      const box = laneBox(lane);
      ctx.fillText(LANE_NAMES[lane], GUTTER - 5, top + box.top + box.height / 2);
      ctx.globalAlpha = 0.18;
      ctx.fillRect(GUTTER, top + box.top + box.height - 0.5, w * line.length, 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = "right";
    ctx.fillStyle = colours.text;
    const scale = layout.bassScale;
    if (scale) {
      const span = Math.max(1, scale.high - scale.low);
      let lastY = Infinity;
      for (const label of scale.labels) {
        const y = top + BASS_TOP + 8 + (1 - (label.pitch - scale.low) / span) * (BASS_HEIGHT - 20);
        // Labels run from the bottom up, and one too close to the one below it is left out.
        if (lastY - y < LABEL_SPACING) continue;
        ctx.fillText(noteName(label.pitch), GUTTER - 5, y);
        lastY = y;
      }
    } else ctx.fillText("Bass", GUTTER - 5, top + BASS_TOP + BASS_HEIGHT / 2);
    line.forEach((bar, column) => drawBar(ctx, bar, GUTTER + column * w, top, w, layout, colours, marked(bar)));
  });
}
