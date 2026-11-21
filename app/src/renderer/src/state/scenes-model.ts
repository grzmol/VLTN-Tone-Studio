// Scenes of the GrooveGurus mod (gp-200-re RFC-0012, RFC-0016, RFC-0021): a scene is the saved preset (the base) plus
// differences. These functions mirror the firmware's `captura` (live sound -> scene) and `compoe` (base + scene -> what
// plays) in mods/cenas/src/cenas.c, so the app builds the same scene the pedal would save with PARA.
import { SCENE_COUNT, SCENE_NAME, bitsToFloat, defaultSceneName, floatToBits, type Scene, type SceneRecord } from "@/gp200/lib/mod-service.mjs";
import type { PresetEdits, PresetState } from "./device-types";
import { editPrst, toPresetState } from "./preset-codec";
import { diffPresets, type ChangeRow } from "./unsaved-diff";

export const SCENE_LETTERS = ["A", "B", "C", "D"] as const;

/** The colour of each scene on the pedal's screen and LEDs (cenas.c COR_CENA): cyan, magenta, yellow, green. */
export const SCENE_COLORS = ["#19d3f0", "#e040d0", "#ffc400", "#26e05a"] as const;

/** Blocks that can play another effect in a scene (the reserve): PRE, AMP, CAB. */
export const RESERVE_BLOCKS: readonly number[] = [0, 3, 5];
/** On/off bits of the 11 blocks in the scene mask (the firmware's MASCARA_MODULOS). */
const BLOCK_MASK = 0x7ff;
const PARAMS = 15;

/** bit i = block i on. */
export const enabledMask = (p: PresetState): number => p.blocks.reduce((m, b, i) => (b.enabled ? m | (1 << i) : m), 0);

/** The four scenes of a record (null = not saved), whatever the record holds. */
export const scenesOf = (record: SceneRecord | null): (Scene | null)[] => Array.from({ length: SCENE_COUNT }, (_, k) => record?.scenes[k] ?? null);

/** Bits saved in a record: bit k = scene A+k. */
export const savedMask = (record: SceneRecord | null): number => scenesOf(record).reduce((m, s, k) => (s ? m | (1 << k) : m), 0);

/** A scene name the pedal can show: printable ASCII, at most 16 characters; empty = the default ("CENA B"). */
export function sceneName(name: string, k: number): string {
  const clean = Array.from(name.normalize("NFKD"))
    .filter((c) => c >= " " && c <= "~")
    .join("")
    .trim()
    .slice(0, SCENE_NAME);
  return clean || defaultSceneName(k);
}

/** Why a name can't be used as typed (it is cleaned when saved), or null. */
export function sceneNameError(name: string): string | null {
  if (name.length > SCENE_NAME) return `At most ${SCENE_NAME} characters`;
  if (Array.from(name).some((c) => c < " " || c > "~")) return "Letters without accents, digits and basic symbols only";
  return null;
}

/** The edits that turn the base into `scene` as the pedal plays it (`compoe`). */
export function sceneEdits(base: PresetState, scene: Scene): PresetEdits {
  const blocks: NonNullable<PresetEdits["blocks"]> = {};
  const block = (i: number) => (blocks[i] ??= {});
  if (scene.mask !== null)
    base.blocks.forEach((b, i) => {
      const on = (scene.mask! & (1 << i)) !== 0;
      if (on !== b.enabled) block(i).enabled = on;
    });
  for (const p of scene.params) {
    if (scene.reserve[p.block] || p.block >= base.blocks.length || p.slot >= PARAMS) continue; // the reserve's params win
    (block(p.block).params ??= {})[p.slot] = bitsToFloat(p.bits);
  }
  for (const [b, r] of Object.entries(scene.reserve)) {
    const i = Number(b);
    block(i).fxid = r.fxid;
    block(i).params = Object.fromEntries(r.params.map((bits, j) => [j, bitsToFloat(bits)]));
  }
  return {
    ...(Object.keys(blocks).length ? { blocks } : {}),
    ...(scene.volume !== null ? { volume: scene.volume } : {}),
    ...(scene.bpm !== null ? { bpm: scene.bpm } : {}),
  };
}

