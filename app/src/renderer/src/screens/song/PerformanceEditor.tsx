import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { editableEvents, eventChart, type EditableEvent } from '@/song/performance/editor';
import type { Chord } from '@/song/performance/chords';

export function PerformanceEditor({ chart, lyrics, chords, time, onSave, onCancel }: { chart: string; lyrics: string; chords: Chord[]; time: number; onSave: (chart: string) => void; onCancel: () => void }) {
  const [initial] = useState(() => { try { return { rows: editableEvents(chart, lyrics, chords), error: '' }; } catch { return { rows: [] as EditableEvent[], error: 'Correct the invalid MIDI syntax in the separate chart editor before editing this page.' }; } });
  const [rows, setRows] = useState(initial.rows);
  const [error, setError] = useState(initial.error);
  const update = (id: number, values: Partial<EditableEvent>) => setRows(current => current.map(row => row.id === id ? { ...row, ...values } : row));
  const field = 'mt-1 w-full rounded border border-seam bg-background p-2 text-sm';
  return <div aria-label="Performance page editor" className="min-h-0 space-y-3 overflow-y-auto text-sm">
    <p>Edit the original chord names, lyrics, times and MIDI here. Saving creates a manual chart from the displayed lyrics and chord estimates. Transposition stays a display setting. Audio timing is unchanged.</p>
    {rows.map((row, index) => <fieldset key={row.id} className="grid gap-3 rounded-lg border border-seam p-3 md:grid-cols-[7rem_1fr_2fr]">
      <legend className="px-1">Line {index + 1}</legend>
      <label>Time (seconds)<input aria-label={`Line ${index + 1} time`} className={field} type="number" min="0" step="0.01" placeholder="Untimed" value={row.seconds} onChange={e => update(row.id, { seconds: e.target.value })} /></label>
      <label>Chords<input aria-label={`Line ${index + 1} chords`} className={field} placeholder="Am C G" value={row.chords} onChange={e => update(row.id, { chords: e.target.value })} /></label>
      <label>Lyrics<input aria-label={`Line ${index + 1} lyrics`} className={field} value={row.lyrics} onChange={e => update(row.id, { lyrics: e.target.value })} /></label>
      <label className="md:col-span-2">MIDI commands · one per line<textarea aria-label={`Line ${index + 1} MIDI`} className={field + ' min-h-20 font-mono'} placeholder={'pc 1 12\ncc 1 7 100'} value={row.midi} onChange={e => update(row.id, { midi: e.target.value })} /></label>
      <div><label>Command label<input aria-label={`Line ${index + 1} label`} className={field} value={row.label} onChange={e => update(row.id, { label: e.target.value })} /></label><Button className="mt-2" variant="outline" onClick={() => setRows(current => current.filter(r => r.id !== row.id))}>Delete line {index + 1}</Button></div>
    </fieldset>)}
    <div className="sticky bottom-0 flex flex-wrap gap-3 rounded-lg bg-background p-3">
      <Button variant="outline" onClick={() => setRows(current => [...current, { id: Math.max(-1, ...current.map(r => r.id)) + 1, seconds: String(Math.round(time * 100) / 100), lyrics: '', chords: '', midi: '', label: '' }])}>Add line at playback time</Button>
      <Button disabled={!!initial.error} onClick={() => { try { const next = eventChart(rows); onSave(next); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>Save performance edits</Button>
      <Button variant="outline" onClick={onCancel}>Cancel edits</Button>
      {error && <p role="alert" className="w-full text-red-400">{error}</p>}
    </div>
    <p>MIDI channels are 1–16. Program and controller values are 0–127. Commands: pc, cc, note, off, sysex. Note commands need matching off commands.</p>
  </div>;
}
