import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { lrcTime, midiCommand, type Cue } from '@/song/performance/chart';
import { PedalMidiPicker } from './PedalMidiPicker';

export function MidiCueBuilder({ time, cues, onAdd, onTest, canTest }: { time: number; cues: Cue[]; onAdd: (line: string) => void; onTest: (bytes: number[]) => void; canTest: boolean }) {
  const [seconds, setSeconds] = useState(0), [channel, setChannel] = useState(1);
  const [type, setType] = useState('pc'), [number, setNumber] = useState(0), [value, setValue] = useState(127), [error, setError] = useState('');
  const field = 'ml-2 rounded border border-seam bg-background p-2';
  const command = () => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Cue time must be zero or more seconds.');
    const text = `${type} ${channel} ${number}${type === 'cc' ? ` ${value}` : ''}`;
    return { text, bytes: midiCommand(text) };
  };
  const run = (test: boolean) => { try { const cue = command(); setError(''); if (test) onTest(cue.bytes); else onAdd(`${lrcTime(seconds)} {midi:${cue.text}}`); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const scheduled = cues.filter(cue => cue.messages.length);
  const describe = (bytes: number[]) => (bytes[0] & 0xf0) === 0xc0 ? `PC ${bytes[1]}` : (bytes[0] & 0xf0) === 0xb0 ? `CC ${bytes[1]} = ${bytes[2]}` : bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return <div aria-label="MIDI cue builder" className="space-y-3 rounded border border-seam p-3">
    <h3 className="font-semibold">Song MIDI cues</h3>
    <div className="flex flex-wrap items-center gap-3 text-sm"><label>At seconds<input aria-label="Cue time in seconds" className={field + ' w-24'} type="number" min="0" step="0.01" value={seconds} onChange={e => setSeconds(e.target.valueAsNumber)} /></label><Button variant="outline" onClick={() => setSeconds(Math.round(time * 100) / 100)}>Use playback time</Button></div>
    <PedalMidiPicker time={seconds} onAdd={onAdd} onTest={onTest} canTest={canTest} />
    <details><summary className="cursor-pointer text-sm">Raw MIDI command</summary>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label>Channel<input aria-label="Cue MIDI channel" className={field + ' w-20'} type="number" min="1" max="16" value={channel} onChange={e => setChannel(e.target.valueAsNumber)} /></label>
      <label>Command<select aria-label="Cue command" className={field} value={type} onChange={e => setType(e.target.value)}><option value="pc">Program Change</option><option value="cc">Control Change</option></select></label>
      <label>{type === 'pc' ? 'Program (0–127)' : 'Controller (0–127)'}<input aria-label="Cue command number" className={field + ' w-20'} type="number" min="0" max="127" value={number} onChange={e => setNumber(e.target.valueAsNumber)} /></label>
      {type === 'cc' && <label>Value<input aria-label="Cue CC value" className={field + ' w-20'} type="number" min="0" max="127" value={value} onChange={e => setValue(e.target.valueAsNumber)} /></label>}
      <Button onClick={() => run(false)}>Add MIDI cue</Button>
      <Button variant="outline" disabled={!canTest} onClick={() => run(true)}>Send MIDI now</Button>
    </div>
    </details>
    <p className="text-xs text-silkscreen-3">Set the channel to the target pedal. Added cues are saved in this song’s chart and sent during playback when Send cues is enabled. Program numbers are wire values: a pedal labelled 1–128 may display one higher. Send MIDI now transmits immediately to the selected output.</p>
    {scheduled.length ? <div className="max-h-48 overflow-auto"><table aria-label="Scheduled MIDI cues" className="w-full text-left text-sm"><thead><tr><th className="p-2">Time</th><th className="p-2">Pedal / action</th><th className="p-2">Channel</th><th className="p-2">MIDI</th></tr></thead><tbody>{scheduled.map((cue,i) => <tr key={i} className="border-t border-seam"><td className="p-2 font-mono">{lrcTime(cue.time)}</td><td className="p-2">{cue.label || 'Raw MIDI command'}</td><td className="p-2">{[...new Set(cue.messages.map(bytes=>bytes[0]<0xf0?(bytes[0]&15)+1:'System'))].join(', ')}</td><td className="p-2 font-mono">{cue.messages.map(describe).join(' → ')}</td></tr>)}</tbody></table><p className="text-xs text-silkscreen-3">Edit or remove cues in the chart editor below. Multi-message actions are sent in the order shown.</p></div> : <p className="text-sm text-silkscreen-3">No MIDI cues in this song yet.</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
