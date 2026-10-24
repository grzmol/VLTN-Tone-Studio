import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyLibrary, type LibrarySong } from '@shared/song-library';
import { useSong } from '@/song/store';
import { useSongLibrary } from '@/song/library';
import { useBluetooth, type BleMidiConnection } from '@/bluetooth/connection';
import { PerformancePanel } from './PerformancePanel';
import type { SchedulerConfig, ScheduledMessage } from '@/song/performance/midi-scheduler';
// jsdom has no browser Worker; exercise the production schedule through the bridge mock.
vi.mock('@/song/performance/midi-scheduler-client',async()=>{
  const {MidiSchedule}=await import('@/song/performance/midi-scheduler');
  const now=()=>performance.timeOrigin+performance.now();
  return {midiNow:now,prepareMidiScheduler:()=>({worker:{terminate:vi.fn()},ready:Promise.resolve(),cancel:vi.fn()}),startMidiScheduler:(config:SchedulerConfig,send:(message:ScheduledMessage)=>void,fault:(message:string)=>void)=>{
    const schedule=new MidiSchedule(config,now(),reply=>{if(reply.type==='fault')fault(reply.error);else if(reply.type==='batch')reply.messages.forEach(send);});
    schedule.tick(now());const timer=setInterval(()=>schedule.tick(now()),20);
    return {stop(){schedule.stop();clearInterval(timer);},sync(position:number){schedule.sync(position,now(),now());}};
  }};
});


const mock=vi.hoisted(()=>({audio:vi.fn(),index:vi.fn(),settings:vi.fn(),send:vi.fn(),clear:vi.fn(),players:[] as {isPlaying:boolean;position:number;duration:number;onEnded:(()=>void)|null;end():void}[]}));
vi.mock('@/host',()=>({host:{song:{library:{index:mock.index,audio:mock.audio,settings:mock.settings}}}}));
vi.mock('@/song/stems/engine',()=>({separateStems:vi.fn()}));
vi.mock('./LyricsTrack',()=>({LyricsTrack:()=>null}));
vi.mock('@/bluetooth/BluetoothControls',()=>({BluetoothControls:()=>null}));
vi.mock('@/song/stems/player',()=>({StemPlayer:class {
  names=['other']; duration=10; position=0; isPlaying=false; onEnded:(()=>void)|null=null;
  constructor(){mock.players.push(this);}
  async play(){this.isPlaying=true;} pause(){this.isPlaying=false;}
  async seek(value:number){this.position=value;}
  setMix(){} setMetronome(){} async dispose(){this.isPlaying=false;this.onEnded=null;}
  end(){this.isPlaying=false;this.position=this.duration;this.onEnded?.();}
}}));
const song=(id:string,bpm:number,pc:number):LibrarySong=>({id,title:id,artist:'',sourceName:id+'.wav',duration:10,audio:[{name:'source',sampleRate:10,frames:100,channels:1}],settings:{':bpm':String(bpm),'':`[00:00] {midi:pc 1 ${pc}}`,':options':JSON.stringify({clock:bpm===95})},updated:''});
const first=song('first',95,12), second=song('second',130,22);
beforeEach(()=>{
  vi.clearAllMocks();localStorage.clear();mock.players=[];
  mock.index.mockResolvedValue({...emptyLibrary(),songs:[first,second]});
  mock.audio.mockResolvedValue(new Uint8Array(new Float32Array(100).buffer));
  mock.settings.mockResolvedValue(undefined);
  useSong.setState({source:null,stems:null,status:{kind:'idle'}});
  useSongLibrary.setState({index:emptyLibrary(),busy:false,error:'',notice:'',queue:[],position:-1,playlistPlaying:false,midiSession:null});
  useBluetooth.setState({connection:{id:'bluetooth-midi',name:'GP-180 BLE',state:'connected',send:mock.send,clear:mock.clear} as unknown as BleMidiConnection});
  HTMLElement.prototype.scrollTo=vi.fn();
});
afterEach(()=>{cleanup();useBluetooth.setState({connection:null});});

