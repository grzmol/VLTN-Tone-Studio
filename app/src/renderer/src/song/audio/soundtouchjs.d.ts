// soundtouchjs (LGPL-2.1) ships no type declarations. This declares only what stretch.ts uses.
declare module "soundtouchjs" {
  export class SoundTouch {
    /** Speed without a pitch change: 1 is the source's own speed, 0.5 plays twice as long */
    tempo: number;
    /** Pitch ratio without a speed change: 2 is an octave up */
    pitch: number;
    /** The engine's window lengths. Its alignment is measured for these, so they are set once for every render. */
    stretch: { setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void };
  }
  export class SimpleFilter {
    constructor(source: { extract(target: Float32Array, numFrames: number, position: number): number }, pipe: SoundTouch);
    /** Writes up to `numFrames` interleaved stereo frames and returns how many were written */
    extract(target: Float32Array, numFrames: number): number;
  }
}
