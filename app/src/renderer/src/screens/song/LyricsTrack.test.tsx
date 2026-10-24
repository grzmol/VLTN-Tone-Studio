import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LyricsTrack } from './LyricsTrack';
import { useLyricsJobs, cancelLyrics, migrateLyricsJob } from '@/song/performance/lyrics-jobs';

const saveSettings = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/host', () => ({ host: { song: { saveFiles: vi.fn(), library: { settings: saveSettings } } } }));
class FakeWorker {
  static current: FakeWorker;
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string }) => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.current = this; }
}
const audio = { sampleRate: 16000, channels: [new Float32Array(16000).fill(0.2)] };
beforeEach(() => {
  saveSettings.mockClear();
  for (const key of Object.keys(useLyricsJobs.getState().jobs)) cancelLyrics(key);
  useLyricsJobs.setState({ jobs: {} });
  FakeWorker.current = undefined!;
  localStorage.clear();
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('OfflineAudioContext', class {
    destination = {};
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {} }; }
    async startRendering() { return { getChannelData: () => new Float32Array(16000) }; }
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('persists timed transcription separately from charts and follows playback', async () => {
  localStorage.setItem('song', '[00:00] [C] {midi:pc 1 0}');
  const view = render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  fireEvent.click(screen.getByText('Generate lyrics from vocals'));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  await act(async () => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'First' }, { time: 2, text: 'Second' }] } }));
  expect(localStorage.getItem('song:lyrics')).toBe('[00:00.00] First\n[00:02.00] Second');
  expect(localStorage.getItem('song')).toBe('[00:00] [C] {midi:pc 1 0}');
  view.rerender(<LyricsTrack audio={audio} storageKey="song" time={2.1} />);
  expect(screen.getByText('Second').className).toContain('font-bold');
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
});

it('cancels work and ignores late results without replacing saved lyrics', async () => {
  localStorage.setItem('song:lyrics', '[00:00.00] Existing');
  render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  fireEvent.click(screen.getByText('Regenerate lyrics'));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Cancel transcription'));
  await act(async () => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'Late' }] } }));
  expect(FakeWorker.current.terminate).toHaveBeenCalled();
  expect(localStorage.getItem('song:lyrics')).toBe('[00:00.00] Existing');
});

it('passes an explicit language to the local worker and retains other song options', async () => {
  localStorage.setItem('song:lyrics', '[00:00.00] Existing');
  localStorage.setItem('song:options', JSON.stringify({ shift: 3 }));
  render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  fireEvent.change(screen.getByLabelText('Lyrics language'), { target: { value: 'afrikaans' } });
  fireEvent.click(screen.getByText('Regenerate lyrics'));
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  expect(FakeWorker.current.postMessage.mock.calls[0][0].options.language).toBe('afrikaans');
  expect(JSON.parse(localStorage.getItem('song:options')!)).toEqual({ shift: 3, lyricsLanguage: 'afrikaans' });
});

it('automatically generates missing lyrics and keeps working when the tab is closed', async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  view.unmount();
  expect(FakeWorker.current.terminate).not.toHaveBeenCalled();
  await act(async () => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'Completed in background' }] } }));
  render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  expect(screen.getByText('Completed in background')).toBeTruthy();
  expect(localStorage.getItem('song:lyrics')).toContain('Completed in background');
});

it('keeps edited lyrics when returning to the tab', async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  await act(async () => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'Draft' }] } }));
  fireEvent.change(screen.getByLabelText('Lyrics text track editor'), { target: { value: '[00:00.00] Corrected words' } });
  view.unmount();
  render(<LyricsTrack audio={audio} storageKey="song" time={0} />);
  expect(screen.getByText('Corrected words')).toBeTruthy();
});

it('keeps a running job when a song is saved to the library and persists the finished lyrics', async () => {
  const view = render(<LyricsTrack audio={audio} storageKey="file" time={0} />);
  await waitFor(() => expect(FakeWorker.current?.postMessage).toHaveBeenCalled());
  localStorage.setItem('vltn.song:saved', '[00:00] [C]');
  act(() => migrateLyricsJob('file', 'vltn.song:saved'));
  view.unmount();
  await act(async () => FakeWorker.current.onmessage?.({ data: { segments: [{ time: 0, text: 'Saved words' }] } }));
  expect(saveSettings).toHaveBeenCalledWith('saved', expect.objectContaining({ '': '[00:00] [C]', ':lyrics': '[00:00.00] Saved words' }));
  render(<LyricsTrack audio={audio} storageKey="vltn.song:saved" time={0} />);
  expect(screen.getByText('Saved words')).toBeTruthy();
});
