#!/usr/bin/env node
// Builds src/renderer/src/gp200/lib/catalog-data.mjs, the GP-200 effect catalog Tone Studio ships, from
// kabir0st/gp200-studio (GPL-3.0) at a pinned commit: src/core/effectNames.ts (code -> name, module),
// effectParams.ts (code -> controls) and effectSyncBinds.ts (tempo-sync pairs). Output is the shape
// gp200/lib/catalog.mjs builds from algorithm.xml.
//
// What the source doesn't carry, and how it's filled:
//  - control param index (XML ID): taken to be the XML idx, as gp200-studio writes params[idx], except where the two
//    differ (PARAM_IDS below, checked against the param indexes in Valeton's GP-200 editor 1.6.0, 1.8.0 and 1.8.1);
//  - Combox TrueIDs, Suffix units, MinISOff, CABCode and the editor's list order (Index): not available; list order
//    follows effectNames.ts;
//  - fxids that sit in more than one module: effectNames.ts keeps the first module only. Boosts and overdrives listed
//    under PRE are also put under DST, the 0x04 (MOD range) models listed under PRE also under MOD, and Hammy and
//    Auto Swell also under WAH and NR (ALSO_IN below).
//
// Usage: node scripts/gp200-catalog-from-studio.mjs   (needs network; writes the file, prints the counts)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "kabir0st/gp200-studio";
const COMMIT = "7d534c290aed969a32ab5a7857dc1a5f6d817be3";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "renderer", "src", "gp200", "lib", "catalog-data.mjs");
const BLOCKS = ["PRE", "WAH", "DST", "AMP", "NR", "CAB", "EQ", "MOD", "DLY", "RVB", "VOL"];

async function source(file) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/src/core/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

const STR = String.raw`'((?:[^'\\]|\\.)*)'`;
const unquote = (s) => s.replace(/\\(.)/g, "$1").replaceAll("&amp;", "&");

/** effectNames.ts: [{ code, name, module }] in file order. */
function parseNames(ts) {
  const re = new RegExp(String.raw`^\s+(\d+): \{ name: ${STR}, module: ${STR} \}`, "gm");
  return [...ts.matchAll(re)].map((m) => ({ code: Number(m[1]), name: unquote(m[2]), module: unquote(m[3]) }));
}

/** effectParams.ts: code -> controls, in file order. */
function parseParams(ts) {
  const out = new Map();
  let current = null;
  for (const line of ts.split("\n")) {
    const head = /^ {2}(\d+): \[$/.exec(line);
    if (head) {
      current = [];
      out.set(Number(head[1]), current);
      continue;
    }
    if (!current) continue;
    if (/^ {2}\],?$/.test(line)) {
      current = null;
      continue;
    }
    const knob = new RegExp(String.raw`\{ type: 'knob', name: ${STR}, idx: (\d+), default: (-?[\d.]+), min: (-?[\d.]+), max: (-?[\d.]+), step: (-?[\d.]+) \}`).exec(line);
    if (knob) {
      current.push({ type: "knob", name: unquote(knob[1]), idx: +knob[2], default: +knob[3], min: +knob[4], max: +knob[5], step: +knob[6] });
      continue;
    }
    const menu = new RegExp(String.raw`\{ type: '(switch|combox)', name: ${STR}, idx: (\d+), default: (-?[\d.]+), options: \[(.*)\] \}`).exec(line);
    if (menu) {
      const options = [...menu[5].matchAll(new RegExp(String.raw`\{ name: ${STR}, id: (-?\d+) \}`, "g"))].map((o) => ({ name: unquote(o[1]), value: +o[2] }));
      current.push({ type: menu[1], name: unquote(menu[2]), idx: +menu[3], default: +menu[4], options });
      continue;
    }
    if (line.trim()) throw new Error(`effectParams.ts: unreadable line: ${line.trim()}`);
  }
  return out;
}

/** effectSyncBinds.ts: code -> { knob name: switch name }. */
function parseSyncBinds(ts) {
  const out = new Map();
  for (const m of ts.matchAll(/^\s+(\d+): \{(.*)\},$/gm)) {
    out.set(Number(m[1]), Object.fromEntries([...m[2].matchAll(new RegExp(String.raw`${STR}: ${STR}`, "g"))].map((p) => [unquote(p[1]), unquote(p[2])])));
  }
  return out;
}

/**
 * Controls effectParams.ts still lists but algorithm.xml has commented out (gp200-studio's generator notes Slapback's
 * disabled Sync switch, which shares idx 3 with Trail; the committed file predates that fix).
 */
const DISABLED = { 184549381: ["Sync"] };

/**
 * Param index (algorithm.xml ID) of the controls whose index differs from their UI position (idx), which is all
 * gp200-studio stores. Valeton's editor keeps these indexes unchanged from 1.6.0 to 1.8.1; presets read off a GP-200
 * agree (Ping Pong: param 2 holds the synced note division, param 1 the feedback).
 */
