import type { PcmAudio, StemName, Stems } from '../types';

/** Reject empty/silent model outputs; this is not an instrument-presence classifier. */
export function hasSignal(audio?: PcmAudio): boolean {
  if (!audio?.channels[0]?.length) return false;
  let energy = 0, count = 0;
  for (const channel of audio.channels) for (let i = 0; i < channel.length; i += 64) {
    energy += channel[i] ** 2; count++;
  }
  return count > 0 && energy / count > 1e-7;
}
export function defaultChordSource(stems: Stems | null): StemName | '' {
  return (['guitar', 'piano', 'other', 'bass', 'vocals', 'drums'] as const).find(name => hasSignal(stems?.[name])) ?? '';
}
