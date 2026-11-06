import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeLyrics } from "./lyrics-run";
import { windowWords } from "./lyrics";
import type { TimedWord } from "./lyrics-align";
import { transcriptionWindows } from "./vocal-activity";

// A 5:29 song through transcribeLyrics: window planning, the pieces and starts sent to the worker, the worker's stitching
// (windowWords) and the lines. Only the transcriber is stood in for, and it returns what transformers.js returns: chunks in
// window-relative seconds, with a null start on each window's first word and a null end on its last.

const RATE = 16000;
const SONG_SECONDS = 329;

/** Phrases of 3 to 8 words, a word every 0.5 s (0.3 s long), with random gaps of 0.4 to 3 s between phrases. */
function songWords(seed: number): { phrases: TimedWord[][]; words: TimedWord[] } {
  let state = seed;
  const next = (a: number, b: number) => {
    state = (state * 16807) % 2147483647;
    return a + ((state % 1000) / 1000) * (b - a);
  };
  const phrases: TimedWord[][] = [];
  let t = 0.8;
  while (t < SONG_SECONDS - 6) {
    const count = Math.round(next(3, 8));
    phrases.push(Array.from({ length: count }, (_, k) => ({ text: "", start: t + k * 0.5, end: t + k * 0.5 + 0.3 })));
    t += count * 0.5 + next(0.4, 3);
  }
  const words = phrases.flat().map((word, i) => ({ ...word, text: `w${i}` }));
  return { phrases, words };
}

/** The vocals: a tone under each phrase, so the singing detector finds the phrases. */
function songAudio(phrases: TimedWord[][]): Float32Array {
  const samples = new Float32Array(RATE * SONG_SECONDS);
  let state = 5;
  for (const phrase of phrases) {
    state = (state * 16807) % 2147483647;
    const amplitude = 0.2 + ((state % 1000) / 1000) * 0.2;
    const from = Math.round((phrase[0].start - 0.2) * RATE);
    const to = Math.round((phrase[phrase.length - 1].end + 0.2) * RATE);
    for (let s = from; s < to; s++) samples[s] = amplitude * Math.sin(s / 3);
  }
  return samples;
}

/** Stands in for the worker's transcriber. The words it returns are stitched by the worker's own windowWords. */
class TranscriberWorker {
  static words: TimedWord[] = [];
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage(message: { pieces: Float32Array[]; starts: number[]; spans: { start: number; end: number }[] }) {
    const words = message.pieces.flatMap((piece, i) => {
      const duration = piece.length / RATE;
      const offset = message.starts[i];
      const inside = TranscriberWorker.words.filter((w) => w.start >= offset && w.start < offset + duration);
      const chunks = inside.map((w, k) => ({
        text: ` ${w.text}`,
        timestamp: [k === 0 ? null : w.start - offset, k === inside.length - 1 ? null : Math.min(w.end, offset + duration) - offset] as [
          number | null,
          number | null,
        ],
      }));
      return windowWords(chunks, duration, offset, message.spans[i]);
    });
    queueMicrotask(() => this.onmessage?.({ data: { words } }));
  }
}

const options = { model: "small" as const, quality: "fast" as const, language: "auto" as const };

function stubAudio(samples: Float32Array) {
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      destination = {};
      createBuffer() {
        return { copyToChannel: () => {} };
      }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {} };
      }
      async startRendering() {
        return { getChannelData: () => samples };
      }
    },
  );
}

beforeEach(() => vi.stubGlobal("Worker", TranscriberWorker));
afterEach(() => vi.unstubAllGlobals());

describe("transcribeLyrics over a 5:29 song", () => {
  for (const seed of Array.from({ length: 12 }, (_, i) => i + 1)) {
    it(`returns every sung word once, at its song time (layout ${seed})`, async () => {
      const { phrases, words } = songWords(seed);
      TranscriberWorker.words = words;
      stubAudio(songAudio(phrases));
      const result = await transcribeLyrics({ audio: { sampleRate: RATE, channels: [songAudio(phrases)] }, options });
      const lines = result.text.split("\n");
      expect(lines.flatMap((line) => line.replace(/^\[[^\]]*\] /, "").split(" "))).toEqual(words.map((w) => w.text));
      // Each line's time is its first word's time, to the centisecond.
      const byText = new Map(words.map((w) => [w.text, w.start]));
      for (const line of lines) {
        const [, minutes, seconds, first] = line.match(/^\[(\d+):(\d+\.\d+)\] (\S+)/)!;
        expect(Math.abs(Number(minutes) * 60 + Number(seconds) - byText.get(first)!)).toBeLessThan(0.3);
      }
    });
  }

  it("plans windows of at most 30 s that move forward and cover the singing", () => {
    const { phrases } = songWords(11);
    const regions = phrases.map((p) => ({ start: p[0].start - 0.2, end: p[p.length - 1].end + 0.2 }));
    const windows = transcriptionWindows(regions, SONG_SECONDS);
    expect(windows.every((w) => w.end - w.start <= 30)).toBe(true);
    for (let i = 1; i < windows.length; i++) expect(windows[i].start).toBeGreaterThan(windows[i - 1].start);
    expect(windows[windows.length - 1].end).toBeGreaterThanOrEqual(regions[regions.length - 1].end);
  });
});
