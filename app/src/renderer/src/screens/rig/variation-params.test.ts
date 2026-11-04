import { describe, expect, it } from "vitest";
import type { BlockState, ModelInfo, ParamInfo } from "@/state/device-types";
import { morphed, randomized } from "./variation-params";

const param = (name: string, index: number, extra: Partial<ParamInfo> = {}): ParamInfo => ({ name, index, min: 0, max: 100, step: 1, default: 50, ...extra });
const model = { fxid: 1, params: [param("Gain", 0), param("Volume", 1), param("Bright", 2, { toggle: true, max: 1 })] } as unknown as ModelInfo;
const block = (params: number[], fxid = 1): BlockState => ({ index: 0, code: "AMP", enabled: true, fxid, model, params }) as BlockState;

describe("randomized", () => {
  it("moves knobs within the amount, leaving levels and switches alone", () => {
    expect(randomized(block([50, 70, 1]), 0.2, () => 1)).toEqual([70, 70, 1]);
    expect(randomized(block([95, 70, 0]), 0.2, () => 1)[0]).toBe(100);
  });
});

describe("morphed", () => {
  it("blends knobs and flips switches halfway", () => {
    const a = block([0, 10, 0]);
    const b = block([100, 30, 1]);
    expect(morphed(a, b, 0.25)).toEqual([25, 15, 0]);
    expect(morphed(a, b, 0.5)).toEqual([50, 20, 1]);
  });
  it("refuses different models", () => {
    expect(morphed(block([0, 0, 0]), block([0, 0, 0], 2), 0.5)).toBeNull();
  });
});
