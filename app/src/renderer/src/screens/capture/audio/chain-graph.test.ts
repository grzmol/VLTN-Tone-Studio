import { describe, expect, it, vi } from "vitest";
import { connectChain, dbToGain, tailFrames, unitEnergy, type CaptureStage, type ChainContext, type GraphStage } from "./chain-graph";

/** A stub node: it records what it is connected to, and has the gain and the buffer the chain sets. */
class StubNode {
  readonly outputs: StubNode[] = [];
  connect(destination: StubNode): StubNode {
    this.outputs.push(destination);
    return destination;
  }
}
class StubGain extends StubNode {
  gain = { value: 1 };
}
class StubConvolver extends StubNode {
  normalize = true;
  buffer: StubBuffer | null = null;
}
class StubBuffer {
  readonly channels: Float32Array[];
  constructor(length: number) {
    this.channels = [new Float32Array(length)];
  }
  copyToChannel(source: Float32Array, channel: number) {
    this.channels[channel].set(source);
  }
}

const context: ChainContext = {
  createGain: () => new StubGain() as unknown as GainNode,
  createConvolver: () => new StubConvolver() as unknown as ConvolverNode,
  createBuffer: (_channels: number, length: number) => new StubBuffer(length) as unknown as AudioBuffer,
};
const asStub = (node: unknown) => node as StubNode;
const gainOf = (node: unknown) => (node as StubGain).gain.value;

/** The stub nodes reachable from `start`, depth first, in the order they are first reached, from the list of wanted nodes. */
function reachedInOrder(start: StubNode, wanted: StubNode[]): StubNode[] {
  const seen = new Set<StubNode>();
  const order: StubNode[] = [];
  const visit = (node: StubNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (wanted.includes(node)) order.push(node);
    node.outputs.forEach(visit);
  };
  visit(start);
  return order;
}

/** A capture stage at the given levels. */
const capture = (model: string, overrides: Partial<GraphStage> = {}): GraphStage =>
  ({
    type: "capture",
    model,
    inputDb: 0,
    outputDb: 0,
    mix: 1,
    ...overrides,
  }) as GraphStage;
const ir = (samples: number[], overrides: Partial<GraphStage> = {}): GraphStage =>
  ({
    type: "ir",
    ir: Float32Array.from(samples),
    inputDb: 0,
    outputDb: 0,
    mix: 1,
    ...overrides,
  }) as GraphStage;

describe("dbToGain", () => {
  it("gives unity at 0 dB and half amplitude at about -6 dB", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
    expect(dbToGain(20)).toBeCloseTo(10, 6);
  });
});

describe("unitEnergy", () => {
  it("scales an IR so its sum of squares is one, and keeps its shape", () => {
    const out = unitEnergy(Float32Array.from([3, 4, 0]));
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
    expect(out.reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(1, 6);
  });

  it("leaves a silent IR alone", () => {
    const silent = new Float32Array(4);
    expect(unitEnergy(silent)).toBe(silent);
  });
});

describe("tailFrames", () => {
  it("adds up the tails of the IRs, and has none for a chain with no IR", () => {
    expect(tailFrames([capture("a")])).toBe(0);
    expect(tailFrames([ir([1, 0, 0, 0]), capture("a"), ir([1, 0])])).toBe(3 + 1);
    expect(tailFrames([])).toBe(0);
  });
});

describe("connectChain", () => {
  it("connects the stages in the order they are given, so the chain runs compressor, amp, cab, then room", () => {
    const source = new StubNode();
    const made: StubNode[] = [];
    const stages = [capture("pedal"), capture("amp"), ir([1, 0.5]), ir([1, 0, 0, 0.2])];
    const { built } = connectChain(context, source as unknown as AudioNode, stages, 48000, () => {
      const node = new StubNode();
      made.push(node);
      return node as unknown as AudioNode;
    });
    expect(made).toHaveLength(2);
    const processors = built.map((stage) => asStub(stage.processor));
    expect(reachedInOrder(source, processors)).toEqual(processors);
  });

  it("returns the source as the output when there are no stages", () => {
    const source = new StubNode();
    const { output, built } = connectChain(context, source as unknown as AudioNode, [], 48000, () => new StubNode() as unknown as AudioNode);
    expect(output).toBe(source);
    expect(built).toEqual([]);
  });

  it("sets each stage's input drive, and its output level times the mix", () => {
    const { built } = connectChain(
      context,
      new StubNode() as unknown as AudioNode,
      [capture("amp", { inputDb: 6, outputDb: 6, mix: 0.5 })],
      48000,
      () => new StubNode() as unknown as AudioNode,
    );
    expect(gainOf(built[0].inputGain)).toBeCloseTo(dbToGain(6), 6);
    expect(gainOf(built[0].outputGain)).toBeCloseTo(dbToGain(6) * 0.5, 6);
  });

  it("crossfades each stage against its own input: the dry gain is one minus the mix", () => {
    const { built } = connectChain(
      context,
      new StubNode() as unknown as AudioNode,
      [ir([1], { mix: 0.25 }), capture("x", { mix: 0 })],
      48000,
      () => new StubNode() as unknown as AudioNode,
    );
    expect(gainOf(built[0].dryGain)).toBeCloseTo(0.75, 6);
    expect(gainOf(built[0].outputGain)).toBeCloseTo(0.25, 6);
    expect(gainOf(built[1].dryGain)).toBe(1);
    expect(gainOf(built[1].outputGain)).toBe(0);
  });

  it("builds an IR as a convolver with normalisation off, holding the IR as given", () => {
    const { built } = connectChain(context, new StubNode() as unknown as AudioNode, [ir([0.2, 0.4, 0.1])], 48000, () => new StubNode() as unknown as AudioNode);
    const convolver = asStub(built[0].processor) as StubConvolver;
    expect(convolver).toBeInstanceOf(StubConvolver);
    expect(convolver.normalize).toBe(false);
    expect(Array.from(convolver.buffer!.channels[0])).toEqual([0.2, 0.4, 0.1].map((v) => Math.fround(v)));
  });

  it("asks for each capture's node with its stage, so the caller can match the stage to its node", () => {
    const makeCapture = vi.fn((_stage: CaptureStage) => new StubNode() as unknown as AudioNode);
    const stages = [capture("first"), ir([1]), capture("second")];
    connectChain(context, new StubNode() as unknown as AudioNode, stages, 48000, makeCapture);
    expect(makeCapture.mock.calls.map(([stage]) => stage)).toEqual([stages[0], stages[2]]);
  });
});
