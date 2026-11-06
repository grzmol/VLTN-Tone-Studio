// Times the user's own lyrics: each pasted word is matched to the word the transcriber heard, so the chart keeps the
// user's spelling and only the timing comes from the audio. Pure, so it runs and is tested without the model.

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

export interface AlignedLine {
  time: number;
  text: string;
  /** No word of the line was heard, so its time is placed between the neighbouring lines. */
  estimated: boolean;
}

/** Cost of skipping a word on either side. Two skips are cheaper than a poor substitution. */
const GAP = 0.6;
/** Cost of pairing two words that don't look alike. Above two skips, so they are never paired. */
const NO_MATCH = 1.2;

/** Lower case, no accents, no punctuation, so "Don't," and "dont" compare equal. */
export function normaliseWord(word: string): string {
  return word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Lines of pasted lyrics. A blank line becomes "" (a section break); surrounding blank lines are dropped. */
export function pastedLines(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line) lines.push(line);
    else if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** 0 for the same word, small for a near miss ("gonna" / "going to" style spelling drift), NO_MATCH otherwise. */
export function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;
  const similarity = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return similarity >= 0.6 ? 0.2 + 0.5 * (1 - similarity) : NO_MATCH;
}

/**
 * Monotonic alignment of `sung` (the user's normalised words) to `heard` (the transcript's). Returns, for each sung
 * word, the index of its heard word, or null when it has no match. Global alignment, so a repeated chorus lands on
 * the occurrence that fits its neighbours.
 */
export function alignWords(sung: readonly string[], heard: readonly string[]): (number | null)[] {
  const n = sung.length;
  const m = heard.length;
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width);
  for (let j = 1; j <= m; j++) cost[j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    cost[i * width] = i * GAP;
    for (let j = 1; j <= m; j++) {
      const pair = cost[(i - 1) * width + j - 1] + substitutionCost(sung[i - 1], heard[j - 1]);
      cost[i * width + j] = Math.min(pair, cost[(i - 1) * width + j] + GAP, cost[i * width + j - 1] + GAP);
    }
  }
  const matches: (number | null)[] = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const here = cost[i * width + j];
    const pair = substitutionCost(sung[i - 1], heard[j - 1]);
    if (here === cost[(i - 1) * width + j - 1] + pair) {
      if (pair < NO_MATCH) matches[i - 1] = j - 1;
      i--;
      j--;
    } else if (here === cost[(i - 1) * width + j] + GAP) i--;
    else j--;
  }
  return matches;
}

/** A line's matched start may be at most this far after the next matched line's start. Later than that, the match is not trusted. */
export const NEXT_LINE_SLACK_SECONDS = 8;

/**
 * Times `lines` (from pastedLines) against the transcript's words. A line's start comes from its matched words, earliest first:
 * the first matched word's start, stepped back over the words before it in the line by the average length of the matched heard
 * words. That candidate is trusted only when it is not before the previous line's time and not more than NEXT_LINE_SLACK_SECONDS
 * after the next matched line's start. Otherwise the next matched word of the line is tried.
 * A line with no trusted start is placed between its timed neighbours, in proportion to its word count, and flagged
 * `estimated`. Blank lines become section breaks: "" lines, timed at the next line, and dropped at the end.
 */
export function alignLyrics(lines: readonly string[], heard: readonly TimedWord[], duration: number): AlignedLine[] {
  const sung: { line: number; norm: string; position: number }[] = [];
  lines.forEach((line, index) => {
    let position = 0;
    for (const word of line.split(/\s+/)) {
      const norm = normaliseWord(word);
      if (norm) sung.push({ line: index, norm, position: position++ });
    }
  });
  const hearing = heard.map((word) => ({ start: word.start, end: word.end, norm: normaliseWord(word.text) })).filter((word) => word.norm);
  const matches = alignWords(
    sung.map((word) => word.norm),
    hearing.map((word) => word.norm),
  );
  const matched = matches.filter((h): h is number => h !== null).map((h) => hearing[h]);
  const wordSeconds = matched.length ? matched.reduce((sum, word) => sum + (word.end - word.start), 0) / matched.length : 0;
  const candidates: number[][] = lines.map(() => []);
  const wordCounts = lines.map(() => 0);
  sung.forEach((word, k) => {
    wordCounts[word.line]++;
    const h = matches[k];
    if (h !== null) candidates[word.line].push(Math.max(0, hearing[h].start - word.position * wordSeconds));
  });
  // The first candidate of the nearest later line that has one: the start a line must not run far past.
  const nextFirst: (number | undefined)[] = new Array(lines.length);
  let later: number | undefined;
  for (let index = lines.length - 1; index >= 0; index--) {
    nextFirst[index] = later;
    if (candidates[index].length) later = candidates[index][0];
  }
  const timed: (number | undefined)[] = lines.map(() => undefined);
  let previous = -Infinity;
  lines.forEach((_, index) => {
    const latest = (nextFirst[index] ?? Infinity) + NEXT_LINE_SLACK_SECONDS;
    const trusted = candidates[index].find((start) => start >= previous && start <= latest);
    if (trusted !== undefined) {
      timed[index] = trusted;
      previous = trusted;
    }
  });
  const sungLines = lines.flatMap((line, index) => (line ? [index] : []));
  const times = new Map<number, { time: number; estimated: boolean }>();
  let anchor = 0;
  let run: number[] = [];
  const place = (next: number) => {
    const total = run.reduce((sum, index) => sum + Math.max(1, wordCounts[index]), 0);
    let before = 0;
    for (const index of run) {
      const weight = Math.max(1, wordCounts[index]);
      // Each line starts at the middle of its own share of the gap, so a lone line lands halfway between its neighbours.
      times.set(index, { time: anchor + (next - anchor) * ((before + weight / 2) / total), estimated: true });
      before += weight;
    }
    run = [];
  };
  for (const index of sungLines) {
    const t = timed[index];
    if (t === undefined) {
      run.push(index);
      continue;
    }
    place(Math.max(anchor, t));
    times.set(index, { time: t, estimated: false });
    anchor = t;
  }
  place(Math.max(anchor, duration));
  const out: AlignedLine[] = [];
  let breakPending = false;
  lines.forEach((line, index) => {
    if (!line) {
      breakPending = out.length > 0;
      return;
    }
    const placed = times.get(index)!;
    if (breakPending) out.push({ time: placed.time, text: "", estimated: false });
    breakPending = false;
    out.push({ time: placed.time, text: line, estimated: placed.estimated });
  });
  return out;
}
