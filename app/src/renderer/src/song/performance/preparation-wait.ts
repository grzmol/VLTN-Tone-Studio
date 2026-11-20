/** Shared trigger grammar for the chart, token editor and syntax colours. Waits are in seconds in chart text. */
export const PREPARATION_HEADER = String.raw`prepare(?:-beginning|-once)?(?:\s+wait=[^\s:}]+)?`;
export const MIDI_TRIGGER_PATTERN = `load|${PREPARATION_HEADER}|play|stop|end`;
export const PREPARATION_TOKEN = new RegExp(String.raw`\{midi@(${PREPARATION_HEADER}):([^}]*)\}`, "g");

export function preparationWaitMs(header: string): number | undefined {
  const value = /\s+wait=(\S+)$/.exec(header)?.[1];
  if (value === undefined) return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) > 10) throw new Error("Wait after must be between 0 and 10 seconds.");
  return Math.round(Number(value) * 1000);
}

/** One wait follows the whole preparation line, including a macro or a bank/preset pair. */
export function withPreparationWait(line: string, milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 10000) throw new Error("Wait after must be between 0 and 10 seconds.");
  const commentAt = line.search(/(^|\s)\/\//),
    code = commentAt < 0 ? line : line.slice(0, commentAt);
  const matches = [...code.matchAll(PREPARATION_TOKEN)];
  const last = matches.at(-1)?.index;
  return (
    code.replace(PREPARATION_TOKEN, (_text, header: string, command: string, index: number) => {
      const clean = header.replace(/\s+wait=\S+$/, "");
      const wait = index === last && milliseconds > 0 ? ` wait=${Math.round(milliseconds) / 1000}` : "";
      return `{midi@${clean}${wait}:${command}}`;
    }) + (commentAt < 0 ? "" : line.slice(commentAt))
  );
}
