import { lrcTime } from "./chart";
import type { TimedWord } from "./lyrics-align";
import { WINDOW_PAD_SECONDS, type Region } from "./vocal-activity";
export interface LyricSegment {
  time: number;
  text: string;
}
type Chunk = { text: string; timestamp: [number | null, number | null] };

/** A gap this long between words always starts a new line. */
export const LINE_GAP_SECONDS = 0.6;
/** Once a line has SOFT_LINE_WORDS words, a gap of this length also starts a new line: sung phrases run on with short gaps. */
export const SOFT_LINE_GAP_SECONDS = 0.25;
export const SOFT_LINE_WORDS = 6;
/** Lines are cut at this many words, even with no gap. */
export const MAX_LINE_WORDS = 10;
/** Words are never started closer together than this, so no two lines can share a time. */
export const MIN_WORD_STEP_SECONDS = 0.01;
/** A word's missing start or end is taken from its neighbours, or assumed to last this long. */
export const REPAIRED_WORD_SECONDS = 0.4;
/** A line that repeats more than this many times within REPEAT_WINDOW_SECONDS is a loop, not the song. */
export const MAX_REPEATS = 3;
export const REPEAT_WINDOW_SECONDS = 10;
/** Phrases Whisper writes over silence. Compared on normalised text (lower case, letters and digits only). */
export const HALLUCINATIONS: readonly string[] = [
  "thank you for watching",
  "thanks for watching",
  "subtitles by the amara org community",
  "subscribe to my channel",
  "like and subscribe",
  "music",
];

