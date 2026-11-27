// The GP-200 catalog in use (built in, or built from the user's algorithm.xml: gp200/lib/catalog.mjs) in the app's
// ModelInfo/ParamInfo shape, so GP-200 blocks render like the GP-5 family's. Param index = the XML control ID (0..14,
// the f32[15] slot and the 0x0005 param byte); values are wire values (Combox TrueIDs included).
import { BLOCKS, type BlockName } from "@/gp200/lib/protocol.mjs";
import { defaultValue, modelByFxid, modelsForBlock, optionValues, tempoSyncBinding, type CatalogKnob, type CatalogModel, type Gp200Catalog } from "@/gp200/lib/catalog.mjs";
import type { ModGuest } from "@/gp200/lib/mod-service.mjs";
import type { ModelInfo, ParamInfo } from "@/state/device-types";

export type Gp200BlockCode = BlockName;

export interface Gp200ParamInfo extends ParamInfo {
  /** Control kind in the editor */
  kind: CatalogKnob["kind"];
  /** Allowed wire values when they are not every value of min..max (labels[value - min] still names each) */
  values?: readonly number[];
  /** The minimum shows as OFF (e.g. a Low Cut at 19 Hz) */
  offAtMin?: boolean;
}

export interface Gp200ModelInfo extends Omit<ModelInfo, "block" | "params" | "guest"> {
  block: Gp200BlockCode;
  guest?: { from: Gp200BlockCode };
  params: Gp200ParamInfo[];
  /** Cab model Auto CAB Match picks for this amp */
  cabFxid?: number;
}

/** What each block holds, as a model's category. */
export const GP200_BLOCK_TYPES: Readonly<Record<Gp200BlockCode, string>> = {
  PRE: "Pre effect",
  WAH: "Wah",
  DST: "Drive",
  AMP: "Amp",
  NR: "Noise gate",
  CAB: "Cab",
  EQ: "EQ",
  MOD: "Modulation",
  DLY: "Delay",
  RVB: "Reverb",
  VOL: "Volume",
};

/** Labels for option values: labels[value - min], gaps (non-consecutive TrueIDs) named by their value. */
function optionParam(knob: CatalogKnob): Pick<Gp200ParamInfo, "min" | "max" | "labels" | "values"> {
  const values = optionValues(knob);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const names = new Map(values.map((v, i) => [v, knob.options?.[i]?.name ?? String(v)]));
  const labels = Array.from({ length: max - min + 1 }, (_, i) => names.get(min + i) ?? String(min + i));
  const everyValue = values.length === labels.length;
  return { min, max, labels, ...(everyValue ? {} : { values }) };
}

export function toParamInfo(model: CatalogModel, knob: CatalogKnob): Gp200ParamInfo {
  const base = { name: knob.name, index: knob.id, kind: knob.kind, step: 1, default: defaultValue(knob) };
  const syncs = tempoSyncBinding(model, knob);
  const extra = {
    ...(knob.suffix ? { unit: knob.suffix } : {}),
    ...(knob.minIsOff ? { offAtMin: true } : {}),
    ...(knob.kind === "Switch" ? { toggle: true } : {}),
    ...(syncs && syncs.sync === knob ? { syncs: syncs.target.id } : {}),
  };
  if (knob.options?.length) return { ...base, ...optionParam(knob), ...extra };
  if (knob.kind === "Switch") return { ...base, min: 0, max: 1, ...extra };
  const min = knob.min ?? 0;
  return { ...base, min, max: knob.max ?? min, step: knob.step && knob.step > 0 ? knob.step : 1, ...extra };
}

const MODELS = new WeakMap<CatalogModel, Gp200ModelInfo>();

/** One catalog model as a ModelInfo (memoized per model object); params in the editor's order. */
export function toModelInfo(model: CatalogModel): Gp200ModelInfo {
  const hit = MODELS.get(model);
  if (hit) return hit;
  const block = model.module as Gp200BlockCode;
  const info: Gp200ModelInfo = {
    fxid: model.code,
    block,
    name: model.name,
    title: model.name,
    type: GP200_BLOCK_TYPES[block] ?? model.module,
    params: [...model.knobs].sort((a, b) => a.idx - b.idx).map((k) => toParamInfo(model, k)),
    ...(model.cabCode !== undefined ? { cabFxid: model.cabCode } : {}),
  };
  MODELS.set(model, info);
  return info;
}

const codeOf = (block: number | Gp200BlockCode): Gp200BlockCode => (typeof block === "number" ? (BLOCKS[block] as Gp200BlockCode) : block);

/** Blocks that take guests in the mod (gp-200-re mods/cenas/src/convidados_tab.h, CONV_DEST): PRE DST EQ MOD DLY RVB. */
export const GUEST_BLOCKS: ReadonlySet<Gp200BlockCode> = new Set<Gp200BlockCode>(["PRE", "DST", "EQ", "MOD", "DLY", "RVB"]);

const GUESTS = new WeakMap<CatalogModel, Map<Gp200BlockCode, Gp200ModelInfo>>();

/** The origin `model` as a guest of block `dest` (GrooveGurus mod): titled like the pedal ("DST Green OD"), with the
 * origin's knobs and its family as the category (the picker's tabs). Memoized per model and destination. */
export function toGuestInfo(model: CatalogModel, dest: number | Gp200BlockCode): Gp200ModelInfo {
  const block = codeOf(dest);
  const byDest = GUESTS.get(model) ?? new Map<Gp200BlockCode, Gp200ModelInfo>();
  GUESTS.set(model, byDest);
  const hit = byDest.get(block);
  if (hit) return hit;
  const origin = toModelInfo(model);
  const info: Gp200ModelInfo = { ...origin, block, title: `${origin.block} ${origin.title}`, guest: { from: origin.block } };
  byDest.set(block, info);
  return info;
}

/**
 * The model of `fxid` in `block` (index or code; some fxids sit in two blocks, e.g. boosts in PRE and DST). An fxid
 * missing from the block's list but found in another block is a guest of the GrooveGurus mod (the preset stores the
 * origin's id) in the blocks that take guests; the block's own model always wins (the mod adds no guest with a native id).
 */
export function gp200ModelByFxid(catalog: Gp200Catalog, fxid: number, block: number | Gp200BlockCode): Gp200ModelInfo | undefined {
  const model = modelByFxid(catalog, fxid, block);
  if (model) return toModelInfo(model);
  if (!GUEST_BLOCKS.has(codeOf(block))) return undefined;
  const origin = modelByFxid(catalog, fxid, undefined);
  return origin ? toGuestInfo(origin, block) : undefined;
}

/** Every model of `block` (index or code), in the editor's list order; then the mod's `guests` for it, in its order. */
export function gp200ModelsForBlock(catalog: Gp200Catalog, block: number | Gp200BlockCode, guests: readonly ModGuest[] = []): Gp200ModelInfo[] {
  const native = modelsForBlock(catalog, block).map(toModelInfo);
  const own = new Set(native.map((m) => m.fxid));
  const extra = guests.flatMap((g) => {
    const origin = own.has(g.fxid) ? undefined : modelByFxid(catalog, g.fxid, g.fromBlock);
    return origin ? [toGuestInfo(origin, block)] : [];
  });
  return [...native, ...extra];
}
