import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PerformancePanel } from './PerformancePanel';
import { readMidiConfiguration, useMidiConfiguration } from '@/song/performance/midi-configuration';
import type { SchedulerConfig, ScheduledMessage } from '@/song/performance/midi-scheduler';
vi.mock('@/song/performance/midi-scheduler-client',async()=>{
  const {MidiSchedule}=await import('@/song/performance/midi-scheduler');
  const now=()=>performance.timeOrigin+performance.now();
  return {midiNow:now,prepareMidiScheduler:()=>({worker:{terminate:vi.fn()},ready:Promise.resolve(),cancel:vi.fn()}),startMidiScheduler:(config:SchedulerConfig,send:(message:ScheduledMessage)=>void,fault:(message:string)=>void)=>{
    const schedule=new MidiSchedule(config,now(),reply=>{if(reply.type==='fault')fault(reply.error);else if(reply.type==='batch')reply.messages.forEach(send);});
    schedule.tick(now());const timer=setInterval(()=>schedule.tick(now()),20);
    return {stop(){schedule.stop();clearInterval(timer);},sync(position:number){schedule.sync(position,now(),now());}};
  }};
});
beforeEach(()=>{localStorage.clear();useMidiConfiguration.setState(readMidiConfiguration());HTMLElement.prototype.scrollTo=vi.fn();});
it.each([0, 10])('preserves cues at the requested %s-second offset after a delayed render',async offset=>{
  mocks.position=offset;mocks.playAdvance=.03;
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100',`[00:00] {midi:pc 1 7}\n[00:10] {midi:pc 1 8}`);
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.map(c=>c[0])).toEqual([[192,offset===0?7:8]]);
});
it('disarms instead of replaying opening cues after an overdue start',async()=>{
  mocks.playAdvance=.3;
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {midi:pc 1 7}');
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('MIDI timing interrupted');
});
it('keeps timing faults and disarming visible in expanded performance view',async()=>{
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  fireEvent.click(screen.getByText('Expand performance view'));
  const reader=within(screen.getByLabelText('Combined performance view'));
  expect(reader.getByLabelText('Performance status').textContent).toContain('Cues armed');
  mocks.position=2;act(()=>vi.advanceTimersByTime(60));
  expect(reader.getByRole('alert').textContent).toContain('MIDI timing interrupted');
  expect(reader.getByLabelText('Performance status').textContent).toContain('Cues disarmed');
  expect(reader.getByText('Pause')).toBeTruthy();
});
it('shows connection loss inside the expanded reader',()=>{
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  const view=render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByText('Expand performance view'));
  mocks.bluetooth=null;view.rerender(<PerformancePanel/>);
  expect(within(screen.getByLabelText('Combined performance view')).getByLabelText('Performance status').textContent).toContain('Output disconnected · Cues disarmed');
});
const mocks = vi.hoisted(() => ({ send: vi.fn(), clear: vi.fn(), metronome: vi.fn(), mix: vi.fn(), bluetooth: null as null | {id: string; name: string; state: string; send: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>}, position: 0, playAdvance: 0, source: { name: 'clock-test.wav', libraryId: undefined as string|undefined, audio: { sampleRate: 44100, channels: [new Float32Array(44100)] } } }));
vi.mock('@/song/store', () => ({ useSong: Object.assign((select: (s: unknown) => unknown) => select({source: mocks.source, stems: null}), {getState:()=>({source:mocks.source})}) }));
vi.mock('@/state/device', () => ({ useDevice: (select: (s: unknown) => unknown) => select({device: 'gp5', preset: null, mode: 'mock'}) }));
const playlist=vi.hoisted(()=>({active:false,queue:[] as string[],position:0,playlistPlaying:true,busy:false,index:{songs:[]},midiSession:null as {access:MIDIAccess|null;portId:string;inputId:string;armed:boolean;output:unknown}|null,rememberMidi:vi.fn(),pausePlaylist:vi.fn(),resumePlaylist:vi.fn()}));
vi.mock('@/song/library', () => ({ useSongLibrary: Object.assign(() => playlist.active?playlist:({queue: [], position: -1, index: {songs: []}}), {getState:()=>playlist.active?playlist:({queue:[],position:-1,playlistPlaying:false})}) }));
vi.mock('@/host', () => ({ host: {song:{}} }));
vi.mock('@/bluetooth/connection', () => ({ useBluetooth: Object.assign((select: (s: unknown) => unknown) => select({connection: mocks.bluetooth}), {getState:()=>({connection:mocks.bluetooth,diagnostics:null})}) }));
vi.mock('@/bluetooth/BluetoothControls', () => ({ BluetoothControls: () => null }));
vi.mock('./LyricsTrack', () => ({ LyricsTrack: () => null }));
vi.mock('@/song/stems/player', () => ({ StemPlayer: class { names=['other']; duration=60; get position(){return mocks.position;} async seek(value: number){mocks.position=value;} isPlaying=false; setMix(value: unknown){mocks.mix(value);} setMetronome(value: unknown){mocks.metronome(value);} async dispose(){} async play(){this.isPlaying=true;mocks.position+=mocks.playAdvance;} pause(){this.isPlaying=false;} } }));
afterEach(() => { cleanup(); playlist.active=false; mocks.source.libraryId=undefined; mocks.bluetooth=null; mocks.position=0; mocks.playAdvance=0; mocks.send.mockClear(); mocks.clear.mockClear(); mocks.metronome.mockClear(); mocks.mix.mockClear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('replaces a playlist worker without replaying old-song cues and invalidates carried arming on a timing fault',async()=>{
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  playlist.active=true;playlist.queue=['a','b'];playlist.position=0;playlist.playlistPlaying=true;
  playlist.midiSession={access:null,portId:'bluetooth-midi',inputId:'',armed:true,output:mocks.bluetooth};
  playlist.rememberMidi.mockImplementation(session=>{playlist.midiSession=session;});
  playlist.pausePlaylist.mockImplementation(()=>{playlist.playlistPlaying=false;});
  localStorage.setItem('vltn.song:a','[00:00] {midi:pc 1 1}\n[00:00.20] {midi:pc 1 2}');
  localStorage.setItem('vltn.song:b','[00:00] {midi:pc 1 3}');
  mocks.source={...mocks.source,libraryId:'a'};
  let view:ReturnType<typeof render>;
  await act(async()=>{view=render(<PerformancePanel/>);});
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([192,1]);
  playlist.position=1;mocks.source={...mocks.source,libraryId:'b'};mocks.position=0;
  await act(async()=>{view.rerender(<PerformancePanel/>);});
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([192,3]);
  for(let ms=20;ms<=240;ms+=20){mocks.position=ms/1000;act(()=>vi.advanceTimersByTime(20));}
  expect(mocks.send.mock.calls.map(c=>c[0])).not.toContainEqual([192,2]);
  mocks.position=2;act(()=>vi.advanceTimersByTime(60));
  expect(playlist.midiSession?.armed).not.toBe(true);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});
it('disarms after a renderer stall instead of replaying missed patch changes',async()=>{
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00.04] {midi:pc 1 1}\n[00:00.40] {midi:pc 1 2}\n[00:00.60] {midi:pc 1 3}');
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  mocks.send.mockClear();mocks.clear.mockClear();
  mocks.position=2;
  act(()=>vi.advanceTimersByTime(60));
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
  expect(mocks.clear).toHaveBeenCalled();
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('MIDI timing interrupted');
  expect(screen.getByText('Pause')).toBeTruthy();
  mocks.position=3;act(()=>vi.advanceTimersByTime(1000));
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
});
it('disarms when audio time stops advancing instead of sending cues early',async()=>{
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  act(()=>vi.advanceTimersByTime(300));
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('MIDI timing interrupted');
});
it('never sends to a replacement USB output with the same ID without explicit rearming',async()=>{
  vi.useFakeTimers();const replacementSend=vi.fn();
  const access=Object.assign(new EventTarget(),{outputs:new Map([['usb',{id:'usb',name:'GP-180',state:'connected',send:mocks.send,clear:mocks.clear}]]),inputs:new Map()});
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00.10] {midi:pc 1 2}');
  render(<PerformancePanel/>);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'usb'}});
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  access.outputs.set('usb',{id:'usb',name:'GP-180',state:'connected',send:replacementSend,clear:vi.fn()});
  mocks.position=.08;act(()=>access.dispatchEvent(new Event('statechange')));
  act(()=>vi.advanceTimersByTime(20));
  expect(replacementSend).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});
