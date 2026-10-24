/** Match the save dialog to the exported content instead of labelling charts as WAV. */
export function songSaveFilters(name: string): { name: string; extensions: string[] }[] {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension === 'json') return [{ name: 'MIDI pedal definition', extensions: ['json'] }];
  if (extension === 'lrc') return [{ name: 'Timed lyrics and chords', extensions: ['lrc'] }];
  if (extension === 'txt') return [{ name: 'Text', extensions: ['txt'] }];
  if (extension === 'cho' || extension === 'chordpro') return [{ name: 'ChordPro chart', extensions: [extension] }];
  return [{ name: 'WAV audio', extensions: ['wav'] }];
}
