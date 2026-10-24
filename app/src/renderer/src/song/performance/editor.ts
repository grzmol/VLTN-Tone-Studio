import { midiCommand, parseChart } from './chart';
import type { Chord } from './chords';
import { performanceLines } from './reader';

export interface EditableEvent { id: number; seconds: string; lyrics: string; chords: string; midi: string; label: string }
const chordPattern = /\[([A-G][#b]?[^\]\s]*|N)\]/g;
function command(bytes: number[]): string {
  const channel = (bytes[0] & 15) + 1;
  const kind = ({ 0x80: 'off', 0x90: 'note', 0xb0: 'cc', 0xc0: 'pc' } as Record<number, string>)[bytes[0] & 0xf0];
  return bytes[0] === 0xf0 ? 'sysex ' + bytes.map(b => b.toString(16).padStart(2, '0')).join(' ') : `${kind} ${channel} ${bytes.slice(1).join(' ')}`;
}

/** Promote the displayed draft into an editable chart without losing separate MIDI timestamps. */
export function editableEvents(chart: string, lyrics: string, estimates: Chord[]): EditableEvent[] {
  const cues = parseChart(chart), rows: EditableEvent[] = [];
  const row = (seconds: number) => {
    let found = rows.find(r => r.seconds !== '' && Number(r.seconds) === seconds);
    if (!found) { found = { id: rows.length, seconds: Number.isFinite(seconds) ? String(seconds) : '', lyrics: '', chords: '', midi: '', label: '' }; rows.push(found); }
    return found;
  };
  for (const line of performanceLines(chart, lyrics, estimates)) {
    const target = row(line.time);
    target.lyrics = [target.lyrics, line.text.replace(chordPattern, '').trim()].filter(Boolean).join(' ');
    if (!Number.isFinite(line.time)) target.chords = [...line.text.matchAll(chordPattern)].map(m => m[1]).join(' ');
  }
  const manual = cues.flatMap(c => [...c.text.matchAll(chordPattern)].map(m => ({ time: c.time, name: m[1] })));
  for (const chord of manual.length ? manual : estimates) {
    const target = row(chord.time);
    target.chords = [target.chords, chord.name].filter(Boolean).join(' ');
  }
  for (const cue of cues) if (cue.messages.length || cue.label) {
    const target = row(cue.time);
    target.midi = [target.midi, ...cue.messages.map(command)].filter(Boolean).join('\n');
    target.label = [target.label, cue.label].filter(Boolean).join(' / ');
  }
  return rows.sort((a, b) => (a.seconds === '' ? Infinity : Number(a.seconds)) - (b.seconds === '' ? Infinity : Number(b.seconds)));
}

export function eventChart(rows: EditableEvent[]): string {
  const timestamp = (seconds: number) => {
    const rounded = Number(seconds.toFixed(9)), minutes = Math.floor(rounded / 60);
    const rest = (rounded - minutes * 60).toFixed(9).replace(/0+$/, '');
    const [whole, fraction = ''] = rest.split('.');
    return `[${String(minutes).padStart(2, '0')}:${whole.padStart(2, '0')}.${fraction.padEnd(2, '0')}]`;
  };
  return rows.map((row, index) => {
    const seconds = row.seconds.trim() === '' ? null : Number(row.seconds);
    if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0)) throw new Error(`Line ${index + 1}: time must be zero or more seconds.`);
    const chords = row.chords.trim().split(/\s+/).filter(Boolean);
    if (chords.some(c => c !== 'N' && !/^[A-G][#b]?[A-Za-z0-9+#b°ø()/-]*$/.test(c))) throw new Error(`Line ${index + 1}: use chord names such as Am, C7 or D/F#. N means no chord.`);
    const commands = row.midi.split('\n').map(s => s.trim()).filter(Boolean);
    if (commands.length && seconds === null) throw new Error(`Line ${index + 1}: MIDI needs a timestamp.`);
    commands.forEach(midiCommand);
    if (/[\r\n{}]/.test(row.lyrics) || /\[\d+:[0-5]\d|\[[A-G]/.test(row.lyrics)) throw new Error(`Line ${index + 1}: put chords and MIDI in their own fields; lyrics must be one line.`);
    if (/[{}\r\n]/.test(row.label)) throw new Error(`Line ${index + 1}: label must be one line without braces.`);
    return [seconds === null ? '' : timestamp(seconds), ...chords.map(c => `[${c}]`), row.lyrics.trim(), row.label.trim() ? `{label:${row.label.trim()}}` : '', ...commands.map(c => `{midi:${c}}`)].filter(Boolean).join(' ');
  }).filter(Boolean).join('\n');
}