it('does not queue chart commands beyond the end of the audio',async()=>{
  vi.useFakeTimers();mocks.position=59.98;
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[01:00.01] {midi:pc 1 8}');
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
});
it('does not create a Stop feedback loop when the pedal echoes transport messages',async()=>{
  vi.useFakeTimers();
  const input=Object.assign(new EventTarget(),{id:'remote',name:'Pedal THRU',state:'connected'});
  const send=vi.fn((bytes:number[])=>{
    // Bound the simulated echo so a regression fails without overflowing the stack.
    if(bytes[0]===252 && send.mock.calls.length<20) input.dispatchEvent(Object.assign(new Event('midimessage'),{data:new Uint8Array([252])}));
  });
  const access=Object.assign(new EventTarget(),{outputs:new Map([['usb',{id:'usb',name:'GP-180',state:'connected',send,clear:mocks.clear}]]),inputs:new Map([['remote',input]])});
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  render(<PerformancePanel/>);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'usb'}});
  fireEvent.change(screen.getByLabelText('MIDI input'),{target:{value:'remote'}});
  fireEvent.click(screen.getByLabelText('Send cues'));fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  send.mockClear();fireEvent.click(screen.getByText('Pause'));
  const stops=send.mock.calls.filter(c=>c[0][0]===252).length;
  expect(stops).toBeGreaterThan(0);expect(stops).toBeLessThanOrEqual(2);
  send.mockClear();act(()=>input.dispatchEvent(Object.assign(new Event('midimessage'),{data:new Uint8Array([252])})));
  expect(send).not.toHaveBeenCalled();
});
it('preserves queued BLE note releases when pause and lifecycle cleanup both run',async()=>{
  let generation=0;const delivered:number[][]=[];
  const clear=vi.fn(()=>{generation++;});
  const send=vi.fn((bytes:number[])=>{const scheduled=generation;void Promise.resolve().then(()=>{if(scheduled===generation)delivered.push(bytes);});});
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send,clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {midi:note 5 60 100}');
  render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(delivered).toContainEqual([0x94,60,100]);clear.mockClear();delivered.length=0;
  await act(async()=>{fireEvent.click(screen.getByText('Pause'));});
  expect(clear).toHaveBeenCalledTimes(1);
  expect(delivered).toEqual([[0xb4,64,0],[0xb4,123,0]]);
});
it('locks recording BPM during playback and stops MIDI clock on pause', async () => {
  vi.useFakeTimers(); localStorage.clear(); HTMLElement.prototype.scrollIntoView=vi.fn();
  const access=Object.assign(new EventTarget(), { outputs: new Map([['fake', {id:'fake', name:'Fake MIDI', state:'connected', send:mocks.send, clear:mocks.clear}]]), inputs: new Map() });
  vi.stubGlobal('navigator', {requestMIDIAccess: async () => access});
  render(<PerformancePanel />);
  await act(async () => { fireEvent.click(screen.getByText('Enable USB / system MIDI')); });
  fireEvent.change(screen.getByLabelText('MIDI output'), {target:{value:'fake'}});
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async () => { fireEvent.click(screen.getByText('Play song')); });
  expect(mocks.send.mock.calls.some(c=>c[0][0]===250)).toBe(true);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(false);
  mocks.send.mockClear();
  expect((screen.getByLabelText('BPM') as HTMLInputElement).disabled).toBe(true);
  mocks.position=0.04; act(()=>vi.advanceTimersByTime(40));
  expect(mocks.send.mock.calls.some(c=>[250,251,252].includes(c[0][0]))).toBe(false);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(true);
  fireEvent.click(screen.getByText('Pause'));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(true);
});

