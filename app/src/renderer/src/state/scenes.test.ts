// Scenes of the GrooveGurus mod on the simulated GP-200: the firmware's capture/compose rules (scenes-model.ts) and
// the scenes store end to end (read, play a scene to edit it, save, rename, delete, follow the pedal).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decodeSceneRecord, floatToBits } from "@/gp200/lib/mod-service.mjs";
import { getDriver, useDevice } from "./device";
import type { Gp200Driver } from "./driver/gp200-driver";
import { defaultParamsFor, editPrst, modelsFor, toPresetState } from "./preset-codec";
import { useModGuests } from "@/gp200/app/guest-store";
import { applyScene, captureScene, sceneName, sceneNameError, sceneRows, withScene } from "./scenes-model";
import { useScenes } from "./scenes";

const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
  removeItem: (k: string) => void stored.delete(k),
});

const dev = () => useDevice.getState();
const scenes = () => useScenes.getState();
const driver = () => getDriver() as Gp200Driver;
const pedal = () => driver().mock!;
const until = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 5000, interval: 20 });
/** The edit buffer as the simulated pedal holds it now. */
const onPedal = async () => toPresetState(dev().slot!, await driver().readEditBuffer(""), dev().device);

describe("scene capture and compose (the firmware's rules)", () => {
  beforeAll(async () => {
    await dev().connect("mock", { mockDevice: "gp200", mockMod: true });
  }, 30_000);
  afterAll(async () => {
    await dev().disconnect();
  });

  it("captures on/off, volume, tempo and the params that differ, and composes them back", () => {
    const base = dev().saved!;
    const now = toPresetState(base.slot, editPrst(base.prst, { volume: base.volume + 7, bpm: 140, blocks: { 2: { enabled: !base.blocks[2].enabled }, 3: { params: { 0: 7.5 } } } }), base.device);
    const { scene, dropped } = captureScene(base, now, 1);
    expect(dropped).toEqual([]);
    expect(scene.name).toBe("CENA B");
    expect(scene.volume).toBe(base.volume + 7);
    expect(scene.bpm).toBe(140);
    expect(scene.mask! & 0b100).toBe(base.blocks[2].enabled ? 0 : 0b100);
    expect(scene.params).toEqual([{ block: 3, slot: 0, bits: floatToBits(7.5) }]);
    const back = applyScene(base, scene);
    expect(captureScene(base, back, 1).scene).toEqual(scene);
    expect(sceneRows(base, scene).map((r) => r.parameter)).toEqual(expect.arrayContaining(["On/off", "Volume", "Tempo"]));
  });

  it("a model change: the reserve on PRE, AMP and CAB (all 15 params), refused elsewhere", () => {
    const base = dev().saved!;
    const amp = { ...base.blocks[3] };
    const now = toPresetState(
      base.slot,
      editPrst(base.prst, { blocks: { 3: { enabled: true, fxid: amp.fxid + 1, params: { 0: 1 } }, 8: { fxid: base.blocks[8].fxid + 1 } } }),
      base.device,
    );
    const { scene, dropped } = captureScene(base, now, 0);
    expect(scene.reserve[3].fxid).toBe(amp.fxid + 1);
    expect(scene.reserve[3].params).toHaveLength(15);
    expect(scene.params.some((p) => p.block === 3 || p.block === 8)).toBe(false);
    expect(dropped).toEqual([expect.stringMatching(/^DLY model/)]);
  });

  it("an unchanged scene is removed; names are cleaned for the pedal", () => {
    const base = dev().saved!;
    expect(withScene(null, 2, captureScene(base, base, 2).scene)).toEqual([null, null, null, null]);
    expect(sceneName("  Solo é top!  ", 0)).toBe("Solo e top!");
    expect(sceneName("", 3)).toBe("CENA D");
    expect(sceneNameError("Ação")).toMatch(/without accents/);
    expect(sceneNameError("x".repeat(17))).toMatch(/16/);
  });
});

