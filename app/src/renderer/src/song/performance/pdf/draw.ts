import type { Mark } from "@shared/chart-annotations";

/** Pen and highlighter strokes are drawn at this opacity, so the text under a highlight still reads. */
const HIGHLIGHTER_ALPHA = 0.35;

/**
 * Draws one mark on a canvas whose CSS size is `width` by `height`. The marks are stored in page coordinates from 0 to 1, so they are
 * scaled here. A stroke is at least one pixel wide, so a thin pen never disappears at a small zoom.
 */
export function drawMark(ctx: CanvasRenderingContext2D, mark: Mark, width: number, height: number): void {
  if (mark.kind === "text") {
    ctx.font = `${Math.max(12, height * 0.022)}px system-ui, sans-serif`;
    ctx.fillStyle = mark.colour;
    ctx.fillText(mark.text, mark.x * width, mark.y * height);
    return;
  }
  if (!mark.points.length) return;
  ctx.save();
  ctx.globalAlpha = mark.kind === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
  ctx.strokeStyle = mark.colour;
  ctx.lineWidth = Math.max(1, mark.width * height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  mark.points.forEach((point, i) => (i ? ctx.lineTo(point.x * width, point.y * height) : ctx.moveTo(point.x * width, point.y * height)));
  ctx.stroke();
  ctx.restore();
}