it('sends timed song cues to Bluetooth without a USB editor or Web MIDI access', async () => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('navigator', {});
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100', '[00:00] {midi:pc 3 7}\n[00:01] {midi:cc 4 12 127}');
  render(<PerformancePanel />);
  expect((screen.getByLabelText('MIDI output') as HTMLSelectElement).value).toBe('bluetooth-midi');
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async () => { fireEvent.click(screen.getByText('Play song')); });
  act(() => vi.advanceTimersByTime(20));
  expect(mocks.send.mock.calls.filter(c => c[0][0] === 0xc2).map(c => c[0])).toEqual([[0xc2,7]]);
  while(mocks.position<0.98){mocks.position=Math.min(.98,mocks.position+.02);act(()=>vi.advanceTimersByTime(20));}
  mocks.position=1.2; act(() => vi.advanceTimersByTime(40));
  expect(mocks.send.mock.calls.filter(c => c[0][0] === 0xb3 && c[0][1] === 12).map(c => c[0])).toEqual([[0xb3,12,127]]);
  fireEvent.click(screen.getByText('Pause'));
  expect(mocks.clear).toHaveBeenCalled();
});
it('disarms after a Bluetooth disconnect and does not re-arm a replacement connection', () => {
  localStorage.clear();
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  const view = render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(true);
  mocks.bluetooth=null; view.rerender(<PerformancePanel />);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  mocks.bluetooth = {id: 'bluetooth-midi', name: 'GP-180 BLE', state: 'connected', send: mocks.send, clear: mocks.clear};
  view.rerender(<PerformancePanel />);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});

