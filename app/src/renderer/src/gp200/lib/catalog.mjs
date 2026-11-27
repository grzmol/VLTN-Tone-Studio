// GP-200 effect catalog, built at runtime from the user's own copy of Valeton's `algorithm.xml`, plus the lookups for
// any catalog of this shape (the built-in one in catalog-data.mjs too). Pure, isomorphic ESM: no Node APIs, so the app
// can build the catalog from a file the user picks.
//
// Semantics (editor 1.8.0 XML parser @0x1000d9de0):
//   Alg@Code = u32 fxid (decimal) | Alg@Index = UI list position only | control@ID = param index in f32[15] and the
//   0x0005 param byte | control@idx = UI order, `bind` refers to it | Combox value = Menu@TrueID when present, else
//   the 0-based menu position | Switch 0/1, SubType="Power" + bind = tempo sync (the bound knob becomes a note
//   division index 0-10, set to 4) | MinISOff = the minimum shows as OFF | CABCode = Auto-CAB-Match target.
//
// Catalog shape (descriptions are not kept):
//   { meta: { device, source, counts }, modules: [{ module, algs: [{ name, module, code, index, cabCode?,
//     knobs: [{ kind, name, idx, id, type, default, defaultRaw?, min?, max?, step?, suffix?, valueType?,
//     bind?, minIsOff?, subType?, options?: [{ name, value, trueId? }] }] }] }] }

import { BLOCKS, PARAM_COUNT } from "./protocol.mjs";

const CONTROL_KINDS = new Set(["Knob", "Slider", "Combox", "Switch"]);

// ------------------------------------------------------------------------------------------- XML

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeEntities = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });

/** Minimal element-tree parser for the editor's XML: elements, attributes, comments, declarations. No text nodes. */
export function parseXml(text) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  for (let m; (m = re.exec(text)); ) {
    const [, closing, open, attrText, selfClose] = m;
    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].tag === closing) stack.pop();
      else throw new Error(`XML: unexpected </${closing}>`);
      continue;
    }
    if (!open) continue;
    const attrs = {};
    for (const a of attrText.matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeEntities(a[3] ?? a[4]);
    const node = { tag: open, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].tag}> is not closed`);
  return root;
}

// ------------------------------------------------------------------------------------------- builder

const num = (s) => (s === undefined || s === "" ? undefined : Number.parseFloat(s));
const int = (s) => {
  const n = num(s);
  return n === undefined || Number.isNaN(n) ? undefined : Math.trunc(n);
};
const hex8 = (n) => `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;

function buildKnob(el) {
  const a = el.attrs;
  const k = { kind: el.tag, name: a.Name ?? "", idx: int(a.idx), id: int(a.ID), type: int(a.Type) };
  const def = num(a.default);
  k.default = Number.isNaN(def) || def === undefined ? 0 : def;
  if (a.default !== undefined && String(def) !== a.default.trim() && Number(a.default) !== def) k.defaultRaw = a.default;
  if (a.Dmin !== undefined) k.min = num(a.Dmin);
  if (a.Dmax !== undefined) k.max = num(a.Dmax);
  if (a.step !== undefined) k.step = num(a.step);
  if (a.Suffix !== undefined) k.suffix = a.Suffix;
  if (a.valueType !== undefined) k.valueType = int(a.valueType);
  if (a.bind !== undefined) k.bind = int(a.bind);
  if (a.MinISOff !== undefined) k.minIsOff = int(a.MinISOff);
  if (a.SubType !== undefined) k.subType = a.SubType;
  const menus = el.children.filter((c) => c.tag === "Menu");
  if (menus.length) {
    k.options = menus.map((m) => {
      const o = { name: m.attrs.Name ?? "", value: int(m.attrs.ID) };
      if (m.attrs.TrueID !== undefined) o.trueId = int(m.attrs.TrueID);
      return o;
    });
  }
  if (k.id === undefined || k.id < 0 || k.id >= PARAM_COUNT) throw new Error(`algorithm.xml: control "${k.name}" has param ID ${a.ID}; expected 0..${PARAM_COUNT - 1}`);
  return k;
}

function buildAlg(el, module) {
  const a = el.attrs;
  const code = Number(a.Code);
  if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) throw new Error(`algorithm.xml: model "${a.Name}" has an invalid Code ${a.Code}`);
  const alg = { name: a.Name ?? "", module: a.Module ?? module, code, index: int(a.Index) };
  if (a.CABCode !== undefined) alg.cabCode = Number(a.CABCode);
  alg.knobs = el.children.filter((c) => CONTROL_KINDS.has(c.tag)).map(buildKnob);
  return alg;
}

/**
 * algorithm.xml text -> catalog object. Throws with a plain message when the file is not a GP-200 algorithm.xml.
 * `device` labels the result ("GP-200"; the LT's algorithm_lt.xml is stale, use the GP-200 file for the LT too).
 */
