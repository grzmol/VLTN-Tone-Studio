import type { SongSource } from '../types';
export const performanceKey = (source: SongSource | null): string => source?.libraryId ? `vltn.song:${source.libraryId}` : source ? `vltn.performance.v1:${source.name}:${source.audio.channels[0].length}:${source.audio.sampleRate}` : 'vltn.performance.v1:practice';
export const settingSuffixes = ['', ':bpm', ':lyrics', ':options'] as const;
export function readSettings(key: string): Record<string, string> {
  return Object.fromEntries(settingSuffixes.map(suffix => [suffix, localStorage.getItem(key + suffix) ?? '']));
}
export function writeSettings(key: string, values: Record<string, string>): void {
  for (const suffix of settingSuffixes) {
    if (values[suffix]) localStorage.setItem(key + suffix, values[suffix]);
    else localStorage.removeItem(key + suffix);
  }
}
export function readOptions<T>(key: string, defaults: T): T {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key + ':options') || '{}') }; } catch { return defaults; }
}