it('remembers global metronome, song clock and mixer settings without arming MIDI', () => {
  localStorage.clear();
  const view=render(<PerformancePanel />);
  expect(screen.queryByText('Start rhythm')).toBeNull();
  fireEvent.click(screen.getByLabelText('Metronome'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  fireEvent.change(screen.getByLabelText('Song volume'), {target:{value:'0.4'}});
  expect(mocks.metronome.mock.lastCall?.[0]).toMatchObject({enabled:true,bpm:120});
  expect(mocks.mix.mock.lastCall?.[0].other.volume).toBe(0.4);
  view.unmount(); render(<PerformancePanel />);
  expect((screen.getByLabelText('Metronome') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('MIDI Clock (24 PPQN)') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('Song volume') as HTMLInputElement).value).toBe('0.4');
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('disables clock during playback without replaying transport or stopping audio', async () => {
  vi.useFakeTimers(); localStorage.clear();
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100', '[00:00.04] {midi:pc 1 9}');
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  act(()=>vi.advanceTimersByTime(20));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(true);
  mocks.send.mockClear();
  mocks.position=0.01;
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===252)).toBe(true);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192).map(c=>c[0])).toEqual([[192,9]]);
  mocks.send.mockClear();
  mocks.position=0.11; act(()=>vi.advanceTimersByTime(100));
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(false);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
  expect(screen.getByText('Pause')).toBeTruthy();
});

it.each([90,120,180])('schedules exactly 24 MIDI clock pulses per beat at %i BPM',async bpm=>{
  vi.useFakeTimers(); localStorage.clear();
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100:bpm',String(bpm));
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  const origin=performance.now();
  for(let ms=20;ms<=10000;ms+=20){mocks.position=ms/1000;act(()=>vi.advanceTimersByTime(20));}
  const stamps=mocks.send.mock.calls.filter(c=>c[0][0]===248).map(c=>c[1]-origin).filter(t=>t<10000-0.001);
  expect(stamps).toHaveLength(bpm/60*24*10);
  // Ignore the first already-due pulse; subsequent timestamps must form a steady tempo grid.
  // Cross-worker epoch timestamps lose sub-microsecond floating-point precision.
  for(let i=2;i<stamps.length;i++)expect(stamps[i]-stamps[i-1]).toBeCloseTo(60000/bpm/24,3);
  fireEvent.click(screen.getByText('Pause'));
  mocks.send.mockClear();act(()=>vi.advanceTimersByTime(1000));
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===248)).toHaveLength(0);
});

it('sends Start before clock and keeps a fixed timestamp grid through audio polling jitter', async () => {
  vi.useFakeTimers(); localStorage.clear();
  mocks.position=-0.02; // The audio sources start after a 20 ms pre-roll.
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('MIDI Clock (24 PPQN)'));
  const origin=performance.now()+20;
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls[0][0]).toEqual([250]);
  for(let ms=20;ms<=1000;ms+=20){
    // AudioContext.currentTime is quantized, unlike performance.now().
    mocks.position=ms/1000-0.02+(ms%40===0 ? 0.002 : -0.001);
    act(()=>vi.advanceTimersByTime(20));
  }
  const stamps=mocks.send.mock.calls.filter(c=>c[0][0]===248).map(c=>c[1]);
  expect(stamps[0]).toBeCloseTo(origin,5);
  stamps.forEach((stamp,i)=>expect(stamp).toBeCloseTo(origin+i*60000/120/24,3));
});
it('keeps scheduled MIDI running while commands are hidden and remembers visibility', async () => {
  vi.useFakeTimers();
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {label:Opening preset} {midi:pc 1 3}\n[00:01] {label:Delay change} {midi:cc 1 12 100}');
  const view=render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(screen.getAllByLabelText('MIDI cue')).toHaveLength(2);
  mocks.clear.mockClear(); mocks.send.mockClear();
  fireEvent.click(screen.getByLabelText('Show MIDI commands'));
  expect(screen.queryByLabelText('MIDI cue')).toBeNull();
  expect(screen.queryByLabelText('MIDI cue builder')).toBeNull();
  expect(screen.getByText('Pause')).toBeTruthy();
  expect(mocks.clear).not.toHaveBeenCalled();
  while(mocks.position<0.98){mocks.position=Math.min(.98,mocks.position+.02);act(()=>vi.advanceTimersByTime(20));}
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===176 && c[0][1]===12).map(c=>c[0])).toEqual([[176,12,100]]);
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===192)).toHaveLength(0);
  view.unmount(); render(<PerformancePanel/>);
  expect((screen.getByLabelText('Show MIDI commands') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});