it('automatically plays the next song with its BPM and armed MIDI, then finishes the set',async()=>{
  await useSongLibrary.getState().load(first.id,[first.id,second.id]);
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play playlist'));});
  await waitFor(()=>expect(mock.send.mock.calls.some(c=>c[0][0]===192&&c[0][1]===12)).toBe(true));
  expect(mock.players.at(-1)?.isPlaying).toBe(true);
  await act(async()=>{mock.players.at(-1)!.end();});
  await waitFor(()=>expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(()=>expect(mock.players.at(-1)?.isPlaying).toBe(true));
  expect((screen.getByLabelText('BPM') as HTMLInputElement).value).toBe('130');
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText('MIDI Clock (24 PPQN)') as HTMLInputElement).checked).toBe(false);
  await waitFor(()=>expect(mock.send.mock.calls.some(c=>c[0][0]===192&&c[0][1]===22)).toBe(true));
  await act(async()=>{mock.players.at(-1)!.end();});
  await waitFor(()=>expect(useSongLibrary.getState().playlistPlaying).toBe(false));
  expect(screen.getByText('Playlist finished.')).toBeTruthy();
  expect(useSongLibrary.getState().position).toBe(1);
});

it('pauses and skips without automatically starting the next song, then resumes the set',async()=>{
  await useSongLibrary.getState().load(first.id,[first.id,second.id]);
  render(<PerformancePanel/>);
  await act(async()=>{fireEvent.click(screen.getByText('Play playlist'));});
  fireEvent.click(screen.getByText('Pause'));
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByText('Next song'));});
  await waitFor(()=>expect(useSong.getState().source?.libraryId).toBe(second.id));
  expect(mock.players.at(-1)?.isPlaying).toBe(false);
  await act(async()=>{fireEvent.click(screen.getByText('Play playlist'));});
  expect(mock.players.at(-1)?.isPlaying).toBe(true);
});

it('does not carry MIDI arming onto a replacement Bluetooth connection',async()=>{
  await useSongLibrary.getState().load(first.id,[first.id,second.id]);
  render(<PerformancePanel/>);
  fireEvent.click(screen.getByLabelText('Send cues'));
  await act(async()=>{fireEvent.click(screen.getByText('Play playlist'));});
  await act(async()=>{
    useBluetooth.setState({connection:{id:'bluetooth-midi',name:'Replacement BLE',state:'connected',send:mock.send,clear:mock.clear} as unknown as BleMidiConnection});
    mock.players.at(-1)!.end();
  });
  await waitFor(()=>expect(useSong.getState().source?.libraryId).toBe(second.id));
  expect((screen.getByLabelText('Send cues') as HTMLInputElement).checked).toBe(false);
});

it('pauses the playlist when leaving Performance',async()=>{
  await useSongLibrary.getState().playPlaylist([first.id,second.id]);
  const view=render(<PerformancePanel/>);
  await waitFor(()=>expect(mock.players.at(-1)?.isPlaying).toBe(true));
  view.unmount();
  expect(useSongLibrary.getState().playlistPlaying).toBe(false);
  expect(mock.players.at(-1)?.isPlaying).toBe(false);
});

it('resumes the next song after stopping a transition instead of replaying the finished song',async()=>{
  await useSongLibrary.getState().playPlaylist([first.id,second.id]);
  render(<PerformancePanel/>);
  await waitFor(()=>expect(mock.players.at(-1)?.isPlaying).toBe(true));
  let resolve!: (value:Uint8Array)=>void;
  mock.audio.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
  await act(async()=>{mock.players.at(-1)!.end();});
  await waitFor(()=>expect(resolve).toBeTypeOf('function'));
  fireEvent.click(screen.getByText('Stop playlist'));
  await act(async()=>{resolve(new Uint8Array(new Float32Array(100).buffer));});
  await waitFor(()=>expect(useSongLibrary.getState().busy).toBe(false));
  expect(useSong.getState().source?.libraryId).toBe(first.id);
  await act(async()=>{fireEvent.click(screen.getByText('Play playlist'));});
  await waitFor(()=>expect(useSong.getState().source?.libraryId).toBe(second.id));
  await waitFor(()=>expect(mock.players.at(-1)?.isPlaying).toBe(true));
});
