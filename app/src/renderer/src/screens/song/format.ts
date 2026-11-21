/** How the Song screen shows times and tempos, so the same value reads the same way everywhere. */

/** Seconds as `m:ss`, for display: `5:30`. A negative or missing value shows as `0:00`. */
export function clock(value: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A tempo with one decimal when it is not a whole number and none when it is: `149.9 BPM`, `150 BPM`. */
export function tempo(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} BPM`;
}

/** A number of seconds with at most two decimals and no trailing zeros: `0`, `12.5`, `330`. Anything under 0.005 s shows as `0`, the rounding of the automatic trim. */
export function seconds(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "0";
  return String(Math.round(value * 100) / 100);
}

/**
 * Seconds typed by a person: digits with `.` or `,` as the decimal mark. Empty or anything else gives null, so a half-typed or wrong value
 * is never taken for a number.
 */
export function parseSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(\d+[.,]?\d*|[.,]\d+)$/.test(trimmed)) return null;
  return Number(trimmed.replace(",", "."));
}
