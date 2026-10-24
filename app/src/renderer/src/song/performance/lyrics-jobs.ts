import { create } from 'zustand';
import { host } from '@/host';
import type { PcmAudio } from '../types';
import { lyricsLrc, type LyricSegment } from './lyrics';
import { readSettings } from './settings';
import { lyricsOptions, type LyricsOptions } from './lyrics-options';

export interface LyricsJob { busy: boolean; status: string; error: string; text?: string }
export const useLyricsJobs = create<{ jobs: Record<string, LyricsJob> }>(() => ({ jobs: {} }));
interface Running { keys: Set<string>; worker?: Worker; cancelled: boolean }
const running = new Map<string, Running>();
function update(task: Running, patch: Partial<LyricsJob>) {
  useLyricsJobs.setState(state => ({ jobs: { ...state.jobs, ...Object.fromEntries([...task.keys].map(key => [key, { ...state.jobs[key], ...patch }])) } }));
}
export function migrateLyricsJob(from: string, to: string) {
  const task = running.get(from);
  if (!task) return;
  task.keys.add(to); running.set(to, task);
  update(task, useLyricsJobs.getState().jobs[from]);
}
export function cancelLyrics(key: string) {
  const task = running.get(key); if (!task) return;
  task.cancelled = true; task.worker?.terminate();
  update(task, { busy: false, status: 'Transcription cancelled. Generate lyrics to retry.' });
  for (const alias of task.keys) running.delete(alias);
}
/** Jobs belong to the song, not a mounted tab. No pedal or MIDI access. */
export async function generateLyrics(key: string, audio: PcmAudio, options: LyricsOptions = lyricsOptions(key)): Promise<void> {
  if (running.has(key)) return;
  const task: Running = { keys: new Set([key]), cancelled: false }; running.set(key, task);
  update(task, { busy: true, status: 'Preparing vocals…', error: '' });
  const finish = () => { task.worker?.terminate(); for (const alias of task.keys) running.delete(alias); update(task, { busy: false }); };
  try {
    const context = new OfflineAudioContext(1, Math.ceil(audio.channels[0].length * 16000 / audio.sampleRate), 16000);
    const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
    audio.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
    const pcm = (await context.startRendering()).getChannelData(0);
    if (task.cancelled) return;
    const worker = new Worker(new URL('./lyrics-worker.ts', import.meta.url), { type: 'module' }); task.worker = worker;
    update(task, { status: 'Loading lyrics model… First use downloads and caches the model.' });
    worker.onmessage = async (event: MessageEvent<{ status?: string; error?: string; segments?: LyricSegment[] }>) => {
      if (task.cancelled) return;
      if (event.data.status) update(task, { status: event.data.status });
      if (event.data.error) { update(task, { error: event.data.error, status: '' }); finish(); }
      if (event.data.segments) {
        const text = lyricsLrc(event.data.segments);
        if (text) {
          update(task, { text, status: 'Lyrics ready. Review the words and timing while listening.' });
          try {
            for (const alias of task.keys) {
              localStorage.setItem(alias + ':lyrics', text);
              if (alias.startsWith('vltn.song:') && host.song.library) await host.song.library.settings(alias.slice('vltn.song:'.length), readSettings(alias));
            }
          } catch (e) { update(task, { error: `Lyrics generated, but saving failed: ${String(e)}. Export a copy.` }); }
        } else update(task, { status: 'No words detected. Import or type lyrics, or retry transcription.' });
        finish();
      }
    };
    worker.onerror = e => { if (!task.cancelled) { update(task, { error: e.message || 'Lyrics worker could not start. Retry transcription.', status: '' }); finish(); } };
    worker.postMessage({ pcm, options }, [pcm.buffer]);
  } catch (e) { if (!task.cancelled) { update(task, { error: String(e), status: '' }); finish(); } }
}
