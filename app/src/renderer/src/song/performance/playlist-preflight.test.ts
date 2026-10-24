import {expect,it} from 'vitest';
import {playlistPreflight} from './playlist-preflight';
import type {LibraryPreflightSong} from '@shared/song-library';
const config={tempoOnStart:true,tempoChannel:16,outputName:'GP-180',pedals:[{name:'TimeLine',channel:1}]};
const saved:LibraryPreflightSong={id:'one',errors:[],song:{id:'one',title:'Opening',artist:'',sourceName:'song',duration:10,audio:[{name:'source',sampleRate:44100,frames:441000,channels:1}],settings:{':bpm':'120','':'[00:01] {midi:pc 1 2}'},updated:''}};
it('preserves repeated entries and reports missing songs without changing cues',()=>{
 const before=JSON.stringify(saved);const result=playlistPreflight(['one','lost','one'],[saved],config);
 expect(result.map(r=>r.entry)).toEqual([1,2,3]);expect(result[1].errors.length).toBe(1);
 expect(result[0].warnings).toEqual([]);expect(JSON.stringify(saved)).toBe(before);
});
it('reports malformed charts, incompatible BPM and conflicting clock settings per song',()=>{
 const song={...saved.song!,settings:{':bpm':'35',':options':'{"clock":true}','':'[00:00] {midi:pc 1}'}};
 const [result]=playlistPreflight(['one'],[{...saved,song}],config);
 expect(result.errors.join(' ')).toContain('40–300');expect(result.errors.join(' ')).toContain('Chart cannot play');
 expect(result.warnings.join(' ')).toContain('alongside automatic tempo');
});
it('reuses cue/channel warnings and checks actual playback track duration',()=>{
 const song={...saved.song!,duration:999,settings:{':bpm':'120','':'[00:12] {label:TimeLine: Recall} {midi:pc 2 3}\n[00:00] {midi:note 1 60 100}'}};
 const [result]=playlistPreflight(['one'],[{...saved,song}],config);
 expect(result.warnings.join(' ')).toContain('beyond the 10.00');
 expect(result.warnings.join(' ')).toContain('no later note-off');
});

it('uses the first playback stem in player order, not the longest track or metadata duration',()=>{
 const song={...saved.song!,audio:[...saved.song!.audio,{name:'vocals',sampleRate:44100,frames:882000,channels:1},{name:'drums',sampleRate:44100,frames:220500,channels:1}],settings:{':bpm':'120','':'[00:08] {midi:pc 1 2}'}};
 const [result]=playlistPreflight(['one'],[{...saved,song}],config);
 expect(result.warnings.join(' ')).toContain('beyond the 5.00');
 expect(result.warnings.join(' ')).toContain('different lengths');
});