const PARAM_IDS = {
  0x1000023: { "Hi Vol": 4, "Low Vol": 5 }, // Pitch
  0x100004d: { "Smooth Mode": 5 }, // Harmonizer 1
  0x100004e: { "Smooth Mode": 6 }, // Harmonizer 2
  0x3000044: { "Hi-mid": 6, Treble: 8, Attack: 9 }, // Black Bass
  0x700005a: { Presence: 6 }, // EV 51
  0xb000003: { "Time A": 2, "Feedback A": 1, "Time B": 5, "Feedback B": 4 }, // Dual Echo
  0xb000004: { Time: 2, Feedback: 1 }, // Ping Pong
  0xb000005: { Trail: 4 }, // Slapback
  0xb000006: { Time: 2, Feedback: 1 }, // Sweep Echo
  0xb000009: { Time: 2, Feedback: 1 }, // Ring Echo
  0xb000014: { Time: 2, Feedback: 1 }, // Vintage Rack
  0xb000026: { Sync: 6, Trail: 7 }, // Lofi Echo
};

/** Models Valeton's editor also lists in a block gp200-studio doesn't put them in. */
const ALSO_IN = { 0x1000049: ["WAH"], 0x400002d: ["NR"] }; // Hammy, Auto Swell

const KIND = { knob: ["Knob", 1], combox: ["Combox", 2], switch: ["Switch", 3] };

function knobsOf(code, params, binds) {
  const knobs = params.map((p) => {
    const [kind, type] = KIND[p.type];
    const k = { kind, name: p.name, idx: p.idx, id: PARAM_IDS[code]?.[p.name] ?? p.idx, type, default: p.default };
    if (p.type === "knob") Object.assign(k, { min: p.min, max: p.max, step: p.step });
    else k.options = p.options;
    return k;
  });
  for (const [knobName, switchName] of Object.entries(binds.get(code) ?? {})) {
    const target = knobs.find((k) => k.name === knobName);
    const sync = knobs.find((k) => k.name === switchName && k.kind === "Switch");
    if (!target || !sync) throw new Error(`sync pair ${knobName}/${switchName} of ${code} not found`);
    Object.assign(target, { valueType: 1, bind: sync.idx });
    Object.assign(sync, { bind: target.idx, subType: "Power" });
  }
  return knobs;
}

/** Other modules an fxid also sits in (see the header). */
function alsoIn(entry) {
  if (entry.module !== "PRE") return [];
  const extra = ALSO_IN[entry.code] ?? [];
  const range = entry.code >>> 24;
  if (range === 0x03 || /Boost|^FAT BB$/.test(entry.name)) return ["DST", ...extra];
  if (range === 0x04) return ["MOD", ...extra];
  return extra;
}

const [names, params, binds] = await Promise.all([source("effectNames.ts"), source("effectParams.ts"), source("effectSyncBinds.ts")]).then(([n, p, s]) => [
  parseNames(n),
  parseParams(p),
  parseSyncBinds(s),
]);

const modules = new Map(BLOCKS.map((b) => [b, []]));
for (const entry of names) {
  const controls = params.get(entry.code)?.filter((p) => !DISABLED[entry.code]?.includes(p.name));
  if (!controls) throw new Error(`no params for ${entry.name} (${entry.code})`);
  if (new Set(controls.map((p) => p.idx)).size !== controls.length) throw new Error(`${entry.name} (${entry.code}): two controls share a UI position`);
  for (const name of Object.keys(PARAM_IDS[entry.code] ?? {}))
    if (!controls.some((p) => p.name === name)) throw new Error(`PARAM_IDS: ${entry.name} (${entry.code}) has no control ${name}`);
  for (const module of [entry.module, ...alsoIn(entry)]) {
    const algs = modules.get(module);
    if (!algs) throw new Error(`unknown module ${module} for ${entry.name}`);
    algs.push({ name: entry.name, module, code: entry.code, index: algs.length, knobs: knobsOf(entry.code, controls, binds) });
  }
}

const list = BLOCKS.map((module) => ({ module, algs: modules.get(module) })).filter((m) => m.algs.length);
const algs = list.flatMap((m) => m.algs);
const catalog = {
  meta: {
    device: "GP-200",
    source: `${REPO}@${COMMIT.slice(0, 7)}`,
    counts: {
      algEntries: algs.length,
      uniqueCodes: new Set(algs.map((a) => a.code)).size,
      perModule: Object.fromEntries(list.map((m) => [m.module, m.algs.length])),
      controls: algs.reduce((n, a) => n + a.knobs.length, 0),
    },
  },
  modules: list,
};

writeFileSync(
  OUT,
  `// Generated by scripts/gp200-catalog-from-studio.mjs. Do not edit by hand.
// GP-200 effect catalog from ${REPO} (GPL-3.0) at ${COMMIT}: src/core/effectNames.ts, effectParams.ts and
// effectSyncBinds.ts, converted to the shape gp200/lib/catalog.mjs builds from algorithm.xml. See the script for what
// the source doesn't carry (units, Combox TrueIDs, MinISOff, Auto CAB Match). Importing the user's own algorithm.xml
// replaces it.
/** @type {import("./catalog.mjs").Gp200Catalog} */
export const BUILT_IN_CATALOG = ${JSON.stringify(catalog)};
`,
);
console.log(`${OUT}: ${catalog.meta.counts.uniqueCodes} models, ${catalog.meta.counts.algEntries} entries, ${catalog.meta.counts.controls} controls`, catalog.meta.counts.perModule);
