// What the Band panel's steps say and the small pure helpers around them, kept out of the panel so it holds state and handlers only.

import type { RenderedKind } from "@/song/band/arrangement";
import type { BandStage } from "@/song/band/band-job";
import type { PcmAudio } from "@/song/types";
import { fitToLength, shiftAudio, type LineUp } from "@/song/band/rendered";
import type { MissingParts } from "@/song/band/detect";
import type { BandNotice } from "./band-status";
import type { PendingLineUp } from "./RenderedPartRow";

/** The preview target that is not a section: the song position now. */
export const PLAYHEAD = "playhead";
/** The bars a preview from the playhead plays when the length is "Whole section", since the playhead is not in a section. */
export const PLAYHEAD_BARS = 4;
/** A rendered file that is waiting for the performer's line-up choice (spec 84). */
export interface PendingRendered {
  kind: RenderedKind;
  name: string;
  /** The decoded file, before it is fitted to the song, so a shift does not lose its end twice. */
  decoded: PcmAudio;
  line: LineUp;
  notices: BandNotice[];
}
/** The title of the prompt before Generate replaces rendered audio. */
export function replaceTitle(kinds: readonly RenderedKind[]): string {
  if (kinds.length === 1) return `Replace your rendered ${kinds[0]} with new generated ${kinds[0]}?`;
  return "Replace your rendered drums and bass with new generated parts?";
}
/** The step the bass tone takes after the render, while it is read and rendered through the capture. */
export const BASS_TONE_TEXT = "Bass tone…";
/** The step the drum tone takes after the render (spec 104), before the bass tone. */
export const DRUM_TONE_TEXT = "Applying the drum tone…";
/** How long Play from the start stays in Preview's place after a Generate. */
export const PLAY_OFFER_MS = 5000;
export const PLAYING_TEXT = "Stop playback to generate parts.";
export const NO_SONG_TEXT = "Open a song to generate parts.";

/** Plays a mixed buffer once through a short-lived AudioContext. Returns a function that stops it early. */
export function playOnce(audio: PcmAudio, onDone: () => void): () => void {
  const context = new AudioContext();
  const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
  audio.channels.forEach((channel, i) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i));
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    void context.close();
    onDone();
  };
  node.onended = finish;
  node.start();
  return () => {
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    finish();
  };
}
/** The line-up offer of a rendered file for one part, or null when the pending file is for the other part. */
export function pendingLineUp(
  pending: PendingRendered | null,
  kind: RenderedKind,
  dismiss: () => void,
  apply: (kind: RenderedKind, name: string, audio: PcmAudio, notices: BandNotice[]) => void,
  frames: number,
): PendingLineUp | null {
  if (!pending || pending.kind !== kind) return null;
  return {
    text: pending.line.text,
    shiftSeconds: pending.line.shiftSeconds,
    onLineUp: () => apply(kind, pending.name, shiftAudio(pending.decoded, pending.line.shiftSeconds, frames), pending.notices),
    onUseAsIs: () => {
      apply(kind, pending.name, fitToLength(pending.decoded, frames), pending.notices);
      dismiss();
    },
  };
}

export function stageText(stage: BandStage): string {
  if (stage === "loading") return "Loading the drum and bass samples…";
  if (stage === "generating") return "Writing the notes…";
  return "Rendering the parts…";
}

/** The id of the Band entry button, which gets the focus back when the panel closes. */
/** A new seed for the song or for one section: any whole number from 1 up to 2^32 - 2. */
export const newSeed = (): number => 1 + Math.floor(Math.random() * 0xfffffffe);

export const BAND_ENTRY_ID = "band-entry-button";

/** The one line that says the song has its own drums or bass and where to choose between them, or null when the split found neither. */
export function ownParts(missing: MissingParts | null | undefined): string | null {
  const found = (["drums", "bass"] as const).filter((kind) => missing?.[kind] === "present");
  if (!found.length) return null;
  return `This song has its own ${found.join(" and ")}. Generated parts can replace them or play with them (Sound).`;
}
