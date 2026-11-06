// The real bass chain for bass-tone.ts: the chain's blocks rendered offline in one graph (captures through the NAM engine, IRs through
// convolvers), so the NAM engine is imported when a bass tone is rendered and the song code does not load it until a Generate asks.
import type { BassChain } from "./bass-tone";

export const renderBassChain: BassChain = async (blocks, input, fast) => {
  const { renderChainOffline } = await import("@/screens/capture/audio/engine");
  return renderChainOffline(blocks, input, fast);
};
