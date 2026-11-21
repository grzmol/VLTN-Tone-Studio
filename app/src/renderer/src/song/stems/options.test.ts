import { describe, expect, it } from "vitest";
import { findModel, SEPARATION_MODELS, STEM_NAMES, type SeparationModel } from "@shared/host/song";
import { assembleStems, orderPasses, passRows, relativeTime, SPLIT_QUALITIES } from "./options";

const model = (id: string) => findModel(id) as SeparationModel;
/** A pass result whose rows are filled with their own (pass, row) tag, so the assembly is traceable. */
const tagged = (k: number, rows: number) => Array.from({ length: rows }, (_, i) => [new Float32Array(2).fill(k * 10 + i), new Float32Array(2)]);

describe("split passes", () => {
  it("takes each fine-tuned specialist's own row only", () => {
    const ft = model("htdemucs_ft");
    expect(ft.passes.map((p) => [p.file.file, passRows(p)])).toEqual([
      ["htdemucs_ft_drums_fp16weights.onnx", [0]],
      ["htdemucs_ft_bass_fp16weights.onnx", [1]],
      ["htdemucs_ft_other_fp16weights.onnx", [2]],
      ["htdemucs_ft_vocals_fp16weights.onnx", [3]],
    ]);
    const stems = assembleStems(ft.passes, ft.passes.map((_, k) => tagged(k, 1)));
    expect(Object.keys(stems)).toEqual(["drums", "bass", "other", "vocals"]);
    expect(stems.vocals?.[0][0]).toBe(30);
  });

  it("builds Best's six stems from both models, with the rest from the six-stem one", () => {
    const best = model("hybrid");
    expect(passRows(best.passes[0])).toEqual([2, 4, 5]);
    const stems = assembleStems(best.passes, best.passes.map((p, k) => tagged(k, p.take.length)));
    expect(STEM_NAMES.map((n) => stems[n]?.[0][0])).toEqual([10, 20, 0, 30, 1, 2]);
    // Every stem comes from exactly one pass.
    expect(best.passes.flatMap((p) => p.take).sort()).toEqual([...best.stems].sort());
  });

  it("runs the pass whose file is loaded first, the rest in order", () => {
    const best = model("hybrid");
    const files = (passes: typeof best.passes) => passes.map((p) => p.file.file.replace("_fp16weights", "").replace(/\.onnx$/, ""));
    expect(files(orderPasses(best.passes, "htdemucs_ft_bass_fp16weights.onnx"))).toEqual(["htdemucs_ft_bass", "htdemucs_6s", "htdemucs_ft_drums", "htdemucs_ft_vocals"]);
    expect(files(orderPasses(best.passes, "htdemucs_ft_other_fp16weights.onnx"))).toEqual(["htdemucs_6s", "htdemucs_ft_drums", "htdemucs_ft_bass", "htdemucs_ft_vocals"]);
    expect(files(orderPasses(best.passes, null))[0]).toBe("htdemucs_6s");
  });

  it("estimates each quality's time from its chunks per second and shifts", () => {
    expect(SPLIT_QUALITIES.map((q) => [q.id, relativeTime(q)])).toEqual([
      ["fast", 1],
      ["balanced", 3],
      ["max", 6],
    ]);
  });
});

describe("hybrid model", () => {
  const best = model("hybrid");
  const stems = assembleStems(best.passes, best.passes.map((p, k) => tagged(k, p.take.length)));
  // Tone Match's guitar requirement (ToneMatchPanel): the model lists a guitar stem, and the split delivers it.
  const hasGuitar = (id: string) => model(id).stems.includes("guitar");

  it("yields all six stems, guitar and piano included, under any pass order", () => {
    expect(STEM_NAMES.every((n) => stems[n])).toBe(true);
    expect(Object.keys(stems).sort()).toEqual([...STEM_NAMES].sort());
    const order = orderPasses(best.passes, "htdemucs_ft_vocals_fp16weights.onnx");
    const reordered = assembleStems(order, order.map((p) => tagged(best.passes.indexOf(p), p.take.length)));
    expect(STEM_NAMES.map((n) => reordered[n]?.[0][0])).toEqual(STEM_NAMES.map((n) => stems[n]?.[0][0]));
  });

  it("satisfies Tone Match's guitar-stem requirement, unlike the four-stem fine-tuned model", () => {
    expect(hasGuitar("hybrid")).toBe(true);
    expect(stems.guitar).toBeDefined();
    expect(hasGuitar("htdemucs_ft")).toBe(false);
    const ft = model("htdemucs_ft");
    expect(assembleStems(ft.passes, ft.passes.map((p, k) => tagged(k, p.take.length))).guitar).toBeUndefined();
  });
});

describe("separation model registry", () => {
  it.each(SEPARATION_MODELS.map((m) => [m.id, m] as const))("%s: takes are in their file's sources, cover the stems once, file names unique", (_id, m) => {
    for (const p of m.passes) for (const t of p.take) expect(p.file.sources).toContain(t);
    expect(m.passes.flatMap((p) => p.take).sort()).toEqual([...m.stems].sort());
    const files = m.passes.map((p) => p.file.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
