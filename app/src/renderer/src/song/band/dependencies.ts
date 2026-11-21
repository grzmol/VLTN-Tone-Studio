import { parseChart } from "../performance/chart";
import { chartChordEvents } from "./harmony";
import { parseBandSettings } from "./arrangement";
const audioIds = new WeakMap<object, number>();
let nextAudioId = 1;
/** Audio buffer identity matters; mixer metadata and newly rendered output buffers do not. */
export function bandAudioId(audio: object): number {
  let id = audioIds.get(audio);
  if (id === undefined) {
    id = nextAudioId++;
    audioIds.set(audio, id);
  }
  return id;
}

/** Lyrics and MIDI controls do not change generated notes; timed chord edits do. */
export function bandChartKey(chart: string): string {
  try {
    return JSON.stringify(chartChordEvents(parseChart(chart.replace(/\{midi[^}]*\}/g, ""))));
  } catch {
    return chart;
  }
}
/** Trims, playback speed and mixer changes act on the full-length audio at playback and never need a new band render. */
export function bandOptionsKey(options: Record<string, unknown>): string {
  const { firstNote: _firstNote, rendered: _rendered, ...settings } = parseBandSettings(options.band);
  const analysis = options.analysis as { audioId?: unknown; chords?: unknown; bassLine?: unknown; sections?: unknown } | undefined;
  return JSON.stringify([
    options.firstBeat,
    options.beats,
    options.beatGrid,
    options.sections,
    settings,
    analysis?.audioId,
    analysis?.chords,
    analysis?.bassLine,
    analysis?.sections,
  ]);
}
