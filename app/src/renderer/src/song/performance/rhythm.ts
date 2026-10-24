/** Audio-clock lookahead; timers only fill the schedule, not trigger the sound. */
export class Rhythm {
  private ctx = new AudioContext();
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private beat = 0;
  private disposed = false;
  bpm = 120;
  beats = 4;
  mode: 'click' | 'drums' = 'click';
  volume = 0.25;
  async start() {
    await this.ctx.resume();
    if (this.timer || this.disposed) return;
    this.next = this.ctx.currentTime + 0.04; this.beat = 0;
    this.timer = setInterval(() => {
      if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime + 0.01;
      while (this.next < this.ctx.currentTime + 0.1) {
        const down = this.beat % this.beats === 0;
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = this.mode === 'click' ? 'sine' : this.beat % 2 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(this.mode === 'click' ? down ? 1500 : 1000 : this.beat % 2 ? 220 : 110, this.next);
        if (this.mode === 'drums') osc.frequency.exponentialRampToValueAtTime(45, this.next + 0.12);
        gain.gain.setValueAtTime(this.volume * (down ? 1 : 0.65), this.next);
        gain.gain.exponentialRampToValueAtTime(0.0001, this.next + (this.mode === 'click' ? 0.04 : 0.15));
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(this.next); osc.stop(this.next + 0.16);
        osc.onended = () => { osc.disconnect(); gain.disconnect(); };
        this.next += 60 / this.bpm; this.beat++;
      }
    }, 25);
  }
  async dispose() { if (this.disposed) return; this.disposed = true; if (this.timer) clearInterval(this.timer); this.timer = null; await this.ctx.close(); }
}
