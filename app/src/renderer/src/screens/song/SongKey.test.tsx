import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SongKey } from './SongKey';
import { performanceKey, readSettings, writeSettings } from '@/song/performance/settings';
const workers: FakeWorker[]=[];
class FakeWorker {
  onmessage: ((event:MessageEvent)=>void)|null=null;
  onerror: (()=>void)|null=null;
  postMessage=vi.fn(); terminate=vi.fn();
  constructor(){workers.push(this);}
  done(name='C major'){this.onmessage?.({data:{estimate:{name,tonic:0,mode:'major',confidence:'tentative',correlation:0.7,margin:0.04,alternatives:['A minor','G major']}}} as MessageEvent);}
}
const audio={sampleRate:44100,channels:[new Float32Array(100).fill(.1)]};
beforeEach(()=>{localStorage.clear();workers.length=0;vi.stubGlobal('Worker',FakeWorker);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('analyses the preferred stem and shows its estimate, alternatives and display transposition',()=>{
  render(<SongKey stems={{guitar:audio}} original={audio} storageKey="song" shift={2}/>);
  expect(workers[0].postMessage).toHaveBeenCalledWith(audio);
  act(()=>workers[0].done());
  expect(screen.getByText('Song key: C major')).toBeTruthy();
  expect(screen.getByText(/Estimated C major from guitar/)).toBeTruthy();
  expect(screen.getByText(/Displayed chords: D major/)).toBeTruthy();
});
it('persists manual key through reopening and saved-song settings without changing chart or MIDI',()=>{
  const source={name:'test.wav',audio}, key=performanceKey(source);
  localStorage.setItem(key,'[00:01] {midi:pc 1 2}');
  const props={stems:null,original:audio,storageKey:key};
  const view=render(<SongKey {...props}/>);
  fireEvent.change(screen.getByLabelText('Song key override'),{target:{value:'E minor'}});
  act(()=>workers[0].done());
  expect(screen.getByText('Song key: E minor')).toBeTruthy();
  const settings=readSettings(key);writeSettings('vltn.song:saved',settings);
  view.unmount();render(<SongKey {...props} storageKey="vltn.song:saved"/>);
  expect((screen.getByLabelText('Song key override') as HTMLSelectElement).value).toBe('E minor');
  expect(localStorage.getItem(key)).toBe('[00:01] {midi:pc 1 2}');
});
it('rejects late results after the audio source changes and reports unavailable audio',()=>{
  const view=render(<SongKey stems={{guitar:audio}} original={audio} storageKey="song"/>);
  view.rerender(<SongKey stems={{piano:audio}} original={audio} storageKey="song"/>);
  expect(workers[0].terminate).toHaveBeenCalled();
  act(()=>workers[0].done('G major'));
  expect(screen.queryByText('Song key: G major')).toBeNull();
  act(()=>workers[1].done());
  expect(screen.getByText(/from piano/)).toBeTruthy();
  view.rerender(<SongKey stems={null} storageKey="song"/>);
  expect(screen.getByText('Song key: Unknown')).toBeTruthy();
});

it('keeps the saved estimate while the same source is reanalysed or the worker fails',()=>{
  const estimate={name:'C major',tonic:0,mode:'major',confidence:'tentative',correlation:.7,margin:.04,alternatives:['A minor']};
  localStorage.setItem('song:options',JSON.stringify({detectedKey:estimate,keyAudioSource:'guitar'}));
  render(<SongKey stems={{guitar:audio}} original={audio} storageKey="song"/>);
  expect(screen.getByText('Song key: C major')).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('song:options')!).detectedKey.name).toBe('C major');
  act(()=>workers[0].onerror?.());
  expect(screen.getByText('Song key: C major')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
});
