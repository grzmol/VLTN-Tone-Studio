// Builds the audio one song's analysis runs on, from its mix and stems. The panel and the headless batch (spec 72) both build it here, so a
// song analysed from the Library gets the same sources, key stem and chord stem as one analysed on the Performance screen.

import { beatSources, sumAudio } from "../band/request";
import { parseSections } from "../performance/sections";
import { hasSignal } from "../performance/sources";
import type { PcmAudio, StemName, Stems } from "../types";
import type { AnalysisAudio, NamedAudio } from "./song-analysis";

/** The inputs that come from the song itself: its mix, its stems, its meter, its chart's chord changes, and the chord stems it uses. */
export interface SongAudioInput {
  mix: PcmAudio;
  stems: Stems | null;
  beatsPerBar: number;
  chordChanges: number[];
  /** The stem the performer chose for the chords. Empty when the song's own rules pick the harmony. */
  chordChoice?: StemName | "";
  /** The stem the sections read the harmony from. Empty when none is chosen. */
  chordName: StemName | "";
  /** The song's own sections, as bounds in seconds (the performer's, saved with the song). */
  sections?: { start: number; end: number }[];
}

/** The stems that carry the harmony without the bass or the drums. Their sum is the default harmony when the song is split. */
export const HARMONY_STEMS: readonly StemName[] = ["other", "guitar", "piano"];

/**
 * The audio the chords are read from, and the name they are stored under. The performer's own choice wins when that stem has a signal.
 * Otherwise the harmony stems with a signal are added together, and otherwise the song's mix is used. The name says which were used, so a
 * change of source is analysed again.
 */
export function harmonyOf(stems: Stems | null, mix: PcmAudio, chordChoice: StemName | "" = ""): NamedAudio {
  const parts = harmonyPartsOf(stems, chordChoice);
  if (!parts) return { name: "mix", audio: mix };
  const audio = parts.length === 1 ? stems![parts[0]]! : sumAudio(parts.map((name) => stems![name]!));
  return { name: parts.join("+"), audio };
}

/**
 * The name `harmonyOf` gives, without adding any audio together. The panel shows the name on every render, so it must not pay for the sum.
 */
export function harmonyNameOf(stems: Stems | null, chordChoice: StemName | "" = ""): string {
  return harmonyPartsOf(stems, chordChoice)?.join("+") ?? "mix";
}

/** The stems the harmony is read from, or null when the song's mix is used. */
function harmonyPartsOf(stems: Stems | null, chordChoice: StemName | ""): StemName[] | null {
  if (chordChoice && hasSignal(stems?.[chordChoice])) return [chordChoice];
  const parts = HARMONY_STEMS.filter((name) => hasSignal(stems?.[name]));
  return parts.length ? parts : null;
}

/** The bounds, in seconds, of the sections a saved song holds. Anything that is not a section is left out. */
export function sectionBoundsOf(raw: unknown): { start: number; end: number }[] {
  return parseSections(raw).map(({ start, end }) => ({ start, end }));
}

/** The bass stem when it has a signal, which the chords read for the bass note. Null otherwise. */
export function bassOf(stems: Stems | null): PcmAudio | null {
  return hasSignal(stems?.bass) ? stems!.bass! : null;
}

/** The audio an analysis runs on: the beat sources, the harmony and the bass for the chords and the key, and the section chord stem. */
export function buildAnalysisAudio({ mix, stems, beatsPerBar, chordChanges, chordChoice = "", chordName, sections = [] }: SongAudioInput): AnalysisAudio {
  return {
    mix,
    stems,
    sources: beatSources(stems, mix),
    sampleRate: mix.sampleRate,
    beatsPerBar,
    chordChanges,
    sections,
    harmony: harmonyOf(stems, mix, chordChoice),
    bass: bassOf(stems),
    chordSource: chordName && stems?.[chordName] ? { name: chordName, audio: stems[chordName] } : null,
  };
}
