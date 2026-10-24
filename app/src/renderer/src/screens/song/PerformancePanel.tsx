import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useSong } from '@/song/store';
import { StemPlayer } from '@/song/stems/player';
import { defaultMix } from '@/song/stems/mix';
import { lrcTime, parseChart, transpose } from '@/song/performance/chart';
import type { Chord } from '@/song/performance/chords';
import { host } from '@/host';
import { startMidiScheduler, prepareMidiScheduler, midiNow } from '@/song/performance/midi-scheduler-client';
import { useMidiDiagnostics } from '@/song/performance/midi-diagnostics';
import { useStagePower } from './use-stage-power';
import { MidiHealth } from './MidiHealth';
import { useBluetooth } from '@/bluetooth/connection';
import { BluetoothControls } from '@/bluetooth/BluetoothControls';
import { LyricsTrack } from './LyricsTrack';
import { SongKey } from './SongKey';
import { PerformanceReader } from './PerformanceReader';
import { ChordVoicings } from './ChordVoicings';
import { MidiCueBuilder } from './MidiCueBuilder';
import { defaultChordSource } from '@/song/performance/sources';
import { STEM_NAMES, type StemName } from '@/song/types';
import { performanceKey, readOptions } from '@/song/performance/settings';
import { useSongLibrary } from '@/song/library';
import { useMidiConfiguration, MIDI_SETUP_PRESETS, rememberedPort } from '@/song/performance/midi-configuration';

const field = 'rounded border border-seam bg-transparent p-2';
function readNumber(key: string, fallback: number, min: number, max: number): number {
  try { const raw = localStorage.getItem(key); const n = raw === null ? NaN : Number(raw); return Number.isFinite(n) && n >= min && n <= max ? n : fallback; } catch { return fallback; }
}
/** Small safe formatting subset; imported charts never become HTML. */
function chartLine(text: string, onChord: (name: string) => void) {
  return text.replace(/\[N\]/g, '—').split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[A-G][^\]]*\])/g).map((part, i) =>
    part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('*') ? <em key={i}>{part.slice(1, -1)}</em> : /^\[[A-G]/.test(part) ? <button key={i} type="button" aria-label={`Show ${part.slice(1, -1)} guitar voicings`} className="mr-1 cursor-pointer rounded font-bold text-sky-400 hover:bg-sky-400/15" onClick={() => onChord(part.slice(1, -1))}>{part.slice(1, -1)}</button> : part);
}
let sessionId = 0;
export function PerformancePanel() {
  const source = useSong(s => s.source);
  const generation = useMemo(() => ++sessionId, [source]);
  const [stage,setStage]=useState(false);
  return <PerformanceSession key={generation} stage={stage} setStage={setStage} />;
}

