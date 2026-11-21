// The real chain for part-tone.ts: the chain's blocks rendered offline in one graph (captures through the NAM engine, IRs through
// convolvers), so the NAM engine is imported when a part tone is rendered and the song code does not load it until a Generate asks. It is
// mono inside: a stereo part's mid signal, or one channel, is what it gets (the stereo handling is in part-tone.ts).
import type { PartChain } from "./part-tone";

export const renderPartChain: PartChain = async (blocks, input, fast) => {
  const { renderChainOffline } = await import("@/screens/capture/audio/engine");
  return renderChainOffline(blocks, input, fast);
};

/** The bass's name for the same chain. */
export const renderBassChain = renderPartChain;
