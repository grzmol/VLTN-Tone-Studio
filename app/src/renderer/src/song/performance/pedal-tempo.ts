/** GP-150 / GP-180 one-time tempo, sent as one high/low pair after presets have loaded. */
export function pedalTempoMessages(bpm: number, channel: number): number[][] {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 300) throw new Error("GP-150 / GP-180 one-time tempo supports 40–300 BPM.");
  const tempo = Math.round(bpm),
    status = 0xb0 + channel - 1;
  return [
    [status, 73, tempo >> 7],
    [status, 74, tempo & 127],
  ];
}
