import type { LibraryPreflightSong } from '@shared/song-library';
import { STEM_NAMES } from '@shared/host/song';
import { parseChart } from './chart';
import { midiPreflight, type PreflightOptions } from './midi-preflight';
export interface PlaylistCheck { entry:number; id:string; title:string; errors:string[]; warnings:string[] }
export function playlistPreflight(ids:string[], songs:LibraryPreflightSong[], config:{tempoOnStart:boolean;tempoChannel:number;outputName?:string;pedals:PreflightOptions['pedals']}):PlaylistCheck[] {
  const byId=new Map(songs.map(s=>[s.id,s]));
  return ids.map((id,entry)=>{
    const saved=byId.get(id),song=saved?.song;
    const errors=[...(saved?.errors??['Song was not checked.'])],warnings:string[]=[];
    if(song){
      if(config.tempoOnStart&&!config.outputName)warnings.push('Automatic tempo is enabled but no MIDI output preference is saved. Select and arm the intended output before performing.');
      let options:{clock?:boolean}={};
      try {const value=JSON.parse(song.settings[':options']||'{}');if(!value || typeof value!=='object'||Array.isArray(value))throw new Error();options=value;}catch{errors.push('Saved performance options are invalid.');}
      const raw=song.settings[':bpm'];const bpm=raw?Number(raw):120;
      if(!raw)warnings.push('No saved BPM; playback defaults to 120. Confirm the recording tempo.');
      if(!Number.isFinite(bpm)||bpm<30||bpm>300)errors.push('Saved BPM must be between 30 and 300.');
      else if(config.tempoOnStart && bpm<40)errors.push('Automatic pedal tempo requires 40–300 BPM.');
      if(config.tempoOnStart && options.clock)warnings.push('Saved continuous clock is enabled alongside automatic tempo. Disable continuous clock for this setup.');
      const stems=STEM_NAMES.flatMap(name=>song.audio.filter(a=>a.name===name));
      const tracks=stems.length?stems:song.audio;
      const duration=tracks[0].frames/tracks[0].sampleRate;
      if(Math.max(...tracks.map(a=>a.frames/a.sampleRate))-Math.min(...tracks.map(a=>a.frames/a.sampleRate))>.05)warnings.push('Playback tracks have different lengths; check the end of this song.');
      try {
        const report=midiPreflight(parseChart(song.settings['']||''),{duration,clock:options.clock===true,tempoChannel:config.tempoOnStart?config.tempoChannel:undefined,outputName:config.outputName,pedals:config.pedals});
        warnings.push(...report.issues.map(i=>i.text));
      }catch(error){errors.push(`Chart cannot play: ${error instanceof Error?error.message:String(error)}`);}
    }
    return {entry:entry+1,id,title:song?.title??'Missing song',errors,warnings};
  });
}
