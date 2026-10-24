import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { PcmAudio } from '@/song/types';
import { cancelLyrics, generateLyrics, useLyricsJobs } from '@/song/performance/lyrics-jobs';
import { hasSignal } from '@/song/performance/sources';
import { LYRIC_LANGUAGES, lyricsOptions, type LyricsLanguage } from '@/song/performance/lyrics-options';
import { host } from '@/host';

export function LyricsTrack({ audio, storageKey, time, onTextChange, follow = true }: { audio?: PcmAudio; storageKey: string; time: number; onTextChange?: (text: string) => void; follow?: boolean }) {
  const [language, setLanguage] = useState(() => lyricsOptions(storageKey).language);
  const key = storageKey + ':lyrics';
  const [text, setText] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const job = useLyricsJobs(s => s.jobs[storageKey]);
  const status = job?.status ?? '';
  const busy = job?.busy ?? false;
  const [error, setError] = useState('');
  const activeLine = useRef<HTMLParagraphElement>(null);
  const available = useMemo(() => hasSignal(audio), [audio]);
  const lines = useMemo(() => text.split(/\r?\n/).flatMap(line => {
    const match = /^\[(\d+):([0-5]\d(?:\.\d+)?)\]\s*(.*)$/.exec(line);
    return match ? [{ time: Number(match[1]) * 60 + Number(match[2]), text: match[3] }] : [];
  }).sort((a, b) => a.time - b.time), [text]);
  const active = lines.findLastIndex(line => line.time <= time);
  useEffect(() => { if (follow) activeLine.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [active, follow]);
  useEffect(() => { onTextChange?.(text); }, [text, onTextChange]);
  const save = (value: string) => {
    setText(value);
    if (job) useLyricsJobs.setState(s => ({ jobs: { ...s.jobs, [storageKey]: { ...s.jobs[storageKey], text: value } } }));
    try { localStorage.setItem(key, value); } catch { setError('Could not save lyrics locally. Export them to keep a copy.'); }
  };
  useEffect(() => {
    try { setText(localStorage.getItem(key) ?? ''); } catch { setText(''); }
    setError(''); setLanguage(lyricsOptions(storageKey).language);
  }, [key, storageKey]);
  useEffect(() => { if (job?.text !== undefined) setText(job.text); }, [job?.text]);
  useEffect(() => {
    if (audio && available && !text && !job) void generateLyrics(storageKey, audio);
  }, [audio, available, text, job, storageKey]);
  const transcribe = () => { if (audio && available) { setError(''); void generateLyrics(storageKey, audio, { language }); } };
  return <section aria-label="Lyrics text track" className="space-y-3 rounded border border-seam p-4">
    <h3 className="font-semibold">Lyrics text track · from vocals</h3>
    <p className="text-sm text-silkscreen-3">Empty lyrics are generated from the vocals stem when you open Performance. You can switch tabs while transcription runs. Transcription runs on this computer after a one-time model download; singing can be misheard. Your chart and MIDI cues are kept separately.</p>
    <div className="flex flex-wrap items-center gap-3">
      <label>Lyrics language <select aria-label="Lyrics language" className="ml-2 rounded border border-seam bg-background p-2" disabled={busy} value={language} onChange={e => { const next = e.target.value as LyricsLanguage; setLanguage(next); try { const options = JSON.parse(localStorage.getItem(storageKey + ':options') || '{}'); localStorage.setItem(storageKey + ':options', JSON.stringify({ ...options, lyricsLanguage: next })); } catch { setError('Could not save language preference.'); } }}>{LYRIC_LANGUAGES.map(value => <option key={value} value={value}>{value === 'auto' ? 'Detect automatically' : value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      <Button disabled={!available || busy} onClick={() => void transcribe()}>{text ? 'Regenerate lyrics' : 'Generate lyrics from vocals'}</Button>
      {busy && <Button variant="outline" onClick={() => cancelLyrics(storageKey)}>Cancel transcription</Button>}
      <Button variant="outline" disabled={!text} onClick={() => void host.song.saveFiles([{ name: 'lyrics.lrc', bytes: new TextEncoder().encode(text) }], 'Export lyrics text track').catch(e => setError(String(e)))}>Export lyrics</Button>
    </div>
    {!available && <p>Split the song to get a vocals stem with audio before generating lyrics.</p>}
    <p role="status">{status || (!text ? 'No lyrics yet. Generate them from vocals, or import a lyric chart below.' : '')}</p>
    {(error || job?.error) && <p role="alert" className="text-red-400">{error || job?.error}</p>}
    {!!text && <><div aria-label="Transcribed lyrics" className="max-h-64 overflow-auto text-2xl leading-relaxed">{lines.length ? lines.map((line, i) => <p key={i} ref={i === active ? activeLine : undefined} className={i === active ? 'rounded bg-white/10 font-bold' : 'text-silkscreen-3'}>{line.text}</p>) : <p className="whitespace-pre-wrap">{text}</p>}</div><details><summary>Edit transcribed words and timestamps</summary><textarea aria-label="Lyrics text track editor" className="min-h-48 w-full rounded border border-seam bg-transparent p-2 font-mono" disabled={busy} value={text} onChange={e => save(e.target.value)} /></details></>}
  </section>;
}