it('remembers USB configuration and applies GP-180 one-time song tempo without arming on reopen', async () => {
  const access=Object.assign(new EventTarget(), { outputs:new Map([['gp180',{id:'gp180',name:'GP-180 MIDI',state:'connected',send:mocks.send,clear:mocks.clear}]]),inputs:new Map() });
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  const view=render(<PerformancePanel/>);
  fireEvent.change(screen.getByLabelText('MIDI setup preset'),{target:{value:'gp180-usb'}});
  fireEvent.click(screen.getByText('Apply MIDI setup'));
  expect(mocks.send).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Send song BPM to GP-150 / GP-180 on playback start') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('MIDI Clock (24 PPQN)') as HTMLInputElement).checked).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'gp180'}});
  view.unmount(); render(<PerformancePanel/>);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  expect((screen.getByLabelText('MIDI output') as HTMLSelectElement).value).toBe('gp180');
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.filter(c=>c[0][0]===191).map(c=>c[0])).toEqual([[191,73,0],[191,74,120]]);
  expect(mocks.send.mock.calls.some(c=>c[0][0]===248)).toBe(false);
});

it('uses the latest song tempo and channel when remote MIDI starts playback', async () => {
  const input=Object.assign(new EventTarget(),{id:'remote',name:'Footswitch',state:'connected'});
  const access=Object.assign(new EventTarget(),{outputs:new Map([['usb',{id:'usb',name:'GP-180',state:'connected',send:mocks.send,clear:mocks.clear}]]),inputs:new Map([['remote',input]])});
  vi.stubGlobal('navigator',{requestMIDIAccess:async()=>access});
  render(<PerformancePanel />);
  await act(async()=>{fireEvent.click(screen.getByText('Enable USB / system MIDI'));});
  fireEvent.change(screen.getByLabelText('MIDI output'),{target:{value:'usb'}});
  fireEvent.change(screen.getByLabelText('MIDI input'),{target:{value:'remote'}});
  fireEvent.click(screen.getByLabelText('Send cues'));
  fireEvent.click(screen.getByLabelText('Send song BPM to GP-150 / GP-180 on playback start'));
  fireEvent.change(screen.getByLabelText('BPM'),{target:{value:'141'}});
  fireEvent.change(screen.getByLabelText('GP-150 / GP-180 tempo channel'),{target:{value:'15'}});
  mocks.send.mockClear();
  await act(async()=>{input.dispatchEvent(Object.assign(new Event('midimessage'),{data:new Uint8Array([250])}));});
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([0xbe,73,1]);
  expect(mocks.send.mock.calls.map(c=>c[0])).toContainEqual([0xbe,74,13]);
});

it('applies automatic tempo after song-start patch recalls on the same MIDI timeline', async () => {
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  mocks.position=-0.02;
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100','[00:00] {midi:cc 16 0 0} {midi:pc 16 12}');
  useMidiConfiguration.getState().update({tempoOnStart:true});
  render(<PerformancePanel />);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect(mocks.send.mock.calls.map(c=>c[0])).toEqual([[0xbf,0,0],[0xcf,12],[0xbf,73,0],[0xbf,74,120]]);
  const stamps=mocks.send.mock.calls.map(c=>c[1]);
  expect(stamps[2]).toBeCloseTo(stamps[1],1);
  expect(stamps[3]).toBeCloseTo(stamps[1],1);
});

