/** Standard tuning, low E to high e. Templates are movable, verified chord tones. */
export interface Voicing { frets: (number | null)[]; position: number; barre: boolean; barreFret?: number; label: string }
function barreFret(frets: (number | null)[]): number | undefined {
  for (const fret of [...new Set(frets.filter((n): n is number => n !== null && n > 0))].sort((a,b) => a-b)) {
    const indices = frets.flatMap((n,i) => n === fret ? [i] : []);
    if (indices.length >= 2 && frets.slice(indices[0], indices.at(-1)! + 1).every(n => n === null || n >= fret)) return fret;
  }
}
const tuning = [40, 45, 50, 55, 59, 64];
const pitch = (name: string) => (({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[name[0]] ?? 0) + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12) % 12;
const shapes: Record<string, [(number | null)[], (number | null)[]]> = {
  '': [[0,2,2,1,0,0], [null,0,2,2,2,0]],
  m: [[0,2,2,0,0,0], [null,0,2,2,1,0]],
  '7': [[0,2,0,1,0,0], [null,0,2,0,2,0]],
  maj7: [[0,null,1,1,0,null], [null,0,2,1,2,0]],
  m7: [[0,2,0,0,0,0], [null,0,2,0,1,0]],
  sus2: [[0,2,4,4,0,0], [null,0,2,2,0,0]],
  sus4: [[0,2,2,2,0,0], [null,0,2,2,3,0]],
  '5': [[0,2,2,null,null,null], [null,0,2,2,null,null]],
  dim: [[null,null,2,3,2,3], [null,0,1,2,1,null]],
  dim7: [[null,null,2,3,2,3], [null,0,1,2,1,2]],
  aug: [[0,null,2,1,1,0], [null,0,3,2,2,1]],
};
const intervals: Record<string, number[]> = { '': [0,4,7], m: [0,3,7], '7': [0,4,7,10], maj7: [0,4,7,11], m7: [0,3,7,10], sus2: [0,2,7], sus4: [0,5,7], '5': [0,7], dim: [0,3,6], dim7: [0,3,6,9], aug: [0,4,8] };
export function chordVoicings(name: string): Voicing[] {
  const match = /^([A-G][#b]?)(maj7|M7|min7|m7|min|m|maj|7|sus2|sus4|5|dim7|dim|aug|\+)?(?:\/([A-G][#b]?))?$/.exec(name);
  if (!match) return [];
  const root = pitch(match[1]);
  const quality = ({ M7: 'maj7', min7: 'm7', min: 'm', maj: '', '+': 'aug' } as Record<string,string>)[match[2]] ?? match[2] ?? '';
  const bass = match[3] ? pitch(match[3]) : root;
  const tones = intervals[quality].map(n => (root + n) % 12);
  const result: Voicing[] = [];
  shapes[quality].forEach((shape, family) => {
    const offset = (root - (family === 0 ? 4 : 9) + 12) % 12;
    for (const base of [offset, offset + 12]) {
      const frets = shape.map(n => n === null ? null : n + base);
      if (Math.max(...frets.filter((n): n is number => n !== null)) > 17) continue;
      // A template is accepted only if it contains exactly this chord's tones and bass.
      const sounding = frets.flatMap((f, s) => f === null ? [] : [(tuning[s] + f) % 12]);
      if (sounding[0] !== bass || sounding.some(n => !tones.includes(n)) || tones.some(n => !sounding.includes(n))) continue;
      const fingered = frets.filter((n): n is number => n !== null && n > 0);
      const low = Math.min(...fingered);
      const barreAt = barreFret(frets);
      result.push({ frets, position: low, barre: barreAt !== undefined, barreFret: barreAt, label: `${family === 0 ? 'E' : 'A'} shape · ${base === 0 ? 'open position' : `fret ${base}`}` });
    }
  });
  // Slash chords: enumerate compact inversions, including a specified non-chord bass.
  if (match[3]) for (let start = 0; start <= 12; start++) {
    const options = tuning.map((note, string) => [null, ...Array.from({length: 5}, (_, i) => start + i).filter(f => tones.includes((note + f) % 12) || (string < 3 && (note + f) % 12 === bass))] as (number|null)[]);
    const visit = (frets: (number|null)[]) => {
      if (frets.length < 6) { for (const f of options[frets.length]) visit([...frets, f]); return; }
      const sounds = frets.flatMap((f, s) => f === null ? [] : [{ pitch: (tuning[s] + f) % 12, midi: tuning[s] + f }]);
      if (sounds.length < 4 || sounds.reduce((a,b) => a.midi < b.midi ? a : b).pitch !== bass || tones.some(n => !sounds.some(s => s.pitch === n)) || sounds.some(s => s.pitch !== bass && !tones.includes(s.pitch))) return;
      const fingered = frets.filter((n): n is number => n !== null && n > 0);
      const low = Math.min(...fingered), high = Math.max(...fingered);
      if (high - low > 3) return;
      const indices = frets.flatMap((f,i) => f === low ? [i] : []);
      const barre = indices.length >= 2 && frets.slice(indices[0], indices.at(-1)! + 1).every(f => f === null || f >= low);
      const fingers = fingered.length - (barre ? indices.length - 1 : 0);
      if (fingers > 4 || result.some(v => v.frets.join() === frets.join())) return;
      result.push({ frets, position: low, barre, barreFret: barre ? low : undefined, label: `Inversion · fret ${low}` });
    };
    visit([]);
  }
  return result.sort((a,b) => Number(b.barre) - Number(a.barre) || Number(a.frets.includes(0)) - Number(b.frets.includes(0)) || a.position - b.position).slice(0, 6);
}
export function voicingTab(frets: (number|null)[]): string {
  return ['e','B','G','D','A','E'].map((string, i) => `${string}|--${frets[5-i] === null ? 'x' : frets[5-i]}--|`).join('\n');
}
