import { describe, expect, it } from 'vitest';
import { midiCommand, parseChart, scheduleCues, transpose } from './chart';
import { detectChords } from './chords';

describe('performance charts', () => {
  it('schedules future cues once and skips cues preceding a seek', () => {
    const cues = parseChart('[00:00] {midi:pc 1 1}\n[00:01] {midi:pc 1 2}\n[00:02] {midi:pc 1 3}');
    const sent: { bytes: number[]; at: number }[] = [];
    const send = (bytes: number[], at: number) => sent.push({ bytes, at });
    scheduleCues(cues, -0.001, 0.05, 0, 100, send);
    scheduleCues(cues, 0.05, 1.05, 0.98, 1080, send);
    scheduleCues(cues, 1.05, 1.07, 1.02, 1120, send);
    expect(sent).toEqual([{ bytes: [192, 1], at: 100 }, { bytes: [192, 2], at: 1100 }]);
    sent.length = 0;
    scheduleCues(cues, 1.499, 2.05, 1.99, 2090, send);
    expect(sent).toEqual([{ bytes: [192, 3], at: 2100 }]);
  });
  it('sorts repeated LRC timestamps and attaches explicit MIDI commands', () => {
    const chart = parseChart('[00:10.5][00:02.00] [Am]Verse {midi:pc 2 127}\n[00:00] Intro {midi:cc 1 80 127}');
    expect(chart.map(c => c.time)).toEqual([0, 2, 10.5]);
    expect(chart[1]).toEqual({ time: 2, text: '[Am]Verse', messages: [[193,127]] });
  });
  it('validates channels, wire values, message lengths and SysEx framing', () => {
    for (const cmd of ['pc 0 1', 'cc 17 80 127', 'pc 1 128', 'note 1 60', 'off 1 -1 0', 'sysex F0 80 F7', 'sysex F0 01', 'sysex F0 ZZ F7']) expect(() => midiCommand(cmd)).toThrow();
    expect(midiCommand('sysex F0 01 7f F7')).toEqual([240,1,127,247]);
    expect(midiCommand('note 16 60 100')).toEqual([159,60,100]);
    expect(() => parseChart('Untimed {midi:pc 1 1}')).toThrow();
  });
  it('transposes roots and slash bass while preserving suffixes and lyric prose', () => {
    expect(transpose('[Bbmaj7/D] Hello [Am] [F#sus4] [00:10]', 2)).toBe('[Cmaj7/E] Hello [Bm] [G#sus4] [00:10]');
    expect(transpose('[C]', -1)).toBe('[B]');
  });
});
describe('harmonic chord estimates', () => {
  it('marks silence unknown and estimates a synthetic C major triad', () => {
    const sampleRate = 44100;
    expect(detectChords({ sampleRate, channels: [new Float32Array(sampleRate)] })[0].name).toBe('N');
    const audio = new Float32Array(sampleRate);
    for (let i = 0; i < audio.length; i++) for (const hz of [261.6256, 329.6276, 391.9954]) audio[i] += 0.2 * Math.sin(2 * Math.PI * hz * i / sampleRate);
    expect(detectChords({ sampleRate, channels: [audio] })[0].name).toBe('C');
  });
});

it('rejects incomplete or empty MIDI tokens instead of silently ignoring them',()=>{
  for(const token of ['{midi:pc 1 2','{midi:}']) expect(()=>parseChart('[00:00] '+token)).toThrow(/MIDI commands/);
});
