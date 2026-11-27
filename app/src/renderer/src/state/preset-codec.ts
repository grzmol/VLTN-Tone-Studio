// The preset bytes of every family behind one seam: .prst → PresetState (toPresetState), app edits → new .prst
// (editPrst), and the effect-catalog lookups that differ by family. GP-5 family: gp5/lib (prst.mjs, the built-in
// catalog). GP-200 family: gp200/lib/prst.mjs and the catalog in use (gp200/app: built in, or the user's import); an
// fxid missing from it leaves the block without a `model` ("Unknown model"). GP-150: gp150/lib/prst.mjs and its
// built-in catalog (gp150/app).
import * as gp5 from "@/gp5/lib/prst.mjs";
import { SYNC_ON_DIVISION, clampParam, defaultParams, displayedParam, modelByFxid, modelsForBlock } from "@/gp5/lib/catalog.mjs";
import * as gp200 from "@/gp200/lib/prst.mjs";
import { BLOCKS as GP200_BLOCKS } from "@/gp200/lib/protocol.mjs";
import { defaultParams as gp200DefaultParams, type Gp200Catalog } from "@/gp200/lib/catalog.mjs";
import { gp200ModelByFxid, gp200ModelsForBlock } from "@/gp200/app/catalog-adapter";
import { useGp200Catalog } from "@/gp200/app/catalog-store";
import { guestsOf } from "@/gp200/app/guest-store";
import * as gp150 from "@/gp150/lib/prst.mjs";
import { gp150DefaultParams, gp150ModelByFxid, gp150ModelsForBlock } from "@/gp150/app/catalog-adapter";
import { profileFor, type DeviceKey } from "@shared/devices";
import { isGp5Family, presetDevice } from "./device-model";
import type { BlockCode, BlockState, ExpSettings, Gp5FamilyKey, ModelInfo, ParamInfo, PresetEdits, PresetState } from "./device-types";

const isGp150 = (device: DeviceKey) => profileFor(device).family === "gp150";

/** The GP-200 catalog the app holds now: the built-in one, or the user's import. */
const currentCatalog = (): Gp200Catalog => useGp200Catalog.getState().catalog;

const round = (v: number) => Math.round(v * 1000) / 1000;

/** GP-5 family model of `fxid`; with the block's `params`, a synced Time/Rate param shows note divisions (catalog displayedParam). */
function gp5Model(fxid: number, device: Gp5FamilyKey, params?: readonly number[]): ModelInfo | undefined {
  const m = modelByFxid(fxid, device) as ModelInfo | undefined;
  if (!m || !params || !m.params.some((p) => p.syncs !== undefined)) return m;
  return { ...m, params: m.params.map((p) => (displayedParam(fxid, p.index, params, device) as ParamInfo | undefined) ?? p) };
}

/**
 * Catalog model of `fxid` in block `block` of a `device` preset, or undefined when the catalog has none. GP-5 family:
 * with the block's `params`, a synced Time/Rate param is described as the pedal shows it. GP-200 family: block-aware
 * (one fxid can sit in PRE and DST with different defaults).
 */
export function modelFor(device: DeviceKey, block: number, fxid: number, params?: readonly number[], catalog = currentCatalog()): ModelInfo | undefined {
  if (isGp5Family(device)) return gp5Model(fxid, device, params);
  if (isGp150(device)) return gp150ModelByFxid(fxid, block);
  return gp200ModelByFxid(catalog, fxid, block);
}

/** Every model block `block` of `device` can hold, in catalog order (then the GrooveGurus mod's guests for it). */
export function modelsFor(device: DeviceKey, block: number, catalog = currentCatalog()): ModelInfo[] {
  if (isGp5Family(device)) return modelsForBlock(block, device) as ModelInfo[];
  if (isGp150(device)) return gp150ModelsForBlock(block);
  return gp200ModelsForBlock(catalog, block, guestsOf(block));
}

/** Param values the pedal loads with model `fxid` in block `block` (8 on the GP-5 family, 15 on the GP-200 family and the GP-150). */
export function defaultParamsFor(device: DeviceKey, block: number, fxid: number, catalog = currentCatalog()): number[] {
  if (isGp5Family(device)) return defaultParams(fxid, device);
  if (isGp150(device)) return gp150DefaultParams(fxid, block);
  return gp200DefaultParams(catalog, fxid, block);
}