describe("guest effects of the mod (cenas 0.8.x)", () => {
  beforeAll(async () => {
    await dev().connect("mock", { mockDevice: "gp200", mockMod: true });
  }, 30_000);
  afterAll(async () => {
    await dev().disconnect();
  });

  it("reads each block's guests on connect; the picker lists them after the block's own models", async () => {
    await until(() => expect(useModGuests.getState().byBlock?.[7]).toHaveLength(96));
    expect(useModGuests.getState().byBlock?.[3]).toEqual([]); // AMP takes none
    const mod = modelsFor("gp200", 7);
    const own = mod.filter((m) => !m.guest);
    const guests = mod.filter((m) => m.guest);
    expect(own.length).toBeGreaterThan(0);
    expect(mod.slice(0, own.length)).toEqual(own); // natives first
    expect(guests.length).toBeGreaterThan(80);
    expect(guests.every((m) => m.block === "MOD" && m.guest!.from !== "MOD" && m.title.startsWith(`${m.guest!.from} `))).toBe(true);
    expect(new Set(mod.map((m) => m.fxid)).size).toBe(mod.length); // no guest repeats a native id
  });

  it("a guest in a block shows as the pedal names it, with its origin's knobs and defaults", async () => {
    const green = modelsFor("gp200", 7).find((m) => m.guest?.from === "DST" && m.name === "Green OD")!;
    expect(green).toBeDefined();
    await dev().setModel(7, green.fxid);
    const b = dev().preset!.blocks[7];
    expect(b.model).toMatchObject({ title: "DST Green OD", guest: { from: "DST" } });
    expect(b.model!.params.map((p) => p.name)).toEqual(modelsFor("gp200", 2).find((m) => m.fxid === green.fxid)!.params.map((p) => p.name));
    expect(defaultParamsFor("gp200", 7, green.fxid)).toEqual(defaultParamsFor("gp200", 2, green.fxid));
    await until(async () => expect((await onPedal()).blocks[7].fxid).toBe(green.fxid));
    await dev().discard();
  });
});

