/** One tempo conversion for the native rhythm, its preview and the receiving clock. */
export function rhythmTempo(pulseBpm: number, compound = false, rate = 1) {
  const quartersPerPulse = compound ? 1.5 : 1;
  const quarterBpm = Math.round(pulseBpm * quartersPerPulse);
  return { quarterBpm, pulseBpm: quarterBpm / quartersPerPulse, clockBpm: Math.round(quarterBpm * rate) };
}