/** `value` as param `info` holds it: the nearest of its `values` (GP-200 menus with gaps), else within range on a step. */
export function clampParamValue(info: ParamInfo, value: number): number {
  if (info.values?.length) return info.values.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best));
  return clampParam(info, value) as number;
}

/**
 * The params a GP-50 Sync toggle changes on the pedal: the toggle, and its Time/Rate, which goes to the 1/4 division
 * (on) or back to its default (off). Only for GP-5 family presets; elsewhere a Sync switch is a plain param.
 */
export function syncParams(p: PresetState, block: number, toggle: ParamInfo, on: boolean): Record<number, number> {
  const b = p.blocks[block];
  // The raw catalog param (b.model shows the synced spec), whose default the pedal restores when Sync turns off
  const target = isGp5Family(p.device) ? gp5Model(b.fxid, p.device)?.params.find((x) => x.index === toggle.syncs) : undefined;
  return { [toggle.index]: on ? 1 : 0, ...(target ? { [target.index]: on ? SYNC_ON_DIVISION : target.default } : {}) };
}

/** Why `order` can't be the chain of a `device` preset, or null. */
export function orderError(device: DeviceKey, order: readonly number[]): string | null {
  if (isGp5Family(device)) return gp5.validateOrder(order);
  const valid = isGp150(device) ? gp150.validChain(order) : gp200.validateOrder(order);
  return valid ? null : `The chain must hold each of the ${profileFor(device).blocks.length} blocks once`;
}

/** Block indices of a GP-200 CTRL mask (bits 0-10), and back. */
const blocksOfMask = (mask: number) => GP200_BLOCKS.flatMap((_, k) => (mask & (1 << k) ? [k] : []));
function maskOf(blocks: readonly number[]): number {
  if (new Set(blocks).size !== blocks.length || !blocks.every((k) => Number.isInteger(k) && k >= 0 && k < GP200_BLOCKS.length))
    throw new RangeError(`A switch takes distinct blocks 0..${GP200_BLOCKS.length - 1}, got ${JSON.stringify(blocks)}`);
  return blocks.reduce((m, k) => m | (1 << k), 0);
}

function blockStates(device: DeviceKey, blocks: readonly { enabled: boolean; fxid: number; params: number[] }[], model: (fxid: number, block: number, params: number[]) => ModelInfo | undefined): BlockState[] {
  const codes = profileFor(device).blocks as readonly BlockCode[];
  return blocks.map((b, index) => {
    const params = b.params.map(round);
    return { index, code: codes[index], enabled: b.enabled, fxid: b.fxid >>> 0, model: model(b.fxid >>> 0, index, params), params };
  });
}

function gp5State(slot: number, prst: Uint8Array): PresetState {
  const p = gp5.parsePrst(prst);
  const device: Gp5FamilyKey = p.device;
  // parsePrst is untyped JS: settings = { volume, bpm, exp? } with `exp` on GP-50 presets (prst.mjs readSettings)
  const settings: { volume: number; bpm: number; exp?: ExpSettings } = p.settings;
  return {
    device,
    slot,
    name: p.name,
    blocks: blockStates(device, p.blocks, (fxid, _, params) => gp5Model(fxid, device, params)),
    order: p.order,
    volume: settings.volume,
    bpm: settings.bpm,
    footswitches: [p.footswitches.fs1, p.footswitches.fs2],
    exp: settings.exp ?? null,
    gp200: null,
    prst,
  };
}