/** The base with `scene` applied: what the pedal plays when the scene is selected. */
export function applyScene(base: PresetState, scene: Scene): PresetState {
  return toPresetState(base.slot, editPrst(base.prst, sceneEdits(base, scene)), base.device);
}

/** What a scene changes from the base, as rows of the unsaved-changes table (Block, Parameter, Base, Scene). */
export function sceneRows(base: PresetState, scene: Scene): ChangeRow[] {
  const rows = diffPresets(base, applyScene(base, scene));
  if (scene.pre2 !== null) rows.push({ block: null, parameter: "PRE 2", saved: "", now: scene.pre2 ? "On" : "Off" });
  return rows;
}

export interface CapturedScene {
  scene: Scene;
  /** Differences a scene can't hold: they stay out of it (and the pedal plays the base's value) */
  dropped: string[];
}

/**
 * The scene that makes the base sound like `now` (`captura`): blocks on/off, volume, tempo, the parameters that differ,
 * and another effect in PRE, AMP or CAB (the reserve, with its 15 parameters). `prev` keeps its name and PRE 2 state.
 */
export function captureScene(base: PresetState, now: PresetState, k: number, prev: Scene | null = null): CapturedScene {
  const dropped: string[] = [];
  const scene: Scene = { name: prev?.name ?? defaultSceneName(k), mask: null, volume: null, bpm: null, params: [], reserve: {}, pre2: prev?.pre2 ?? null };
  const whole = new Set<number>(); // blocks whose params aren't diffed (the reserve holds them, or the block is off)
  now.blocks.forEach((b, i) => {
    const was = base.blocks[i];
    if (!was || b.fxid === was.fxid) return;
    const name = `${b.code} model`;
    if (!RESERVE_BLOCKS.includes(i)) return void dropped.push(`${name} (a scene changes the model of PRE, AMP and CAB only)`);
    whole.add(i);
    if (!b.enabled) return void dropped.push(`${name} (the block is off in this scene)`);
    scene.reserve[i] = { fxid: b.fxid, params: Array.from({ length: PARAMS }, (_, j) => floatToBits(b.params[j] ?? 0)) };
  });
  // A model a scene can't hold keeps the base's model, so its params would mean something else: leave them out.
  now.blocks.forEach((b, i) => {
    if (base.blocks[i] && b.fxid !== base.blocks[i].fxid) whole.add(i);
  });
  const mask = enabledMask(now) & BLOCK_MASK;
  if (mask !== (enabledMask(base) & BLOCK_MASK)) scene.mask = mask;
  if (now.volume !== base.volume) scene.volume = now.volume;
  if (now.bpm !== base.bpm) scene.bpm = now.bpm;
  now.blocks.forEach((b, i) => {
    const was = base.blocks[i];
    if (!was || whole.has(i)) return;
    for (let slot = 0; slot < PARAMS; slot++) {
      const bits = floatToBits(b.params[slot] ?? 0);
      if (bits !== floatToBits(was.params[slot] ?? 0)) scene.params.push({ block: i, slot, bits });
    }
  });
  if (now.order.join() !== base.order.join()) dropped.push("Chain order");
  if (now.footswitches.some((l, i) => l.join() !== base.footswitches[i]?.join())) dropped.push("CTRL assignments");
  if (now.name !== base.name) dropped.push("Preset name");
  if (JSON.stringify(now.gp200) !== JSON.stringify(base.gp200)) dropped.push("Patch settings");
  return { scene, dropped };
}

/** A scene that changes nothing: saving it removes the scene, like the pedal does. */
export const sceneIsEmpty = (s: Scene): boolean =>
  s.mask === null && s.volume === null && s.bpm === null && s.params.length === 0 && Object.keys(s.reserve).length === 0 && s.pre2 === null;

/** The record's scenes with scene `k` replaced (null removes it); an empty scene is removed. */
export function withScene(record: SceneRecord | null, k: number, scene: Scene | null): (Scene | null)[] {
  return scenesOf(record).map((s, i) => (i === k ? (scene && !sceneIsEmpty(scene) ? scene : null) : s));
}