/** Keep generated text inert when copied into the chart's MIDI-aware syntax. */
export function cleanText(text: string): string {
  return text
    .replace(/[\r\n]+/g, " ")
    .replace(/\{midi:/gi, "{midi :")
    .trim();
}

function knownTime(time: number | null): number | undefined {
  return typeof time === "number" && Number.isFinite(time) ? time : undefined;
}

/** A transcribed word, and whether its start was missing and so repaired. */
type RepairedWord = TimedWord & { startRepaired: boolean };

/**
 * Word chunks from a word-timestamp run, in song time (relative to the window). A word with a missing start takes the end of
 * the word before it, or runs back from its own end. A word with a missing end takes the next word's start, or lasts
 * REPAIRED_WORD_SECONDS. Words that start outside the window are dropped.
 */
function repairedWords(chunks: Chunk[], duration: number): RepairedWord[] {
  const heard = chunks
    .map((chunk) => ({ text: cleanText(chunk.text), start: knownTime(chunk.timestamp[0]), end: knownTime(chunk.timestamp[1]) }))
    .filter((word) => word.text);
  const nextStart: (number | undefined)[] = new Array(heard.length);
  let later: number | undefined;
  for (let i = heard.length - 1; i >= 0; i--) {
    nextStart[i] = later;
    if (heard[i].start !== undefined) later = heard[i].start;
  }
  const words: RepairedWord[] = [];
  let previousEnd: number | undefined;
  heard.forEach((word, i) => {
    const following = nextStart[i];
    const start = word.start ?? previousEnd ?? (word.end !== undefined ? Math.max(0, word.end - REPAIRED_WORD_SECONDS) : following);
    if (start === undefined || !(start >= 0 && start < duration)) return;
    const end = word.end ?? Math.max(start, Math.min(following ?? Infinity, start + REPAIRED_WORD_SECONDS));
    const clamped = Math.max(start, Math.min(end, duration));
    words.push({ text: word.text, start, end: clamped, startRepaired: word.start === undefined });
    previousEnd = clamped;
  });
  return words;
}

export function transcriptWords(chunks: Chunk[], duration: number): TimedWord[] {
  return repairedWords(chunks, duration).map(({ text, start, end }) => ({ text, start, end }));
}

/**
 * The words one transcription window heard, in song time. `offset` is the window's song start, and only the words that start
 * inside `span` are kept, so a word in the overlap with a neighbour is kept once. A word whose start was repaired is placed by
 * its end instead: the repaired start can sit before the overlap midpoint the word really lies after.
 */
export function windowWords(chunks: Chunk[], duration: number, offset: number, span: Region): TimedWord[] {
  return repairedWords(chunks, duration)
    .filter((word) => {
      const at = (word.startRepaired ? word.end : word.start) + offset;
      return at >= span.start && at < span.end;
    })
    .map(({ text, start, end }) => ({ text, start: start + offset, end: end + offset }));
}

/** Words that start inside a singing region (padded, since the transcriber's word starts can land just before one). */
export function keepWordsWithin(words: readonly TimedWord[], regions: readonly Region[], pad = WINDOW_PAD_SECONDS): TimedWord[] {
  return words.filter((word) => regions.some((region) => word.start >= region.start - pad && word.start <= region.end + pad));
}

/** A word that ends a sentence. Its line ends with it. */
function endsSentence(text: string): boolean {
  return /[.!?]["'”’)\]]*$/.test(text);
}

/** A word that ends with punctuation of any kind (a comma counts). */
function endsPunctuated(text: string): boolean {
  return /[.!?,;:…]["'”’)\]]*$/.test(text);
}

/** Lower case, letters and apostrophes only, so "I'll," compares as "i'll". */
function bareWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}'’]/gu, "")
    .replace(/’/g, "'");
}

/**
 * Words that carry on into the next word (articles, possessives, prepositions, conjunctions, auxiliaries). A line does not end
 * on one of them, unless the line cannot end anywhere else.
 */
export const DANGLING_WORDS: readonly string[] = [
  "a",
  "an",
  "the",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "by",
  "with",
  "into",
  "onto",
  "over",
  "under",
  "about",
  "as",
  "like",
  "than",
  "and",
  "but",
  "or",
  "so",
  "if",
  "because",
  "while",
  "when",
  "nor",
  "i'm",
  "i'll",
  "i've",
  "i'd",
  "you'll",
  "you're",
  "you've",
  "we're",
  "they're",
  "it's",
  "that's",
  "can't",
  "don't",
  "won't",
  "be",
  "is",
  "are",
  "was",
  "were",
  "am",
  "been",
  "being",
  "will",
  "would",
  "can",
  "cannot",
  "could",
  "should",
  "shall",
  "may",
  "might",
  "must",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
  "not",
  "no",
  "let",
  "it",
  "me",
  "him",
  "them",
  "us",
];
const DANGLING = new Set(DANGLING_WORDS);

/** Whether a word carries on into the next one, so a line should not end on it. */
export function isDangling(text: string): boolean {
  return DANGLING.has(bareWord(text));
}

/** Square brackets and *actions* are always annotations. Matched by shape, not by a word list. */
const ALWAYS_ANNOTATION = /\[[^[\]]*\]|\*[^*]+\*/g;
/** Parentheses hold sung backing vocals too, so they are annotations only when their contents look like one. */
const PAREN = /\(([^()]*)\)/g;
/** Words that open a parenthesised annotation, such as "(singing in French)" or "(instrumental)". */
const ANNOTATION_WORDS = /^(?:music|instrumental|inaudible|applause|silence|laughs?|laughing|singing|speaking|humming|whistling|foreign language|chorus|verse|intro|outro|solo|bridge)\b/i;
/** Note symbols Whisper writes for instruments. */
const NOTE_SYMBOLS = /[♪♫♬♩]/gu;
/** A bracket or parenthesis opened in one word and closed in a later one: the words between are an annotation. */
const OPENS = /[[(]/;
const CLOSES = /[\])]/;
/** How far an annotation may run before it is treated as ordinary text. */
const MAX_ANNOTATION_WORDS = 12;

/** Whether the contents of a parenthesis are an annotation: no letters at all, or they open with an annotation word. */
export function isParenAnnotation(contents: string): boolean {
  const trimmed = contents.trim();
  return !/\p{L}/u.test(trimmed) || ANNOTATION_WORDS.test(trimmed);
}

/** The sung text of a word, with annotations and note symbols removed. Empty for a word that was only an annotation. */
export function stripMarkers(text: string): string {
  return text
    .replace(ALWAYS_ANNOTATION, " ")
    .replace(PAREN, (_match, contents: string) => (isParenAnnotation(contents) ? " " : ` ${contents} `))
    .replace(NOTE_SYMBOLS, " ")
    .replace(/[[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drops words from an opening bracket or parenthesis to the word that closes it, when that span is an annotation. A "[" span is
 * always one. A "(" span is one only when its words look like an annotation (see isParenAnnotation).
 */
function dropAnnotationSpans(words: readonly TimedWord[]): TimedWord[] {
  const kept: TimedWord[] = [];
  for (let i = 0; i < words.length; i++) {
    const text = words[i].text;
    const open = text.search(OPENS);
    if (open >= 0 && !CLOSES.test(text.slice(open))) {
      let close = -1;
      for (let j = i + 1; j < words.length && j <= i + MAX_ANNOTATION_WORDS; j++) {
        if (CLOSES.test(words[j].text)) {
          close = j;
          break;
        }
      }
      if (close >= 0) {
        const inner = words
          .slice(i, close + 1)
          .map((word) => word.text)
          .join(" ")
          .replace(/^[[(]/, "")
          .replace(/[\])]$/, "");
        if (text[open] === "[" || isParenAnnotation(inner)) {
          i = close;
          continue;
        }
      }
    }
    kept.push(words[i]);
  }
  return kept;
}

/** A line may run longer than MAX_LINE_WORDS only to move its break past a dangling word. */
export const LINE_WORD_ALLOWANCE = 2;
export const LONGEST_LINE_WORDS = MAX_LINE_WORDS + LINE_WORD_ALLOWANCE;
/** A line of one or two words joins the line before it when the gap before it is shorter than this. */
export const SHORT_LINE_JOIN_SECONDS = 1.5;
/** A break before a capitalised word, after a word with no punctuation, counts this many seconds of gap in its favour. */
const CAPITAL_HINT_SECONDS = 0.2;

/**
 * How good a line break after `words[k]` is, for a line that starts at `words[start]`: the gap to the next word, plus a hint
 * for a capital. Undefined where no break is allowed. A sentence end is always the best break.
 */
function breakScore(words: readonly TimedWord[], start: number, k: number): number | undefined {
  const last = words[k];
  const next = words[k + 1];
  // Rounded to the centisecond, so gaps that differ only by float noise tie, and the earlier break wins.
  const gap = Math.round((next.start - last.end) * 100) / 100;
  const length = k - start + 1;
  if (endsSentence(last.text)) return 100 + gap;
  // A one-word line is allowed only where the singer pauses after it.
  if (length < 2 && gap <= LINE_GAP_SECONDS) return undefined;
  // A word that carries on is never a break, however long the gap after it.
  if (isDangling(last.text)) return undefined;
  if (gap <= SOFT_LINE_GAP_SECONDS) return undefined;
  if (length < SOFT_LINE_WORDS && gap <= LINE_GAP_SECONDS) return undefined;
  const capital = /^\p{Lu}/u.test(next.text) && !endsPunctuated(last.text);
  return gap + (capital ? CAPITAL_HINT_SECONDS : 0);
}

/** The index of the last word of the line that starts at `start`. */
function lineEnd(words: readonly TimedWord[], start: number): number {
  const last = words.length - 1;
  const reach = Math.min(last, start + MAX_LINE_WORDS - 1);
  let best = -1;
  let bestScore = -Infinity;
  for (let k = start; k <= Math.min(reach, last - 1); k++) {
    const score = breakScore(words, start, k);
    if (score !== undefined && score > bestScore) {
      best = k;
      bestScore = score;
    }
  }
  if (best >= 0) return best;
  if (reach === last) return last;
  // No eligible break within the cap, so cut at the cap. If the cut word would dangle, move it to the next word that doesn't.
  if (!isDangling(words[reach].text)) return reach;
  for (let k = reach + 1; k <= Math.min(last, start + LONGEST_LINE_WORDS - 1); k++) {
    if (!isDangling(words[k].text)) return k;
  }
  return reach;
}

/** Words grouped into lines: each line ends where lineEnd says. */
function groupLines(words: readonly TimedWord[]): TimedWord[][] {
  const groups: TimedWord[][] = [];
  for (let start = 0; start < words.length;) {
    const end = lineEnd(words, start);
    groups.push(words.slice(start, end + 1));
    start = end + 1;
  }
  return groups;
}

/** A line of one or two words joins the line before it when the gap before it is short and the joined line stays within MAX_LINE_WORDS. */
function joinShortLines(groups: TimedWord[][]): TimedWord[][] {
  const out: TimedWord[][] = [];
  for (const group of groups) {
    const previous = out[out.length - 1];
    const gap = previous ? group[0].start - previous[previous.length - 1].end : Infinity;
    if (previous && group.length <= 2 && gap < SHORT_LINE_JOIN_SECONDS && previous.length + group.length <= MAX_LINE_WORDS) {
      out[out.length - 1] = [...previous, ...group];
    } else out.push(group);
  }
  return out;
}

/**
 * Words grouped into lines, then cleaned. A line ends at a sentence end, or at the largest pause that is allowed within
 * MAX_LINE_WORDS (a long gap, or a short gap after several words). It never ends on a dangling word unless it has to, and
 * a line of one or two words joins the one before it at a short gap. Music markers are removed. Word starts are pushed on by
 * MIN_WORD_STEP_SECONDS where they would not increase, so each line's time is its own first word's start and no two lines
 * share a time.
 */
export function songLines(words: readonly TimedWord[]): LyricSegment[] {
  let previousStart = -Infinity;
  const timed = dropAnnotationSpans([...words].sort((a, b) => a.start - b.start))
    .map((word) => ({ text: stripMarkers(word.text), start: word.start, end: word.end }))
    .filter((word) => word.text)
    .map((word) => {
      const start = Math.max(word.start, previousStart + MIN_WORD_STEP_SECONDS);
      previousStart = start;
      return { text: word.text, start, end: Math.max(word.end, start) };
    });
  return cleanLines(
    joinShortLines(groupLines(timed)).map((group) => ({
      time: group[0].start,
      text: group
        .map((word) => cleanText(word.text))
        .filter(Boolean)
        .join(" "),
    })),
  );
}

/** Drops lines with no letters or digits, known hallucinations, and loops of a line repeated too often. */
export function cleanLines(segments: readonly LyricSegment[]): LyricSegment[] {
  const kept: LyricSegment[] = [];
  const recent: { key: string; time: number }[] = [];
  for (const segment of segments) {
    const key = segment.text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!key || HALLUCINATIONS.includes(key)) continue;
    const repeats = recent.filter((r) => r.key === key && segment.time - r.time < REPEAT_WINDOW_SECONDS).length;
    if (repeats >= MAX_REPEATS) continue;
    recent.push({ key, time: segment.time });
    kept.push(segment);
  }
  return kept;
}

export function lyricsLrc(segments: readonly LyricSegment[]): string {
  return segments.map((s) => `${lrcTime(s.time)} ${s.text}`).join("\n");
}
