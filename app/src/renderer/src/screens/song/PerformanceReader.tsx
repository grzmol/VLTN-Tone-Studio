import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog as StageDialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { lrcTime, transpose, parseChart, type Cue } from '@/song/performance/chart';
import { useMidiConfiguration } from '@/song/performance/midi-configuration';
import type { Chord } from '@/song/performance/chords';
import { ChordVoicings } from './ChordVoicings';
import { PerformanceEditor } from './PerformanceEditor';
import { performanceLines } from '@/song/performance/reader';

function formatted(text: string) {
  return text.replace(/\[N\]/g, '').split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('*') ? <em key={i}>{part.slice(1, -1)}</em> : /^\[[A-G]/.test(part) ? null : part);
}

export function PerformanceReader({ chart, lyrics, chords, time, shift, title, transport, status, onEditStart, onSaveChart, stage=false, onExitStage }: { stage?:boolean; onExitStage?:()=>void; chart: string; lyrics: string; chords: Chord[]; time: number; shift: number; title: string; transport?: ReactNode; status?: ReactNode; onEditStart?: () => void; onSaveChart?: (chart: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  useEffect(()=>{if(stage){setEditing(false);setSelectedChord(null);}},[stage]);
  const showCommands = useMidiConfiguration(s => s.showCommands);
  const lines = useMemo(() => {
    const result = performanceLines(chart, lyrics, chords).map(line => ({ ...line, midi: [] as Cue[] }));
    if (showCommands) {
      let cues: Cue[] = []; try { cues = parseChart(chart); } catch { /* Editor shows validation errors. */ }
      for (const cue of cues.filter(c => c.messages.length)) {
        const existing = result.find(line => line.time === cue.time);
        if (existing) existing.midi.push(cue);
        else result.push({ time: cue.time, text: '', chords: [], midi: [cue] });
      }
      result.sort((a,b) => (Number.isFinite(a.time) ? a.time : Infinity)-(Number.isFinite(b.time) ? b.time : Infinity));
    }
    return result;
  }, [chart, lyrics, chords, showCommands]);
  const [expanded, setExpanded] = useState(false), [follow, setFollow] = useState(true), [size, setSize] = useState(28);
  const viewport = useRef<HTMLDivElement>(null), current = useRef<HTMLDivElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const chordButton = useRef<HTMLButtonElement | null>(null);
  const active = lines.findLastIndex(line => line.time <= time);
  const changes = lines.flatMap(line => line.chords);
  const activeChord = changes.findLastIndex(chord => chord.time <= time);
  useEffect(() => {
    if (!follow || !viewport.current || !current.current) return;
    const panel = viewport.current, line = current.current;
    const top = panel.scrollTop + line.getBoundingClientRect().top - panel.getBoundingClientRect().top - panel.clientHeight * 0.3;
    panel.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [active, follow, expanded, stage, size, lines]);
  useEffect(() => {
    if (stage || !expanded || selectedChord) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExpanded(false); expandButton.current?.focus(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [expanded, selectedChord, stage]);
  const content=<section aria-label="Combined performance view" className={expanded || stage ? 'fixed inset-0 z-50 flex flex-col bg-background p-6 text-foreground' : 'flex flex-col rounded-xl border border-seam bg-black/10 p-4'}>
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h2 className="font-semibold">Lyrics & chords · Perform</h2><p className="text-sm text-silkscreen-3">{title} · {lrcTime(time)}</p></div>
      {!stage && onSaveChart && <Button variant="outline" disabled={editing} onClick={() => { onEditStart?.(); setEditing(true); }}>Edit chords, lyrics & MIDI</Button>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Follow playback</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showCommands} onChange={e => useMidiConfiguration.getState().update({ showCommands: e.target.checked })} /> Show MIDI commands</label>
      <Button variant="outline" aria-label="Smaller performance text" disabled={size <= 20} onClick={() => setSize(n => n - 4)}>A−</Button>
      <Button variant="outline" aria-label="Larger performance text" disabled={size >= 48} onClick={() => setSize(n => n + 4)}>A+</Button>
      {stage ? <Button variant="outline" onClick={onExitStage}>Exit stage mode</Button> : <Button ref={expandButton} variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Close expanded view' : 'Expand performance view'}</Button>}
    </div>
    {(expanded || stage) && <div className={stage?"mb-3 flex flex-wrap items-center gap-4 [&_button]:min-h-14 [&_button]:min-w-28 [&_button]:text-lg":"mb-3 flex flex-wrap items-center gap-3"}>{transport}</div>}
    {status && <div className="mb-3 shrink-0 space-y-1 text-sm" aria-label="Performance status">{status}</div>}
    {!stage && editing && onSaveChart ? <PerformanceEditor chart={chart} lyrics={lyrics} chords={chords} time={time} onCancel={() => setEditing(false)} onSave={next => { onSaveChart(next); setEditing(false); }} /> : <div ref={viewport} tabIndex={0} aria-label="Combined lyrics and chords" className={expanded || stage ? 'relative min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg p-6' : 'relative h-[28rem] overflow-y-auto overscroll-contain rounded-lg p-4'} style={{ fontSize: stage?Math.max(36,size):size, lineHeight: 1.6 }}>
      {lines.length ? <div className="mx-auto max-w-4xl pb-48">{lines.map((line, index) => <div key={index} ref={index === active ? current : undefined} aria-current={index === active ? 'true' : undefined} className={'mb-5 rounded-lg border-l-4 px-5 py-3 transition-colors ' + (index === active ? 'border-sky-400 bg-sky-400/10 text-foreground' : 'border-transparent text-silkscreen-3')}>
        {!!line.chords.length && <div aria-label="Chords" className="flex flex-wrap gap-x-6 font-semibold text-sky-400">{line.chords.map((chord, i) => chord.name === 'N' ? <span key={i}>—</span> : <button disabled={stage} key={i} type="button" aria-label={`Show ${transpose(`[${chord.name}]`, shift).slice(1, -1)} guitar voicings`} title={(Number.isFinite(chord.time) ? lrcTime(chord.time) + ' · ' : '') + 'Show guitar tabs'} onClick={event => { chordButton.current = event.currentTarget; setSelectedChord(transpose(`[${chord.name}]`, shift).slice(1, -1)); }} className={'cursor-pointer rounded px-1 text-left hover:bg-sky-400/15 focus-visible:outline-2 focus-visible:outline-sky-400 ' + (changes[activeChord] === chord ? 'bg-sky-400/20 text-sky-300 ring-1 ring-sky-400' : '')}>{transpose(`[${chord.name}]`, shift).slice(1, -1)}</button>)}</div>}
        {!!line.text && <p className={index === active ? 'whitespace-pre-wrap font-semibold' : 'whitespace-pre-wrap'}>{formatted(transpose(line.text, shift))}</p>}
        {line.midi.map((cue,i) => <div key={i} aria-label="MIDI cue" className="my-2 rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm text-amber-300"><strong>{lrcTime(cue.time)} · {cue.label || 'MIDI command'}</strong><span className="ml-2 font-mono">{cue.messages.map(bytes => bytes[0] < 0xf0 ? `ch ${(bytes[0]&15)+1} · ${bytes[0]>>4 === 12 ? 'PC' : bytes[0]>>4 === 11 ? 'CC' : 'MIDI'} ${bytes.slice(1).join(' ')}` : 'SysEx').join(' → ')}</span></div>)}
      </div>)}</div> : <p className="text-base text-silkscreen-3">Generate lyrics from vocals or import a timed chart in the editors below. Lyrics and chords will appear together here and follow song playback.</p>}
    </div>}
    <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} returnFocus={() => chordButton.current?.focus({ preventScroll: true })} />
    <p className="mt-2 text-xs text-silkscreen-3">Chords follow their timestamps above the corresponding lyric line. Chart chords take priority over estimates. Untimed text stays available for manual reading.</p>
  </section>;
  return stage?<StageDialog.Root open><StageDialog.Portal><StageDialog.Content aria-describedby={undefined} onEscapeKeyDown={event=>event.preventDefault()} onInteractOutside={event=>event.preventDefault()} className="fixed inset-0 z-50 bg-background text-foreground"><StageDialog.Title className="sr-only">Stage mode</StageDialog.Title>{content}</StageDialog.Content></StageDialog.Portal></StageDialog.Root>:content;
}
