import { afterEach, expect, it, vi } from 'vitest';
import { StemPlayer } from './player';

class Context {
  static instances: Context[] = [];
  currentTime = 10;
  destination = {};
  oscillators: ReturnType<Context['node']>[] = [];
  sources: ReturnType<Context['node']>[] = [];
  constructor() { Context.instances.push(this); }
  async resume() {}
  async close() {}
  node() { return { connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as null | (() => void), frequency: {setValueAtTime:vi.fn()}, gain: {setValueAtTime:vi.fn(), exponentialRampToValueAtTime:vi.fn(), setTargetAtTime:vi.fn()}, buffer: null, fftSize: 2048 }; }
  createBuffer() { return {copyToChannel:vi.fn()}; }
  createGain() { return this.node(); }
  createAnalyser() { return this.node(); }
  createBufferSource() { const n=this.node(); this.sources.push(n); return n; }
  createOscillator() { const n=this.node(); this.oscillators.push(n); return n; }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Context.instances=[]; });
it('anchors clicks and stems to one audio clock, preserves bar phase on seek, and cancels queued clicks on pause', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext', Context);
  const player = new StemPlayer({other:{sampleRate:100,channels:[new Float32Array(1000)]}});
  player.setMetronome({enabled:true,bpm:120,beats:4,volume:0.25});
  await player.play();
  const ctx=Context.instances[0];
  expect(Context.instances).toHaveLength(1);
  expect(ctx.sources[0].start.mock.calls[0]).toEqual([10.02,0]);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(10.02);
  player.pause();
  expect(ctx.oscillators[0].stop).toHaveBeenLastCalledWith();
  const count=ctx.oscillators.length;
  ctx.currentTime=11; vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(count);
  await player.seek(3.75); await player.play();
  ctx.currentTime=11.2; vi.advanceTimersByTime(25);
  const next=ctx.oscillators.at(-1)!;
  // Beat 8 is at song second 4, a downbeat, not a new bar at the seek point.
  expect(next.start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(next.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  player.setMetronome({enabled:false,bpm:120,beats:4,volume:0.25});
  const muted=ctx.oscillators.length;
  ctx.currentTime=12; vi.advanceTimersByTime(1000);
  expect(ctx.oscillators).toHaveLength(muted);
  expect(player.isPlaying).toBe(true);
  await player.dispose();
});

it('can resume after pausing during the audio start pre-roll', async () => {
  vi.stubGlobal('AudioContext', Context);
  const player = new StemPlayer({other:{sampleRate:100,channels:[new Float32Array(1000)]}});
  await player.play();
  expect(player.position).toBeLessThan(0);
  player.pause();
  expect(player.position).toBe(0);
  await player.play();
  expect(Context.instances[0].sources.at(-1)!.start).toHaveBeenCalledWith(10.02,0);
  await player.dispose();
});

it('anchors the first downbeat after an intro and preserves its phase through pause and seek', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext', Context);
  const player = new StemPlayer({other:{sampleRate:100,channels:[new Float32Array(1000)]}});
  player.setMetronome({enabled:true,bpm:120,beats:4,volume:0.25,firstBeat:1.25});
  await player.play();
  const ctx=Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime=11.2; vi.advanceTimersByTime(25);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(11.27);
  expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  ctx.currentTime=11.4; player.pause();
  const count=ctx.oscillators.length;
  ctx.currentTime=12; await player.play();
  expect(ctx.oscillators).toHaveLength(count);
  ctx.currentTime=12.35; vi.advanceTimersByTime(25);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.39);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1000);
  await player.seek(3.2);
  expect(ctx.oscillators.at(-1)!.start.mock.calls[0][0]).toBeCloseTo(12.42);
  expect(ctx.oscillators.at(-1)!.frequency.setValueAtTime.mock.calls[0][0]).toBe(1500);
  await player.dispose();
});

it('does not replay the beat just before a seek or burst missed clicks after a stall', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext', Context);
  const player = new StemPlayer({other:{sampleRate:100,channels:[new Float32Array(1000)]}});
  player.setMetronome({enabled:true,bpm:120,beats:4,volume:0.25,firstBeat:1.25});
  await player.seek(1.26); await player.play();
  const ctx=Context.instances[0];
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime=13.2; vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(0);
  ctx.currentTime=13.45; vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(1);
  expect(ctx.oscillators[0].start.mock.calls[0][0]).toBeCloseTo(13.51);
  await player.seek(9.9);
  const count=ctx.oscillators.length;
  ctx.currentTime=14; vi.advanceTimersByTime(25);
  expect(ctx.oscillators).toHaveLength(count);
  await player.dispose();
});
