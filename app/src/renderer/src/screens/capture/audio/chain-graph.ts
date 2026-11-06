// The graph of a bass tone chain (spec 89): the stages in order, each one an input gain, a capture or a convolver, an output gain, and a
// mix against the stage's own input. The helpers are pure, and the builder takes only the few nodes it needs, so the tests run it on stub
// nodes without WebAudio.

/** Gain for a level in dB. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * A cab IR scaled to unit energy (its sum of squares is 1). For noise-like input the convolved RMS is then the input's RMS, so a cab IR
 * changes the tone and not the level. The whole chain is level-matched at the end anyway, so this only sets the level each stage starts
 * from. A silent IR is returned as it is.
 */
export function unitEnergy(ir: Float32Array): Float32Array {
  let energy = 0;
  for (let i = 0; i < ir.length; i++) energy += ir[i] * ir[i];
  if (energy <= 0) return ir;
  const scale = 1 / Math.sqrt(energy);
  const out = new Float32Array(ir.length);
  for (let i = 0; i < ir.length; i++) out[i] = ir[i] * scale;
  return out;
}

/** The blocks every stage has: drive, output level in dB, and the mix (0 dry, 1 all processed). */
export interface GraphBlock {
  inputDb: number;
  outputDb: number;
  mix: number;
}

/** A NAM capture stage: the prepared model text, played by a NAM node. */
export type CaptureStage = GraphBlock & { type: "capture"; model: string };
/** A convolution stage: the impulse response at the chain rate, already scaled as it should play. */
export type IrStage = GraphBlock & { type: "ir"; ir: Float32Array };
export type GraphStage = CaptureStage | IrStage;

/**
 * How many frames the chain's output runs past its input: the IRs' tails, added up. A stage after an IR can extend the sound further, so
 * the sum is the most the output can need. Zero for a chain with no IR.
 */
export function tailFrames(stages: readonly GraphStage[]): number {
  let tail = 0;
  for (const stage of stages) if (stage.type === "ir") tail += Math.max(0, stage.ir.length - 1);
  return tail;
}

/** The nodes the chain uses from a context. A BaseAudioContext has all of them. */
export interface ChainContext {
  createGain(): GainNode;
  createConvolver(): ConvolverNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
}

/** The nodes one stage was built from, for the tests and for checking the levels. */
export interface BuiltStage {
  stage: GraphStage;
  inputGain: GainNode;
  processor: AudioNode;
  outputGain: GainNode;
  dryGain: GainNode;
}

/**
 * Wires the stages after `source`, in order, and returns the last node and what each stage was built from. Each stage is:
 * source → input gain → processor (the capture's node, or a convolver with normalize off) → output gain × mix → sum,
 * with the stage's input → dry gain (1 − mix) → sum. So at mix 0 the stage passes its input, and at mix 1 it is all processed.
 * `makeCapture` supplies the node for each capture stage.
 */
export function connectChain(
  ctx: ChainContext,
  source: AudioNode,
  stages: readonly GraphStage[],
  sampleRate: number,
  makeCapture: (stage: CaptureStage) => AudioNode,
): { output: AudioNode; built: BuiltStage[] } {
  const built: BuiltStage[] = [];
  let last: AudioNode = source;
  for (const stage of stages) {
    const input = ctx.createGain();
    last.connect(input);
    const inputGain = ctx.createGain();
    inputGain.gain.value = dbToGain(stage.inputDb);
    input.connect(inputGain);
    let processor: AudioNode;
    if (stage.type === "capture") {
      processor = makeCapture(stage);
    } else {
      const convolver = ctx.createConvolver();
      // The convolver's own normalisation would scale the IR by about -29 dB for a unit impulse. The IR is passed as it should play.
      convolver.normalize = false;
      const buffer = ctx.createBuffer(1, stage.ir.length, sampleRate);
      buffer.copyToChannel(stage.ir as Float32Array<ArrayBuffer>, 0);
      convolver.buffer = buffer;
      processor = convolver;
    }
    inputGain.connect(processor);
    const outputGain = ctx.createGain();
    outputGain.gain.value = dbToGain(stage.outputDb) * stage.mix;
    processor.connect(outputGain);
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - stage.mix;
    input.connect(dryGain);
    const sum = ctx.createGain();
    outputGain.connect(sum);
    dryGain.connect(sum);
    built.push({ stage, inputGain, processor, outputGain, dryGain });
    last = sum;
  }
  return { output: last, built };
}