export function buildCatalogFromXml(xmlText, { device = "GP-200", source = "algorithm.xml" } = {}) {
  const top = parseXml(String(xmlText)).children.find((c) => c.tag !== "#root");
  if (!top) throw new Error("algorithm.xml is empty");
  const modules = top.children
    .filter((c) => c.tag === "Catalog")
    .map((cat) => ({ module: cat.attrs.Name, algs: cat.children.filter((c) => c.tag === "Alg").map((el) => buildAlg(el, cat.attrs.Name)) }));
  if (!modules.length || !modules.some((m) => BLOCKS.includes(m.module))) throw new Error("this XML has no GP-200 effect catalogs (<Catalog Name=\"AMP\"> ...)");
  const algs = modules.flatMap((m) => m.algs);
  return {
    meta: {
      device,
      source,
      counts: {
        algEntries: algs.length,
        uniqueCodes: new Set(algs.map((x) => x.code)).size,
        perModule: Object.fromEntries(modules.map((m) => [m.module, m.algs.length])),
        controls: algs.reduce((n, x) => n + x.knobs.length, 0),
      },
    },
    modules,
  };
}

// ------------------------------------------------------------------------------------------- lookups

const INDEX = new WeakMap();
function indexOf(catalog) {
  let ix = INDEX.get(catalog);
  if (!ix) {
    const byFxid = new Map();
    for (const m of catalog.modules) for (const alg of m.algs) byFxid.set(alg.code, [...(byFxid.get(alg.code) ?? []), alg]);
    ix = { byFxid };
    INDEX.set(catalog, ix);
  }
  return ix;
}
const blockName = (block) => (typeof block === "number" ? BLOCKS[block] : String(block).toUpperCase());

/**
 * Model for an fxid. 16 fxids live in 2-3 modules (boosts/ODs in PRE and DST, Hammy, Auto Swell, Hold, Freeze):
 * pass `block` to get that module's entry; without it the first entry wins.
 */
export function modelByFxid(catalog, fxid, block) {
  const list = indexOf(catalog).byFxid.get(fxid >>> 0);
  if (!list) return undefined;
  return block === undefined ? list[0] : list.find((a) => a.module === blockName(block));
}

/** Every model of a block ("AMP" or 3), in the editor's list order. */
export function modelsForBlock(catalog, block) {
  const name = blockName(block);
  const algs = catalog.modules.find((m) => m.module === name)?.algs ?? [];
  return [...algs].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

/** Values a Combox/Switch sends on the wire (TrueID when present, else the menu position). */
export const optionValues = (knob) => (knob.options ?? []).map((o) => o.trueId ?? o.value);

/**
 * Clamp a value for the wire. Knob/Slider: into [min, max] snapped to step. Combox/Switch: the value must be one of
 * optionValues (else RangeError).
 */
export function clampParam(knob, value) {
  const v = Number(value);
  if (knob.options?.length) {
    if (!optionValues(knob).includes(v)) throw new RangeError(`${knob.name} takes ${optionValues(knob).join(", ")}, got ${value}`);
    return v;
  }
  let x = Math.min(knob.max ?? v, Math.max(knob.min ?? v, v));
  if (knob.step > 0 && knob.min !== undefined) x = knob.min + Math.round((x - knob.min) / knob.step) * knob.step;
  return Number(x.toFixed(6));
}

/** Wire value of a control's default (Combox defaults are menu positions; TrueID replaces them). */
export function defaultValue(knob) {
  const opt = knob.options?.find((o) => o.value === knob.default);
  return opt?.trueId ?? knob.default;
}

/** f32[15] the editor sends for a fresh model: declared controls at their defaults, hidden floats 0. */
export function defaultParams(catalog, fxid, block) {
  const out = new Array(PARAM_COUNT).fill(0);
  // An fxid of another block is a guest of the GrooveGurus mod: it loads with its origin's knobs
  const model = modelByFxid(catalog, fxid, block) ?? (block === undefined ? undefined : modelByFxid(catalog, fxid));
  for (const k of model?.knobs ?? []) out[k.id] = defaultValue(k);
  return out;
}

/**
 * Tempo-sync pair of a model: { sync, target } where `sync` is the Switch with SubType "Power" and `target` the
 * control it binds (by idx). Null when the control takes no part in a sync pair.
 */
export function tempoSyncBinding(model, knob) {
  const sync = knob.subType === "Power" && knob.bind !== undefined ? knob : model.knobs.find((k) => k.subType === "Power" && k.bind === knob.idx);
  if (!sync) return null;
  const target = model.knobs.find((k) => k.idx === sync.bind);
  return target ? { sync, target } : null;
}

/** Human-readable view of a parsed patch (prst.parsePatch) with this catalog. */
export function describePatch(catalog, patch) {
  return patch.blocks.map((b) => {
    const m = modelByFxid(catalog, b.fxid, b.index);
    return {
      block: b.name,
      enabled: b.enabled,
      fxid: hex8(b.fxid),
      model: m?.name ?? "unknown",
      params: Object.fromEntries((m?.knobs ?? []).map((k) => [k.name, b.params[k.id]])),
    };
  });
}