function PerformanceSession({stage,setStage}:{stage:boolean;setStage:(value:boolean)=>void}) {
  const bluetooth = useBluetooth(s => s.connection);
  const midiConfig = useMidiConfiguration();
  const source = useSong(s => s.source), stems = useSong(s => s.stems);
  const key = performanceKey(source);
  const library = useSongLibrary();
  const queued = !!source?.libraryId && library.queue[library.position] === source.libraryId;
  const [midiSession] = useState(() => queued && library.playlistPlaying ? library.midiSession : null);
  const options = useMemo(() => readOptions(key, { firstBeat: 0, beats: 4, shift: 0, clock: false, volume: 0.25, mix: defaultMix(), chordChoice: '' as StemName | '', lyricsLanguage: 'auto' }), [key]);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [chart, setChart] = useState(() => { try { return localStorage.getItem(key) ?? ''; } catch { return ''; } });
  const [bpm, setBpm] = useState(() => readNumber(key + ':bpm', 120, 30, 300)), [beats, setBeats] = useState(options.beats), [shift, setShift] = useState(options.shift);
  const [volume, setVolume] = useState(options.volume);
  const [firstBeat, setFirstBeat] = useState(() => typeof options.firstBeat === 'number' && Number.isFinite(options.firstBeat) && options.firstBeat >= 0 ? options.firstBeat : 0);
  const [metronome, setMetronome] = useState(() => { try { return localStorage.getItem('vltn.performance.metronome') === 'true'; } catch { return false; } });
  const [player, setPlayer] = useState<StemPlayer | null>(null), [playing, setPlaying] = useState(false), [time, setTime] = useState(0);
  const [mix, setMix] = useState(options.mix);
  const [chordChoice, setChordChoice] = useState<StemName | ''>(options.chordChoice);
  const automaticSource = useMemo(() => defaultChordSource(stems), [stems]);
  const chordSource = chordChoice && stems?.[chordChoice] ? chordChoice : automaticSource;
  const [chords, setChords] = useState<Chord[]>([]), [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<MIDIAccess | null>(midiSession?.access ?? null), [portId, setPortId] = useState(midiSession?.portId ?? (midiConfig.output?.transport === 'system' ? midiConfig.output.id : bluetooth?.state === 'connected' ? bluetooth.id : '')), [inputId, setInputId] = useState(midiSession?.inputId ?? (midiConfig.input?.transport === 'bluetooth' ? 'bluetooth-midi' : ''));
  const [midiStatus, setMidiStatus] = useState('');
  const [portsVersion, setPortsVersion] = useState(0);
  const initialOutput = portId === 'bluetooth-midi' ? bluetooth : access?.outputs.get(portId);
  const clearedOutput = useRef<typeof initialOutput>(undefined);
  // Arming belongs to this exact connection object, never just a reusable port ID.
  const [armedOutput, setArmedOutput] = useState(() => midiSession?.armed && midiSession.output === initialOutput && initialOutput?.state === 'connected' ? initialOutput : null);
  const armed = !!armedOutput && armedOutput === initialOutput && initialOutput?.state === 'connected';
  const setArmed = (value: boolean) => setArmedOutput(value ? initialOutput ?? null : null);
  const [clock, setClock] = useState(!midiConfig.tempoOnStart && options.clock === true);
  const previousBluetooth = useRef(bluetooth);
  const scheduler = useRef<ReturnType<typeof startMidiScheduler> | null>(null);
  const prepared = useRef<ReturnType<typeof prepareMidiScheduler> | null>(null), readyWorker = useRef<Worker | null>(null);
  const cursor = useRef(-0.001), activeLine = useRef<HTMLParagraphElement>(null);
  const playRequest = useRef(0), playPending = useRef(false);
  const startTempo = useRef<number[][] | null>(null);
  const startPosition = useRef<number | null>(null);
  const noteChannels = useRef(new Set<number>());
  const parsed = useMemo(() => { try { return { cues: parseChart(chart), error: '' }; } catch (e) { return { cues: [], error: String(e) }; } }, [chart]);
  const active = parsed.cues.findLastIndex(c => c.time <= time);
  const output = portId === 'bluetooth-midi' ? bluetooth : access?.outputs.get(portId);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const saveChart = (value: string) => { pause(); setChart(value); try { localStorage.setItem(key, value); } catch (e) { fail(e); } };
  const recordQueued = (bytes:number[],timestamp?:number,label='Manual / transport') => {
    const queued=midiNow(),intended=(timestamp??performance.now())+performance.timeOrigin;
    useMidiDiagnostics.getState().record({label,intended,queued,lateMs:Math.max(0,queued-intended),bytes});
  };
  const panic = () => {
    startPosition.current = null;
    scheduler.current?.stop(); scheduler.current = null;
    if (!output || clearedOutput.current === output) return;
    // Pause handlers and React lifecycle cleanup can both run for one stop.
    // A second clear would cancel the BLE note releases queued by the first.
    clearedOutput.current = output;
    try {
      (output as { clear?: () => void }).clear?.();
      if (!armed || output.state !== 'connected') { noteChannels.current.clear(); return; }
      // CC64 is sustain on synths but looper Stop on the GP-150 / GP-180. Release only
      // channels where this session actually queued note messages.
      for (const ch of noteChannels.current) for(const bytes of [[176+ch,64,0],[176+ch,123,0]]) {output.send(bytes);recordQueued(bytes,undefined,'Note cleanup');}
      noteChannels.current.clear();
      if (clock) {output.send([252]);recordQueued([252],undefined,'Transport Stop');}
    } catch (e) { useMidiDiagnostics.getState().fault(String(e));fail(e); }
  };
  const sendPerformance = (bytes: number[], timestamp?: number, label = 'Manual / transport') => {
    clearedOutput.current = undefined;
    output?.send(bytes, timestamp);
    recordQueued(bytes,timestamp,label);
    if ((bytes[0] & 240) === 144 || (bytes[0] & 240) === 128) noteChannels.current.add(bytes[0] & 15);
  };
  const pause = () => {
    const wasRunning = player?.isPlaying || playPending.current;
    playRequest.current++; player?.pause(); setPlaying(false);
    // A pedal/THRU path can echo our Stop back into the selected input.
    // Repeated Stop while already stopped must not transmit another Stop.
    if (wasRunning) panic();
    if (library.playlistPlaying) library.pausePlaylist();
  };
  const play = async () => {
    if (!player || parsed.error || playPending.current || player.isPlaying) return;
    const request = ++playRequest.current;
    playPending.current = true;
    try {
      let tempoMessages: number[][] | null = null;
      if (armed && midiConfig.tempoOnStart && output?.state === 'connected') {
        if (bpm < 40 || bpm > 300) throw new Error('GP-150 / GP-180 one-time tempo supports 40–300 BPM.');
        const tempo = Math.round(bpm), status = 0xb0 + midiConfig.tempoChannel - 1;
        tempoMessages = [[status, 73, tempo >> 7], [status, 74, tempo & 127]];
      }
      if(armed) {
        const warm=prepared.current??prepareMidiScheduler();prepared.current=warm;
        await warm.ready;
        if(request!==playRequest.current)return;
        readyWorker.current=warm.worker;prepared.current=null;
      }
      const requestedPosition = player.position >= player.duration ? 0 : Math.max(0, player.position);
      await player.play();
      if (request !== playRequest.current) { player.pause();readyWorker.current?.terminate();readyWorker.current=null; return; }
      startTempo.current = tempoMessages;
      startPosition.current = armed ? requestedPosition : null;
      cursor.current = Math.max(0, player.position) - 0.001;
      setPlaying(true);
    } catch (e) {
      readyWorker.current?.terminate();readyWorker.current=null;
      if (request === playRequest.current) {
        if(armed){useMidiDiagnostics.getState().fault(String(e));setArmed(false);if(queued)library.rememberMidi(null);}
        fail(e); if (library.playlistPlaying) library.pausePlaylist();
      }
    }
    finally { playPending.current = false; }
  };
  const seek = async (value: number) => { if(stage)return; pause(); await player?.seek(value); setTime(value); cursor.current = value - 0.001; };
  const startPlayback = () => {
    if (queued && library.queue.length > 1) {
      if (player && player.position >= player.duration) {
        if (library.position === library.queue.length - 1) void library.playPlaylist(library.queue);
        else { library.resumePlaylist(); void library.advancePlaylist(); }
        return;
      }
      library.resumePlaylist();
    }
    void play();
  };
  const skip = (offset: number) => { playRequest.current++; player?.pause(); setPlaying(false); panic(); void library.skipPlaylist(offset); };
  useEffect(() => { try { localStorage.setItem(key + ':bpm', String(bpm)); } catch (e) { fail(e); } }, [key, bpm]);
  useEffect(() => {
    if (!source) return;
    const p = new StemPlayer(stems ?? { other: source.audio });
    p.onEnded = () => {
      setPlaying(false); setTime(p.duration);
      const set = useSongLibrary.getState();
      if (set.playlistPlaying && set.queue[set.position] === source.libraryId) void set.advancePlaylist();
    };
    setPlayer(p); setTime(0); setPlaying(false); setMix(options.mix);
    return () => {
      playRequest.current++;readyWorker.current?.terminate();readyWorker.current=null; void p.dispose();
      // Leaving Performance pauses the set; replacing its source during advance does not.
      if (useSong.getState().source === source && useSongLibrary.getState().playlistPlaying) useSongLibrary.getState().pausePlaylist();
    };
  }, [source, stems]);
  useEffect(() => { player?.setMix(mix); }, [player, mix]);
  useEffect(() => {
    if (!queued || !library.playlistPlaying || library.busy || !player) return;
    if (parsed.error) { fail(parsed.error); library.pausePlaylist(); return; }
    void play();
  }, [player, queued, library.playlistPlaying, library.busy]);
  useEffect(() => {
    if (!library.playlistPlaying && player?.isPlaying && queued) { playRequest.current++; player.pause(); setPlaying(false); panic(); }
  }, [library.playlistPlaying]);
  useEffect(() => {
    if (queued && library.playlistPlaying && !library.busy) library.rememberMidi({ access, portId, inputId, armed, output });
  }, [queued, library.playlistPlaying, library.busy, access, portId, inputId, armed, output]);
  useEffect(() => { try { localStorage.setItem(key + ':options', JSON.stringify({ ...readOptions(key, {}), firstBeat, beats, shift, clock, volume, mix, chordChoice, lyricsLanguage: readOptions(key, { lyricsLanguage: 'auto' }).lyricsLanguage })); } catch (e) { fail(e); } }, [key, firstBeat, beats, shift, clock, volume, mix, chordChoice]);
  useEffect(() => {
    setChords([]); setAnalysing(false);
    const audio = chordSource ? stems?.[chordSource] : undefined;
    if (!audio) return;
    const worker = new Worker(new URL('../../song/performance/chords-worker.ts', import.meta.url), { type: 'module' });
    setAnalysing(true); setChords([]);
    worker.onmessage = e => { setAnalysing(false); if (e.data.error) setError(e.data.error); else setChords(e.data.chords); worker.terminate(); };
    worker.onerror = e => { setAnalysing(false); setError(e.message); worker.terminate(); };
    worker.postMessage(audio);
    return () => worker.terminate();
  }, [stems, chordSource]);
  useEffect(() => { player?.setMetronome({ enabled: metronome, bpm, beats, volume, firstBeat }); }, [player, metronome, bpm, beats, volume, firstBeat]);
  useEffect(() => { try { localStorage.setItem('vltn.performance.metronome', String(metronome)); } catch (e) { fail(e); } }, [metronome]);
  // Transport lifecycle is separate from tempo-dependent scheduling.
  useEffect(() => {
    if (!playing) return;
    if (armed && clock) { try { sendPerformance([(player?.position ?? 0) < 0.05 ? 250 : 251]); } catch (e) { fail(e); setArmed(false); } }
    return panic;
  }, [playing, armed, output, clock]);
  // Reader refresh is independent of the MIDI scheduler and its cursor.
  useEffect(()=>{
    if(!armed || playing || !player)return;
    try {
      const warm=prepared.current??prepareMidiScheduler();prepared.current=warm;
      return ()=>{if(prepared.current===warm){warm.cancel();prepared.current=null;}};
    }catch(e){useMidiDiagnostics.getState().fault(String(e));setArmed(false);fail(e);}
  },[armed,playing,player,output]);
  useEffect(() => {
    if (!playing || !player) return;
    const timer = setInterval(() => setTime(Math.max(0,player.position)),50);
    return () => clearInterval(timer);
  },[playing,player]);
  useEffect(() => {
    if (!playing || !player) return;
    if(!armed || output?.state!=='connected') {startPosition.current=null;startTempo.current=null;readyWorker.current?.terminate();readyWorker.current=null;return;}
    const fault = (message:string) => {
      useMidiDiagnostics.getState().fault(message);
      panic(); setArmed(false); fail(message);
      if (queued) library.rememberMidi(null);
    };
    try {
      const position = player.position;
      // Select opening cues from the requested offset, not a later React render.
      // Keep the live audio clock as the origin so overdue starts still fault.
      const cuePosition = startPosition.current ?? position;
      startPosition.current = null;
      const handle = startMidiScheduler({cues:parsed.cues,position:cuePosition,duration:player.duration,origin:midiNow()-position*1000,bpm,clock,tempo:startTempo.current},message=>{
        sendPerformance(message.bytes,message.due-performance.timeOrigin,message.label);
      },fault,readyWorker.current??undefined);
      readyWorker.current=null;
      startTempo.current = null;
      scheduler.current = handle;
      // Audio position is a checkpoint, not the scheduling clock. A missing or
      // frozen checkpoint makes the worker stop producing new batches.
      const timer = setInterval(()=>handle.sync(player.position),50);
      return () => { clearInterval(timer);handle.stop();if(scheduler.current===handle)scheduler.current=null; };
    } catch (e) { fault(e instanceof Error?e.message:String(e)); }
  },[playing,player,armed,output,clock,bpm,parsed]);
  useEffect(() => {
    if (!access) return;
    const update = () => {
      setPortsVersion(n => n + 1);
      if (portId !== 'bluetooth-midi' && armedOutput && (access.outputs.get(portId)?.state !== 'connected' || access.outputs.get(portId)!==armedOutput)) {
        useMidiDiagnostics.getState().fault('System MIDI output disconnected or replaced. Cues disarmed.');setArmed(false);
      }
    };
    access.addEventListener('statechange', update);
    return () => access.removeEventListener('statechange', update);
  }, [access, portId, armedOutput]);
  useEffect(() => {
    if (!access) return;
    if (!access.outputs.get(portId) && midiConfig.output?.transport === 'system') {
      const saved = rememberedPort([...access.outputs.values()], midiConfig.output);
      if (saved) setPortId(saved.id);
    }
    if (!inputId && midiConfig.input?.transport === 'system') {
      const saved = rememberedPort([...access.inputs.values()], midiConfig.input);
      if (saved) setInputId(saved.id);
    }
  }, [access, portsVersion]);
  useEffect(() => { if (armedOutput && armedOutput !== output) setArmed(false); }, [armedOutput, output]);
  useEffect(() => {
    if (previousBluetooth.current !== bluetooth && portId === 'bluetooth-midi') {
      if(armedOutput && armedOutput===previousBluetooth.current)useMidiDiagnostics.getState().fault('Bluetooth output disconnected or replaced. Cues disarmed.');
      setArmed(false);
    }
    previousBluetooth.current = bluetooth;
  }, [bluetooth, portId, armedOutput]);
  useEffect(() => {
    const input = access?.inputs.get(inputId);
    const receive = (data: Uint8Array) => {
      if (data[0] === 250 || data[0] === 251) startPlayback();
      if (data[0] === 252) pause();
      if ((data[0] & 240) === 176 && data[1] === 80 && data[2] >= 64) { if (player?.isPlaying) pause(); else startPlayback(); }
    };
    if (inputId === 'bluetooth-midi') return bluetooth?.subscribe(receive);
    if (!input) return;
    const handler = (e: MIDIMessageEvent) => { if (e.data) receive(e.data); };
    input.addEventListener('midimessage', handler);
    return () => input.removeEventListener('midimessage', handler);
  }, [access, inputId, player, parsed.error, armed, clock, output, bluetooth, library.playlistPlaying, library.busy, queued, bpm, midiConfig.tempoOnStart, midiConfig.tempoChannel]);
  const connectMidi = async () => {
    setMidiStatus('Opening USB / system MIDI…');
    try {
      const next = await navigator.requestMIDIAccess({ sysex: true });
      setAccess(next);
      const connectedOutputs = [...next.outputs.values()].filter(p => p.state === 'connected');
      setMidiStatus(connectedOutputs.length
        ? `USB / system MIDI ready: ${connectedOutputs.map(p => p.name || p.id).join(', ')}. Select an output and enable Send cues.`
        : 'USB / system MIDI is enabled, but no outputs are available. Connect the pedal and close other MIDI apps, then try again.');
    } catch (e) { setMidiStatus('USB / system MIDI could not be opened.'); fail(e); }
  };
  const outputs = [...(access?.outputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter(p => p.state === 'connected');
  const inputs = [...(access?.inputs.values() ?? []), ...(bluetooth ? [bluetooth] : [])].filter(p => p.state === 'connected');
  const powerError=useStagePower(stage && (playing || library.playlistPlaying));
  void portsVersion;
  return <section className="glass flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl p-5" aria-label="Performance">
    <div style={{display:stage?'none':'contents'}}>
    <Button variant="outline" onClick={()=>setStage(true)}>Enter stage mode</Button>
    {queued && <div aria-label="Playlist transport" className="flex flex-wrap items-center gap-3 rounded border border-seam p-3">
      <strong>{library.index.songs.find(s => s.id === source?.libraryId)?.title}</strong>
      <span>{library.position + 1} / {library.queue.length}</span>
      <Button variant="outline" disabled={library.busy || library.position <= 0} onClick={() => skip(-1)}>Previous song</Button>
      <Button variant="outline" disabled={library.busy || library.position + 1 >= library.queue.length} onClick={() => skip(1)}>Next song</Button>
      <Button variant="outline" onClick={() => { pause(); library.pausePlaylist(); }}>Stop playlist</Button>
      <span>{library.busy ? 'Loading next song...' : library.playlistPlaying ? 'Playlist playing' : 'Playlist paused'} · Next: {library.index.songs.find(s => s.id === library.queue[library.position + 1])?.title ?? 'End of set'}</span>
      <p className="w-full text-sm text-silkscreen-3">Songs advance automatically while the playlist is playing. MIDI output stays armed for this set while the same device remains connected.</p>
    </div>}
    {library.error && <p role="alert" className="text-red-400">{library.error}</p>}
    {queued && library.notice === 'Playlist finished.' && <p role="status">Playlist finished.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!player || !!parsed.error || library.busy} onClick={() => playing ? pause() : startPlayback()}>{playing ? 'Pause' : queued && library.queue.length > 1 ? 'Play playlist' : 'Play song'}</Button>
      <Button variant="outline" disabled={!player || stage} onClick={() => void seek(0)}>Rewind</Button>
      <span>{lrcTime(time)} / {lrcTime(player?.duration ?? 0)}</span>
      <input aria-label="Song position" type="range" min="0" max={player?.duration ?? 0} step="0.1" value={time} onChange={e => void seek(Number(e.target.value))} />
      {!source && <span>Open a song in Stems to perform.</span>}
      <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
        <label>Song BPM <input className={field + ' w-20'} aria-label="BPM" title="Set the recording’s BPM while stopped. Audio speed and cue timestamps stay unchanged." type="number" min="30" max="300" disabled={playing} value={bpm} onChange={e => setBpm(Math.max(30, Math.min(300, Number(e.target.value) || 120)))} /></label>
        <label><input type="checkbox" checked={metronome} onChange={e => setMetronome(e.target.checked)} /> Metronome</label>
        <details className="relative"><summary className="cursor-pointer">Metronome settings</summary><div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-seam bg-background p-4 shadow-xl">
          <p>Follows song playback. On/off is remembered for all songs.</p>
          <label className="block">First beat (seconds) <input aria-label="First beat (seconds)" className={field + ' w-24'} type="number" min="0" step="0.001" disabled={playing} value={firstBeat} onChange={e => { const n=Number(e.target.value); if(Number.isFinite(n) && n>=0)setFirstBeat(n); }} /></label>
          <Button variant="outline" disabled={!player || playing} onClick={()=>setFirstBeat(Math.round(Math.max(0,player?.position ?? 0)*1000)/1000)}>Set first beat here</Button>
          <Button variant="outline" disabled={playing || firstBeat===0} onClick={()=>setFirstBeat(0)}>Reset first beat</Button>
          <p className="text-xs">While stopped, seek to the first downbeat and set it here. Clicks begin there; song audio and MIDI cue timestamps stay unchanged.</p>
          <label className="block">Beats <select aria-label="Beats" className={field} value={beats} onChange={e => setBeats(Number(e.target.value))}>{[2,3,4,5,6,7].map(n => <option key={n}>{n}</option>)}</select></label>
          <label className="block">Metronome volume <input aria-label="Metronome volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
          <p>Set BPM to match the recording. Beat one is at the start of the audio; this does not detect tempo or stretch audio.</p>
        </div></details>
        <label><input type="checkbox" aria-label="MIDI Clock (24 PPQN)" disabled={midiConfig.tempoOnStart} checked={clock} onChange={e => { cursor.current = player?.position ?? time; setClock(e.target.checked); }} /> Send MIDI Clock</label>
      </div>
    </div>
    <MidiHealth cues={parsed.cues} duration={player?.duration ?? 0} clock={clock} tempoChannel={midiConfig.tempoOnStart ? midiConfig.tempoChannel : undefined} outputName={portId === 'bluetooth-midi' ? `Bluetooth ${output?.name || ''}` : output?.name || undefined} parseError={parsed.error} />
    <SongKey stems={stems} original={source?.audio} storageKey={key} shift={shift} />
    {player && <div aria-label="Performance mixer" className="flex flex-wrap gap-3">{player.names.map(name => <div key={name} className="flex items-center gap-2 rounded-lg border border-seam px-3 py-2 text-sm"><label><input type="checkbox" aria-label={`${stems ? name : 'Song'} enabled`} checked={!mix[name].mute} onChange={e => setMix(m => ({ ...m, [name]: { ...m[name], mute: !e.target.checked } }))} /> {stems ? name : 'Song'}</label><input aria-label={`${stems ? name : 'Song'} volume`} className="w-24" type="range" min="0" max="1" step="0.01" value={mix[name].volume} onChange={e => setMix(m => ({ ...m, [name]: { ...m[name], volume: Number(e.target.value) } }))} /><span className="w-9 text-right tabular-nums">{Math.round(mix[name].volume * 100)}%</span></div>)}</div>}
    </div>
    <PerformanceReader stage={stage} onExitStage={()=>setStage(false)} chart={chart} lyrics={lyrics} chords={chords} time={time} shift={shift} title={source?.name ?? 'Performance'} onEditStart={pause} onSaveChart={stage?undefined:saveChart} status={<>
      {stage && <p>Stage mode: seeking and editing locked. {queued ? `Set ${library.position+1} / ${library.queue.length}` : ''}</p>}
      {stage && (playing || library.playlistPlaying) && !powerError && host.song.stagePower && <p>Desktop sleep prevention requested during playback.</p>}
      {stage && library.error && <p role="alert">{library.error}</p>}
      {stage && library.notice && <p role="status">{library.notice}</p>}
      {stage && queued && <p>Next: {library.index.songs.find(s=>s.id===library.queue[library.position+1])?.title ?? 'End of set'}</p>}
      {stage && powerError && <p role="alert">{powerError}</p>}
      <p role="status">MIDI: {output?.state === 'connected' ? `${output.name} · ${armed ? 'Cues armed' : 'Cues disarmed'}` : 'Output disconnected · Cues disarmed'}</p>
      {(error || parsed.error) && <p role="alert" className="text-red-400">{error || parsed.error}</p>}
    </>} transport={<>
      <Button disabled={!player || !!parsed.error || library.busy} onClick={() => playing ? pause() : startPlayback()}>{playing ? 'Pause' : queued && library.queue.length > 1 ? 'Play playlist' : 'Play song'}</Button>
      <Button variant="outline" disabled={!player || stage} onClick={() => void seek(0)}>Rewind</Button>
      <input disabled={stage} aria-label="Expanded song position" className="min-w-32 flex-1" type="range" min="0" max={player?.duration ?? 0} step="0.1" value={time} onChange={e => void seek(Number(e.target.value))} />
      <Button variant="outline" onClick={()=>{pause();panic();setArmed(false);if(queued)library.rememberMidi(null);}}>Panic / stop MIDI</Button>
      {stage && <Button variant="outline" onClick={pause}>Stop playback</Button>}
      <span className="text-sm">{lrcTime(time)} / {lrcTime(player?.duration ?? 0)}</span>
    </>} />
    <div style={{display:stage?'none':'contents'}}>
    <section aria-label="Performance MIDI routing" className="space-y-3 rounded-xl border border-seam p-4"><h2 className="font-semibold">Performance MIDI controller</h2><p className="text-sm text-silkscreen-3">Computer → Bluetooth or USB MIDI → GP-150 / GP-180 → physical MIDI OUT/THRU → MIDI pedals. Choose one performance output below.</p><div className="flex flex-wrap items-center gap-3 py-3">
      <div className="w-full space-y-2 rounded border border-seam p-3" aria-label="MIDI setup presets">
        <div className="flex flex-wrap items-center gap-3"><label>Setup preset <select aria-label="MIDI setup preset" className={field} value={midiConfig.preset} onChange={e=>midiConfig.update({preset:e.target.value})}>{MIDI_SETUP_PRESETS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <Button variant="outline" onClick={()=>{
          const preset=MIDI_SETUP_PRESETS.find(p=>p.id===midiConfig.preset); if(!preset)return;
          pause(); setArmed(false); setClock(preset.clock);
          midiConfig.update({tempoOnStart:preset.tempo});
          if(preset.transport==='bluetooth') { setPortId(bluetooth?.id ?? ''); midiConfig.update({output:{id:'bluetooth-midi',name:bluetooth?.name || 'GP-150 / GP-180 BLE',transport:'bluetooth'}}); }
          else { const ports=[...(access?.outputs.values() ?? [])].filter(p=>p.state==='connected'); const saved=midiConfig.output?.transport==='system' ? rememberedPort(ports,midiConfig.output) : undefined; const chosen=saved ?? (ports.length===1?ports[0]:undefined); setPortId(chosen?.id ?? ''); if(chosen) midiConfig.update({output:{id:chosen.id,name:chosen.name || '',transport:'system'}}); else if(midiConfig.output?.transport==='bluetooth') midiConfig.update({output:null}); }
          setMidiStatus('Setup applied. Connect the matching output, check pedal settings, then enable Send cues.');
        }}>Apply MIDI setup</Button></div>
        <p className="text-sm text-silkscreen-3">{MIDI_SETUP_PRESETS.find(p=>p.id===midiConfig.preset)?.description}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm"><label><input type="checkbox" checked={midiConfig.tempoOnStart} onChange={e=>{pause();if(e.target.checked)setClock(false);midiConfig.update({tempoOnStart:e.target.checked});}} /> Send song BPM to GP-150 / GP-180 on playback start</label>
        <label>GP-150 / GP-180 tempo channel <select aria-label="GP-150 / GP-180 tempo channel" className={field} value={midiConfig.tempoChannel} onChange={e=>{pause();midiConfig.update({tempoChannel:Number(e.target.value)});}}>{Array.from({length:16},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label></div>
        <p className="text-xs text-silkscreen-3">Remembered on this computer: ports, setup, pedal channels, command choices and display preference. Cue sending is armed per session. Bluetooth still needs a manual connection. One-time GP-150 / GP-180 tempo uses the song BPM rounded to a whole number (40–300); use app clock off. Check saved chart cues for conflicting tempo commands.</p>
        {midiConfig.output && <p className="text-xs text-silkscreen-3">Remembered output: {midiConfig.output.name}. {midiConfig.output.transport==='system' ? 'Enable USB / system MIDI to restore it when available.' : 'Connect Bluetooth MIDI to use it.'}</p>}
      </div>
      <BluetoothControls onConnected={connection => { panic(); setArmed(false); setPortId(connection.id); midiConfig.update({ output: { id: connection.id, name: connection.name, transport: 'bluetooth' } }); setMidiStatus('Bluetooth output selected. Enable Send cues to send this song’s commands.'); }} />
      <Button variant="outline" onClick={() => void connectMidi()}>Enable USB / system MIDI</Button>
      <select aria-label="MIDI output" className={field} value={portId} onChange={e => { panic(); setArmed(false); setPortId(e.target.value); const port = outputs.find(p => p.id === e.target.value); midiConfig.update({ output: port ? { id: port.id, name: port.name || '', transport: port.id === 'bluetooth-midi' ? 'bluetooth' : 'system' } : null }); }}><option value="">Select output…</option>{outputs.map(p => <option value={p.id} key={p.id}>{p.id === 'bluetooth-midi' ? `Bluetooth · ${p.name}` : p.name}</option>)}</select>
      <label><input type="checkbox" disabled={output?.state !== 'connected' || !!parsed.error} checked={armed} onChange={e => { panic(); cursor.current = time; setArmed(e.target.checked); setMidiStatus(''); }} /> Send cues</label>
      <select aria-label="MIDI input" className={field} value={inputId} onChange={e => { setInputId(e.target.value); const port=inputs.find(p=>p.id===e.target.value); midiConfig.update({ input: port ? {id:port.id,name:port.name || '',transport:port.id === 'bluetooth-midi' ? 'bluetooth' : 'system'} : null }); }}><option value="">No remote input</option>{inputs.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
      <Button variant="outline" onClick={() => { panic(); setArmed(false); }}>Panic / disarm</Button>
    </div><p className="text-sm text-silkscreen-3">Input: Start/Continue/Stop or CC 80 ≥ 64 toggles playback. Configure a GP-150 / GP-180 MIDI footswitch to send CC 80. Output is opt-in for each song or playlist session. PC values are 0–127; channels are 1–16. Bluetooth uses its own connection and does not need Enable USB / system MIDI.</p>
      <p role="status" className="text-sm">{output?.state === 'connected' ? `${portId === 'bluetooth-midi' ? 'Bluetooth' : 'System MIDI'} output: ${output.name} · ${armed ? 'Song cues enabled' : 'Song cues off'}` : 'Connect Bluetooth MIDI or enable USB / system MIDI, then select an output.'}</p>
      <p className="text-sm text-silkscreen-3">For GP-150 / GP-180 tempo control, use the named Set tempo (BPM) command at song start with app MIDI Clock off, GP-150 / GP-180 clock source Internal and TRS clock output On. Continuous app clock fluctuated in real GP-180 USB and Bluetooth tests with a TimeLine and caused audible delay changes.</p>
      {midiConfig.showCommands && <MidiCueBuilder time={time} cues={parsed.cues} canTest={output?.state === 'connected' && armed} onAdd={line => saveChart([chart.trimEnd(), line].filter(Boolean).join('\n'))} onTest={bytes => { if (!armed || output?.state !== 'connected') return; sendPerformance(bytes); setMidiStatus(`MIDI command queued for ${output.name}. Check whether the downstream pedal responds.`); }} />}
      {midiStatus && <p role="status" className="text-sm">{midiStatus}</p>}
      <details><summary className="cursor-pointer text-sm">GP-150 / GP-180 routing setup</summary><p className="py-2 text-sm text-silkscreen-3">On the GP-150 / GP-180, enable Bluetooth and configure MIDI IN Source as BT Only or Mixed. Configure the pedal’s MIDI-capable EXP/FS jack for MIDI OUT and connect the correct TRS MIDI cable to the downstream pedal. Match MIDI channels on the pedals. Forwarding Bluetooth input to physical MIDI OUT depends on the GP-150 / GP-180’s routing and firmware; use the test command to verify it. A Bluetooth connection alone does not confirm delivery at MIDI OUT.</p><p className="pb-2 text-sm text-silkscreen-3">For MIDI Clock, check Clock Source and Clock Output separately. The GP-180 manual for this shared MIDI implementation says enabling Clock Output makes the pedal ignore incoming clock. Receiving the app’s clock and forwarding it to another pedal must each be verified; successful patch changes do not confirm clock routing.</p></details>
    </section>
    <div className="flex flex-wrap items-center gap-3"><h2 className="font-semibold">Lyrics & chords</h2><label>Transpose <input aria-label="Transpose semitones" className={field + ' w-20'} type="number" min="-12" max="12" value={shift} onChange={e => setShift(Math.max(-12, Math.min(12, Number(e.target.value) || 0)))} /></label>
      <label className="cursor-pointer underline">Import TXT / LRC / ChordPro<input type="file" accept=".txt,.lrc,.cho,.chordpro" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void f.text().then(saveChart).catch(fail); e.target.value = ''; }} /></label>
      <Button variant="outline" onClick={() => void host.song.saveFiles([{ name: 'performance.lrc', bytes: new TextEncoder().encode(chart) }], 'Export lyrics and MIDI cues').catch(fail)}>Export chart</Button>
    </div>
    <details><summary className="cursor-pointer font-semibold">Separate lyrics and chart editors</summary>
    <LyricsTrack audio={stems?.vocals} storageKey={key} time={time} onTextChange={setLyrics} follow={false} />
    <div className="grid gap-4 lg:grid-cols-2">
      <div><textarea aria-label="Lyrics and MIDI chart" className={field + ' min-h-64 w-full font-mono text-sm'} value={chart} onChange={e => saveChart(e.target.value)} placeholder={'[00:00.00] [C]Verse\n[00:10.00] [Am]Your lyrics {midi:pc 1 0}\n[00:20.00] [F]Chorus {midi:cc 1 64 127}'} /><p className="text-sm text-silkscreen-3">Saved locally for this audio filename and length. LRC timestamps enable scrolling and MIDI. Chords use [Am] or [C/G]. MIDI: pc, cc, note, off, sysex. Note cues need a matching off cue. Transpose changes the chart only.</p></div>
      <div className="max-h-96 overflow-auto rounded border border-seam p-4 text-2xl leading-relaxed" aria-label="Performance lyrics">{parsed.cues.length ? parsed.cues.map((cue, i) => <p ref={i === active ? activeLine : undefined} key={i} className={i === active ? 'rounded bg-white/10 font-bold' : 'text-silkscreen-3'}>{chartLine(transpose(cue.text, shift) || '♪', setSelectedChord)}</p>) : <pre className="whitespace-pre-wrap font-sans">{chartLine(transpose(chart, shift), setSelectedChord)}</pre>}</div>
    </div>
    <div><h2 className="font-semibold">Chords from stems</h2><label>Chord source <select aria-label="Chord source" className={field} value={chordChoice} onChange={e => setChordChoice(e.target.value as StemName | '')}><option value="">Automatic - {automaticSource || 'no usable stem'}</option>{STEM_NAMES.filter(name => stems?.[name]).map(name => <option key={name} value={name}>{name}</option>)}</select></label><p className="text-sm text-silkscreen-3">Guitar is preferred. If it is missing or silent, automatic selection tries piano, then other stems. Override the source if the song has no guitar but separation left sound in that stem.</p><p className="text-sm text-silkscreen-3">{analysing ? 'Analysing harmonic stem…' : stems ? `Estimated major/minor chords from ${chordSource || 'no usable stem'}. Review by ear; N means uncertain or silence.` : 'Split the song in Stems to estimate its chords automatically.'}</p>
      {!!chords.length && <><div className="my-2 max-h-32 overflow-auto font-mono">{chords.map(c => <span key={c.time} className="mr-4 inline-block">{lrcTime(c.time)} {c.name === 'N' ? '—' : <button type="button" className="cursor-pointer rounded text-sky-400 hover:bg-sky-400/15" aria-label={`Show ${transpose(`[${c.name}]`, shift).slice(1, -1)} guitar voicings`} onClick={() => setSelectedChord(transpose(`[${c.name}]`, shift).slice(1, -1))}>{transpose(`[${c.name}]`, shift)}</button>}</span>)}</div><Button variant="outline" onClick={() => void host.song.saveFiles([{ name: 'estimated-chords.lrc', bytes: new TextEncoder().encode(chords.map(c => `${lrcTime(c.time)} [${c.name}]`).join('\n')) }], 'Export estimated chords').catch(fail)}>Export chord estimates</Button><Button className="ml-2" variant="outline" onClick={() => saveChart(chart + '\n' + chords.map(c => `${lrcTime(c.time)} [${c.name}]`).join('\n'))}>Append estimates to chart</Button></>}
    </div>
    </details>
    <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} />
    </div>
  </section>;
}