function gp200State(slot: number, prst: Uint8Array, device: DeviceKey, catalog: Gp200Catalog): PresetState {
  const p = gp200.parsePrst(prst).patch;
  const byIndex = <T extends { index: number }>(list: readonly T[]) => [...list].sort((a, b) => a.index - b.index);
  return {
    device,
    slot,
    name: p.name,
    blocks: blockStates(device, byIndex(p.blocks), (fxid, block) => gp200ModelByFxid(catalog, fxid, block)),
    order: p.chain.order,
    volume: p.volume,
    bpm: p.tempo,
    footswitches: byIndex(p.ctrl).map((c) => blocksOfMask(c.mask)),
    exp: null,
    gp200: {
      author: p.author,
      note: p.note,
      pan: p.pan,
      style: p.style,
      loopMode: p.loopMode,
      sendLevel: p.sendLevel,
      returnLevel: p.returnLevel,
      sendPos: p.chain.sendPos,
      returnPos: p.chain.returnPos,
      exp: [...p.exp].sort((a, b) => gp200.expIndex(a.key) - gp200.expIndex(b.key)),
      quickAccess: byIndex(p.quickAccess),
    },
    prst,
  };
}

function gp150State(slot: number, prst: Uint8Array, device: DeviceKey): PresetState {
  const p = gp150.parsePrst(prst);
  return {
    device,
    slot,
    name: p.name,
    blocks: blockStates(device, p.blocks, (fxid, block) => gp150ModelByFxid(fxid, block)),
    order: p.chain,
    volume: p.volume,
    bpm: p.tempo,
    // footswitches A and B, and C on the GP-180 (every file has room for three)
    footswitches: p.footswitches.slice(0, profileFor(device).ctrls).map(gp150.blocksOfMask),
    exp: null,
    gp200: null,
    prst,
  };
}

/**
 * The preset in `prst` as the app shows it. `device`: the pedal the bytes came from; it names the model when the file
 * doesn't (a GP-200 family file reads as "gp200" whether it came from an LT or a JR, a GP-150 family file as "gp150"
 * whether it came from a GP-150 or a GP-180), else the file decides. Throws when the bytes are no known preset.
 */
export function toPresetState(slot: number, prst: Uint8Array, device?: DeviceKey | null, catalog = currentCatalog()): PresetState {
  const sniffed = presetDevice(prst);
  const same = device && profileFor(device).family === profileFor(sniffed).family ? device : sniffed;
  if (isGp5Family(sniffed)) return gp5State(slot, prst);
  if (isGp150(sniffed)) return gp150State(slot, prst, same);
  return gp200State(slot, prst, same, catalog);
}

/** The GP-200 family's terms for `edits` (gp200/lib/prst.mjs applyPatchEdits). */
function toPatchEdits({ name, volume, bpm, order, footswitches, blocks, gp200: g = {} }: PresetEdits): gp200.PatchEdits {
  const { sendPos, returnPos, exp, quickAccess, ...info } = g;
  const chain = order !== undefined || sendPos !== undefined || returnPos !== undefined ? { order, sendPos, returnPos } : undefined;
  return {
    ...info,
    name,
    volume: volume === undefined ? undefined : Math.max(0, Math.min(100, Math.trunc(volume))),
    tempo: bpm,
    chain,
    blocks,
    exp,
    quickAccess,
    ctrl: footswitches && Object.fromEntries(footswitches.map((list, i) => [i, { mask: maskOf(list) }])),
  };
}

/** A new .prst with `edits` applied (the input is not changed). Throws RangeError for edits the preset can't hold. */
export function editPrst(prst: Uint8Array, edits: PresetEdits): Uint8Array {
  if (isGp5Family(presetDevice(prst))) {
    const { footswitches, gp200: g, ...rest } = edits;
    if (g) throw new RangeError("GP-5 family presets have no GP-200 fields");
    return gp5.applyEdits(prst, footswitches ? { ...rest, footswitches: { fs1: footswitches[0], fs2: footswitches[1] } } : rest);
  }
  if (edits.exp) throw new RangeError("GP-200 and GP-150 presets have no GP-50 EXP settings");
  if (isGp150(presetDevice(prst))) {
    const { name, volume, bpm, order, footswitches, blocks, gp200: g } = edits;
    if (g) throw new RangeError("GP-150 presets have no GP-200 fields");
    return gp150.applyPatchEdits(prst, {
      name,
      volume: volume === undefined ? undefined : Math.max(0, Math.min(100, Math.trunc(volume))),
      tempo: bpm,
      chain: order,
      blocks,
      footswitches,
    });
  }
  return gp200.applyEdits(prst, toPatchEdits(edits));
}
