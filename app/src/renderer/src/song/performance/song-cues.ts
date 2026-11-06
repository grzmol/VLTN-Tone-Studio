import { parseChart, type Cue } from "./chart";
import type { MidiMacro } from "./midi-macros";
import { decodeMidiFile, smfCues, type MidiFileOption } from "./smf";

export interface SongCues {
  /** The chart's cues and the MIDI file's messages, in time order. Empty when the song cannot play. */
  cues: Cue[];
  /** Why the song cannot play: a malformed chart, macro or file. Empty when it can. */
  error: string;
  /** Which part failed, so a check can say “Chart cannot play” or “MIDI file cannot play”. */
  part: "chart" | "midi-file" | "";
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The cues a song plays: its chart, with its macros, and its MIDI file, merged by time. A malformed chart, macro or file gives an error
 * and no cues, so Play is blocked with that message rather than failing during playback.
 */
export function songCues(chart: string, macros: readonly MidiMacro[], midiFile: MidiFileOption | null): SongCues {
  let chartCues: Cue[];
  try {
    chartCues = parseChart(chart, macros);
  } catch (e) {
    return { cues: [], error: message(e), part: "chart" };
  }
  if (!midiFile) return { cues: chartCues, error: "", part: "" };
  try {
    const fileCues = smfCues(decodeMidiFile(midiFile));
    return { cues: [...chartCues, ...fileCues].sort((a, b) => a.time - b.time), error: "", part: "" };
  } catch (e) {
    return { cues: [], error: `${midiFile.name}: ${message(e)}`, part: "midi-file" };
  }
}