describe("scenes store on a modded pedal", () => {
  beforeAll(async () => {
    await dev().connect("mock", { mockDevice: "gp200", mockMod: true });
    await until(() => expect(scenes().current?.slot).toBe(dev().slot));
  }, 30_000);
  afterAll(async () => {
    await dev().disconnect();
  });

  it("reads the active preset's scenes (none yet) and the free records", () => {
    expect(dev().features).toContain("modScenesWrite");
    expect(scenes().current).toMatchObject({ record: null, bytes: null });
    expect(scenes().list).toMatchObject({ free: 42, total: 42 });
    // Right after HELLO the pedal says where it is: scene mode off, the base playing.
    expect(scenes().pedal).toEqual({ sceneMode: false, activeScene: null });
  });

  it("saves what the Rig plays as a scene; the pedal stores it and goes back to the base", async () => {
    const base = dev().saved!;
    dev().setVolume(base.volume + 5);
    dev().setBlockEnabled(7, !base.blocks[7].enabled);
    const { dropped } = await scenes().save(1);
    expect(dropped).toEqual([]);
    const rec = decodeSceneRecord(pedal().modScenes(dev().slot!)!);
    expect(rec.scenes[1]).toMatchObject({ name: "CENA B", volume: base.volume + 5 });
    expect(scenes().current?.record?.scenes[1]?.volume).toBe(base.volume + 5);
    expect(scenes().list?.slots.get(dev().slot!)).toBe(0b10);
    // The pedal reloaded the base and said so; the Rig re-reads it.
    await until(() => expect(dev().preset?.volume).toBe(base.volume));
    expect(dev().unsavedChanges).toBe(0);
  });

  it("plays a saved scene on the pedal to edit it, and saves the edit into it", { timeout: 20_000 }, async () => {
    const base = dev().saved!;
    await scenes().edit(1);
    expect(scenes().editing).toBe(1);
    await until(async () => expect((await onPedal()).volume).toBe(base.volume + 5));
    expect((await onPedal()).blocks[7].enabled).toBe(!base.blocks[7].enabled);
    dev().setBpm(150);
    await scenes().save(1);
    expect(decodeSceneRecord(pedal().modScenes(dev().slot!)!).scenes[1]).toMatchObject({ volume: base.volume + 5, bpm: 150 });
    // The pedal went back to the base after the write; the scene stays selected and plays again on the Rig.
    expect(scenes().editing).toBe(1);
    await until(async () => expect((await onPedal()).volume).toBe(base.volume + 5));
    await until(() => expect(dev().preset).toMatchObject({ volume: base.volume + 5, bpm: 150 }));
    expect(scenes().editing).toBe(1);
    expect(dev().saved?.volume).toBe(base.volume);
    await scenes().leave();
  });

  it("CTRL 1-4 of a scene: the Rig takes them, the footswitch on screen switches the blocks, the save undoes it", { timeout: 20_000 }, async () => {
    const base = dev().saved!;
    await scenes().edit(3);
    dev().setFootswitches(base.footswitches.map((l, n) => (n === 0 ? [7] : l))); // CTRL 1 (BANK−) on DLY
    const dly = dev().preset!.blocks[7].enabled;
    scenes().toggleCtrl(0);
    expect(scenes().ctrlOn).toEqual([true, false, false, false]);
    expect(dev().preset!.blocks[7].enabled).toBe(!dly);
    await scenes().save(3);
    const saved = decodeSceneRecord(pedal().modScenes(dev().slot!)!);
    expect(saved.format).toBe(4);
    expect(saved.scenes[3]?.ctrl?.[0]).toBe(1 << 7);
    expect(saved.scenes[3]?.mask ?? null).toBeNull(); // the CTRL switched on doesn't go into the scene's sound
    // Playing it again puts its CTRLs on the Rig, all off.
    await until(() => expect(scenes().ctrlOn).toEqual([false, false, false, false]));
    expect(dev().preset?.footswitches[0]).toEqual([7]);
    expect(dev().preset!.blocks[7].enabled).toBe(dly);
    await scenes().leave();
    expect(dev().preset?.footswitches[0]).toEqual(base.footswitches[0]);
    await scenes().remove(3);
  });

  it("edit mode: playing a scene switches to scenes; back to preset plays the base; the pedal's scene mode leads", async () => {
    const base = dev().saved!;
    await scenes().edit(1);
    expect(scenes().mode).toBe("scene");
    await scenes().setMode("preset");
    expect(scenes()).toMatchObject({ mode: "preset", editing: null });
    await until(async () => expect((await onPedal()).volume).toBe(base.volume));
    pedal().setSceneMode(true);
    await until(() => expect(scenes().mode).toBe("scene"));
    pedal().setSceneMode(false);
    await until(() => expect(scenes().mode).toBe("preset"));
  });

  it("back to the base plays the saved preset again", async () => {
    const base = dev().saved!;
    await scenes().edit(1);
    await scenes().leave();
    expect(scenes().editing).toBeNull();
    await until(async () => expect((await onPedal()).volume).toBe(base.volume));
  });

  it("renames and deletes a scene; the last one deletes the record", async () => {
    await scenes().rename(1, "Solo");
    expect(decodeSceneRecord(pedal().modScenes(dev().slot!)!).scenes[1]?.name).toBe("Solo");
    await scenes().remove(1);
    expect(pedal().modScenes(dev().slot!)).toBeNull();
    expect(scenes().current?.record).toBeNull();
  });

  it("follows the pedal: a scene played on the pedal stops the app's edit and the Rig shows its sound", async () => {
    const base = dev().saved!;
    dev().setVolume(base.volume + 9);
    await scenes().save(2);
    await until(() => expect(dev().preset?.volume).toBe(base.volume));
    await scenes().edit(0);
    pedal().setSceneMode(true);
    pedal().selectScene(2);
    await until(() => expect(scenes().pedal).toEqual({ sceneMode: true, activeScene: 2 }));
    expect(scenes().editing).toBeNull();
    await until(() => expect(dev().preset?.volume).toBe(base.volume + 9));
    // The saved preset stays the base: the scene shows as changes, not as the stored preset.
    expect(dev().saved?.volume).toBe(base.volume);
  });
});
