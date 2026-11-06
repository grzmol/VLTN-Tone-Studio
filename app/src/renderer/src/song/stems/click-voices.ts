import type { ClickSound } from "../performance/click-sound";

// The synthesised click sounds (spec 103), besides the plain blip: a cowbell and a woodblock. They have no samples, so nothing is
// downloaded and nothing needs decoding before Play. Each is a short burst that dies away within SYNTH_SECONDS, so a click never
// leaves a source running.

/** The sounds this module makes. */
export const SYNTH: ReadonlySet<ClickSound> = new Set<ClickSound>(["cowbell", "woodblock"]);

/** How long a voice lives, and so when its sources are stopped. */
export const SYNTH_SECONDS = 0.25;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A short burst of white noise, made once per context. */
function noiseBurst(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    const length = Math.round(ctx.sampleRate * 0.05) || 2205;
    buffer = ctx.createBuffer(1, length, ctx.sampleRate || 44100);
    buffer.copyToChannel(
      Float32Array.from({ length }, () => Math.random() * 2 - 1),
      0,
    );
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/**
 * Starts the wiring for one synthesised click at audio time `at` and returns its sources, not yet started. The cowbell is two square
 * oscillators a fifth-ish apart (800 and 540 Hz) with a quick decay; the woodblock is a burst of noise through a narrow band-pass.
 * The downbeat sounds a little higher so the bar is easy to hear. `peak` is the accented volume.
 */
export function synthClick(ctx: BaseAudioContext, sound: ClickSound, at: number, peak: number, down: boolean, gain: GainNode): AudioScheduledSourceNode[] {
  if (sound === "cowbell") {
    const shift = down ? 1.12 : 1;
    gain.gain.setValueAtTime(peak * 0.5, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    return [800 * shift, 540 * shift].map((hz) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(hz, at);
      osc.connect(gain);
      return osc;
    });
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBurst(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(down ? 2000 : 1500, at);
  filter.Q.setValueAtTime(8, at);
  gain.gain.setValueAtTime(peak * 1.5, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  noise.connect(filter).connect(gain);
  return [noise];
}