it('preserves the song key when mixer, tempo and metronome options are saved',()=>{
  const view=render(<PerformancePanel />);
  fireEvent.change(screen.getByLabelText('Song key override'),{target:{value:'D minor'}});
  fireEvent.change(screen.getByLabelText('Song volume'),{target:{value:'0.35'}});
  fireEvent.change(screen.getByLabelText('BPM'),{target:{value:'100'}});
  fireEvent.click(screen.getByLabelText('Metronome'));
  view.unmount();render(<PerformancePanel />);
  expect((screen.getByLabelText('Song key override') as HTMLSelectElement).value).toBe('D minor');
  expect((screen.getByLabelText('Song volume') as HTMLInputElement).value).toBe('0.35');
  expect((screen.getByLabelText('BPM') as HTMLInputElement).value).toBe('100');
});

it.each([false,true])('releases only note channels on pause, without sending pedal looper controls (notes=%s)',async notes=>{
  mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
  localStorage.setItem('vltn.performance.v1:clock-test.wav:44100:44100',notes?'[00:00] {midi:note 5 60 100}':'[00:00] {midi:pc 1 12}');
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  mocks.send.mockClear();
  fireEvent.click(screen.getByText('Pause'));
  const releases=mocks.send.mock.calls.map(c=>c[0]).filter(b=>b[1]===64||b[1]===123);
  if(notes) expect(releases).toEqual([[0xb4,64,0],[0xb4,123,0]]);
  else expect(releases).toEqual([]);
});

it('locks stage seeking and editors while keeping panic available',async()=>{
 mocks.bluetooth={id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mocks.send,clear:mocks.clear};
 render(<PerformancePanel/>);fireEvent.click(screen.getByLabelText('Send cues'));
 fireEvent.click(screen.getByText('Enter stage mode'));
 const stage=within(screen.getByRole('dialog',{name:'Stage mode'}));
 expect((stage.getByLabelText('Expanded song position') as HTMLInputElement).disabled).toBe(true);
 expect(stage.queryByText('Edit chords, lyrics & MIDI')).toBeNull();
 await act(async()=>{fireEvent.click(stage.getByText('Play song'));});
 expect(stage.getByText('Pause')).toBeTruthy();
 fireEvent.click(stage.getByText('Panic / stop MIDI'));
 expect(stage.getByLabelText('Performance status').textContent).toContain('Cues disarmed');
 expect(stage.getByText('Play song')).toBeTruthy();
 fireEvent.keyDown(stage.getByText('Exit stage mode'),{key:'Escape'});
 expect(screen.getByRole('dialog',{name:'Stage mode'})).toBeTruthy();
 fireEvent.click(stage.getByText('Exit stage mode'));
 expect(screen.queryByRole('dialog',{name:'Stage mode'})).toBeNull();
});

it('keeps stage mode active when a new playlist song replaces the source',()=>{
 const view=render(<PerformancePanel/>);fireEvent.click(screen.getByText('Enter stage mode'));
 mocks.source={...mocks.source,libraryId:'next-stage-song'};view.rerender(<PerformancePanel/>);
 expect(screen.getByRole('dialog',{name:'Stage mode'})).toBeTruthy();
 expect((screen.getByLabelText('Expanded song position') as HTMLInputElement).disabled).toBe(true);
});

it('saves the first downbeat per song and locks alignment during playback', async () => {
  const key='vltn.performance.v1:clock-test.wav:44100:44100';
  const view=render(<PerformancePanel/>);
  mocks.position=1.25;
  fireEvent.click(screen.getByText('Set first beat here'));
  expect(mocks.metronome.mock.lastCall?.[0]).toMatchObject({firstBeat:1.25});
  expect(JSON.parse(localStorage.getItem(key+':options')!).firstBeat).toBe(1.25);
  view.unmount();
  render(<PerformancePanel/>);
  expect((screen.getByLabelText('First beat (seconds)') as HTMLInputElement).value).toBe('1.25');
  await act(async()=>{fireEvent.click(screen.getByText('Play song'));});
  expect((screen.getByLabelText('First beat (seconds)') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByText('Set first beat here') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Pause'));
  fireEvent.click(screen.getByText('Reset first beat'));
  expect(mocks.metronome.mock.lastCall?.[0]).toMatchObject({firstBeat:0});
  expect(mocks.send).not.toHaveBeenCalled();
});
