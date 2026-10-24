export interface Cue { time: number; text: string; messages: number[][]; label?: string }
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pitch = (n: string) => ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n[0]]! + (n[1] === '#' ? 1 : n[1] === 'b' ? -1 : 0));
export function transpose(text: string, steps: number): string {
  return text.replace(/\[([A-G][#b]?)([^\]\s]*?)\]/g, (_, root: string, tail: string) => {
    const note = (n: string) => NOTES[((pitch(n) + steps) % 12 + 12) % 12];
    return `[${note(root)}${tail.replace(/\/([A-G][#b]?)$/, (_: string, bass: string) => '/' + note(bass))}]`;
  });
}
/** Deliberately strict, documented syntax; values are wire values (PC 0–127), channels 1–16. */
export function midiCommand(command: string): number[] {
  const [type, ...args] = command.trim().split(/\s+/);
  const values = args.map(Number);
  const channel = values[0];
  const counts: Record<string, number> = { pc: 2, cc: 3, note: 3, off: 3 };
  if (type === 'sysex') {
    if (args.length < 2 || args.some(v => !/^[\da-f]{2}$/i.test(v))) throw new Error('SysEx requires hex bytes, including F0 and F7.');
    const bytes = args.map(v => parseInt(v, 16));
    if (bytes[0] !== 240 || bytes.at(-1) !== 247 || bytes.slice(1, -1).some(v => v > 127)) throw new Error('Invalid SysEx framing or data.');
    return bytes;
  }
  if (!counts[type] || values.length !== counts[type] || !Number.isInteger(channel) || channel < 1 || channel > 16 || values.slice(1).some(v => !Number.isInteger(v) || v < 0 || v > 127)) throw new Error(`Invalid MIDI command: ${command}`);
  return [({ pc: 192, cc: 176, note: 144, off: 128 }[type]!) + channel - 1, ...values.slice(1)];
}
export function parseChart(text: string): Cue[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    let label = '';
    const content = line.replace(/\{label:([^}]+)\}/g, (_, value:string) => { label = value.trim().slice(0,400); return ''; });
    const timestamps = [...content.matchAll(/\[(\d+):([0-5]\d(?:\.\d+)?)\]/g)];
    if (!timestamps.length) {
      if (/\{midi:/.test(content)) throw new Error(`Line ${index + 1}: MIDI needs a [mm:ss] timestamp.`);
      return [];
    }
    const messages: number[][] = [];
    const body = content.replace(/\[\d+:[0-5]\d(?:\.\d+)?\]/g, '').replace(/\{midi:([^}]+)\}/g, (_, cmd: string) => { messages.push(midiCommand(cmd)); return ''; }).trim();
    if (body.includes('{midi:')) throw new Error(`Line ${index + 1}: MIDI commands need nonempty contents and a closing brace.`);
    return timestamps.map(t => ({ time: Number(t[1]) * 60 + Number(t[2]), text: body, messages, ...(label ? { label } : {}) }));
  }).sort((a, b) => a.time - b.time);
}
export function lrcTime(time: number): string { const ticks = Math.round(Math.max(0, time) * 100); return `[${String(Math.floor(ticks / 6000)).padStart(2, '0')}:${(ticks % 6000 / 100).toFixed(2).padStart(5, '0')}]`; }

/** Schedule a half-open interval once. Seeking/pausing clears output and resets the caller's cursor. */
export function scheduleCues(cues: Cue[], after: number, until: number, position: number, nowMs: number, send: (bytes: number[], timestamp: number) => void): void {
  for (const cue of cues) if (cue.time > after && cue.time <= until) {
    for (const bytes of cue.messages) send(bytes, nowMs + Math.max(0, cue.time - position) * 1000);
  }
}
