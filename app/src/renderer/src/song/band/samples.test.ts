import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "../types";
import { DRUM_KITS } from "./arrangement";
import { DRUM_PITCHES } from "./note";
import { SAMPLE_MAP, loadSampleSetWith, pickBassLayers, pickBassSample, pickDrumLayers, pickDrumSample, readSampleMap, sampleSetFrom, takeFiles, type SampleSet } from "./samples";
import { ENERGIES, STYLES } from "./styles";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "samples");

/** A SampleSet whose audio is one stub object per file, so a test can tell which file a pick came from. */
function stubSet(kit = "standard"): { set: SampleSet; audio: (file: string) => PcmAudio } {
  const stubs = new Map<string, PcmAudio>();
  const set = sampleSetFrom(SAMPLE_MAP, kit, (file) => {
    let stub = stubs.get(file);
    if (!stub) {
      stub = { sampleRate: 44100, channels: [new Float32Array(1)] };
      stubs.set(file, stub);
    }
    return stub;
  });
  return {
    set,
    audio: (file) => {
      const stub = stubs.get(file);
      if (!stub) throw new Error(`No stub for ${file}`);
      return stub;
    },
  };
}

/** Every file path in map.json, in drum and bass order. */
function mappedFiles(): string[] {
  const drums = Object.values(SAMPLE_MAP.kits).flatMap((kit) => Object.values(kit.drums).flatMap((entry) => entry.layers.flatMap(takeFiles)));
  return [...drums, ...SAMPLE_MAP.bass.map((sample) => sample.file), ...(SAMPLE_MAP.room ? [SAMPLE_MAP.room] : [])];
}

describe("map.json", () => {
  it("is a valid sample map", () => {
    const parsed = JSON.parse(readFileSync(join(SAMPLES, "map.json"), "utf8")) as unknown;
    expect(() => readSampleMap(parsed)).not.toThrow();
  });

  it("rejects a map with a bad bass entry", () => {
    expect(() => readSampleMap({ sampleRate: 44100, kits: { standard: { name: "Standard", drums: {} } }, bass: [{ file: "bass/x.flac", root: 40, layer: "mf", velocity: [1, 127] }] })).toThrow(
      /Invalid sample map/,
    );
  });

  it("has a sample, or a transposed one, for every GM pitch the styles use", () => {
    const pitches = new Set<number>();
    for (const style of Object.values(STYLES)) {
      for (const energy of ENERGIES) for (const groove of style.grooves[energy]) for (const hit of groove.hits) pitches.add(hit.pitch);
      for (const fill of [...style.fills.half, ...style.fills.bar]) for (const hit of fill.hits) pitches.add(hit.pitch);
    }
    for (const [kit, entry] of Object.entries(SAMPLE_MAP.kits)) {
      const missing = [...pitches].filter((pitch) => !entry.drums[String(pitch)]);
      expect(missing, kit).toEqual([]);
    }
  });

  it("covers velocities 1 to 127 for every drum pitch, with no gaps", () => {
    for (const [pitch, entry] of Object.entries(SAMPLE_MAP.kits.standard.drums)) {
      const layers = [...entry.layers].sort((a, b) => a.velocity[0] - b.velocity[0]);
      expect(layers[0].velocity[0], `pitch ${pitch} starts`).toBe(1);
      expect(layers[layers.length - 1].velocity[1], `pitch ${pitch} ends`).toBe(127);
      for (let i = 0; i < layers.length; i++) {
        const [low, high] = layers[i].velocity;
        expect(low, `pitch ${pitch} layer ${i} low`).toBeLessThanOrEqual(high);
        if (i > 0) expect(low, `pitch ${pitch} layer ${i} follows the one before`).toBe(layers[i - 1].velocity[1] + 1);
      }
    }
  });

  it("gives the mid tom the low tom files, transposed up 3 semitones", () => {
    const { drums } = SAMPLE_MAP.kits.standard;
    expect(drums["47"].layers.map(takeFiles)).toEqual(drums["45"].layers.map(takeFiles));
    expect(drums["47"].layers.every((layer) => layer.transpose === 3)).toBe(true);
  });

  it("covers MIDI 28 to 60 within 2 semitones of a bass root", () => {
    const roots = SAMPLE_MAP.bass.map((sample) => sample.root);
    const uncovered: number[] = [];
    for (let midi = 28; midi <= 60; midi++) if (!roots.some((root) => Math.abs(root - midi) <= 2)) uncovered.push(midi);
    expect(uncovered).toEqual([]);
  });

  it("gives every bass root a p layer and an f layer that together cover velocities 1 to 127", () => {
    const byRoot = new Map<number, { velocity: [number, number]; layer: string }[]>();
    for (const sample of SAMPLE_MAP.bass) byRoot.set(sample.root, [...(byRoot.get(sample.root) ?? []), sample]);
    for (const [root, samples] of byRoot) {
      expect(samples.map((s) => s.layer).sort(), `root ${root}`).toEqual(["f", "p"]);
      const [p, f] = [...samples].sort((a, b) => a.velocity[0] - b.velocity[0]);
      expect(p.velocity[0]).toBe(1);
      expect(f.velocity[1]).toBe(127);
      expect(f.velocity[0]).toBe(p.velocity[1] + 1);
    }
  });

  it("names only files that exist, and ships no FLAC the map does not use", () => {
    const files = mappedFiles();
    for (const file of files) expect(existsSync(join(SAMPLES, file)), file).toBe(true);
    const onDisk = readdirSync(SAMPLES, { recursive: true })
      .map(String)
      .filter((path) => path.endsWith(".flac"));
    expect(onDisk.sort()).toEqual([...new Set(files)].sort());
  });

  it("keeps the drum samples under 12 MB", () => {
    const total = readdirSync(join(SAMPLES, "drums"))
      .map((name) => statSync(join(SAMPLES, "drums", name)).size)
      .reduce((sum, size) => sum + size, 0);
    expect(total).toBeLessThan(12_000_000);
  });

  it("accepts a layer with one file or with several", () => {
    const map = (layer: object): unknown => ({ sampleRate: 44100, kits: { standard: { name: "Standard", drums: { "36": { name: "kick", layers: [layer] } } } }, bass: [] });
    const layersOf = (value: unknown): string[][] => readSampleMap(value).kits.standard.drums["36"].layers.map(takeFiles);
    expect(layersOf(map({ file: "a.flac", velocity: [1, 127], nominal: 80 }))).toEqual([["a.flac"]]);
    expect(layersOf(map({ files: ["a.flac", "b.flac"], velocity: [1, 127], nominal: 80 }))).toEqual([["a.flac", "b.flac"]]);
    expect(() => readSampleMap(map({ files: [], velocity: [1, 127], nominal: 80 }))).toThrow(/Invalid sample map/);
    expect(() => readSampleMap(map({ velocity: [1, 127], nominal: 80 }))).toThrow(/Invalid sample map/);
  });

  it("keeps samples/ under 30 MB", () => {
    const total = readdirSync(SAMPLES, { recursive: true })
      .map((path) => join(SAMPLES, String(path)))
      .filter((path) => statSync(path).isFile())
      .reduce((sum, path) => sum + statSync(path).size, 0);
    expect(total).toBeLessThan(30_000_000);
  });
});

describe("drum kits", () => {
  it("has the kits arrangement lists, each with layers for every pitch the generator plays", () => {
    expect(Object.keys(SAMPLE_MAP.kits).sort()).toEqual([...DRUM_KITS].sort());
    for (const [kit, entry] of Object.entries(SAMPLE_MAP.kits)) {
      for (const pitch of DRUM_PITCHES) expect(entry.drums[String(pitch)]?.layers.length, `${kit} ${pitch}`).toBeGreaterThan(0);
    }
  });

  it("plays the heavier kit's toms two semitones lower than the standard kit's", () => {
    const standard = stubSet("standard").set;
    const heavy = stubSet("rock").set;
    for (const pitch of [45, 47, 50]) {
      expect(pickDrumSample(heavy, pitch, 80).transpose).toBe(pickDrumSample(standard, pitch, 80).transpose - 2);
    }
  });

  it("voices the heavier kit's kick and snare and leaves the standard kit's recordings as they are", () => {
    const audioOf = (kit: string, pitch: number) => pickDrumSample(stubSet(kit).set, pitch, 90).audio;
    // The stub audio is one frame; a thumped kick is stretched to ring, a shelved snare keeps its length.
    expect(audioOf("standard", 36).channels[0]).toHaveLength(1);
    expect(audioOf("rock", 36).channels[0].length).toBeGreaterThan(10000);
    expect(audioOf("rock", 38).channels[0]).toHaveLength(1);
    expect(stubSet("rock").set.roomScale).toBe(1.6);
    expect(stubSet("standard").set.roomScale).toBeUndefined();
  });

  it("decodes only the files of the kit asked for, and rejects a kit the map lacks", async () => {
    const requested: string[] = [];
    const urls = new Map<string, string>();
    for (const file of mappedFiles()) urls.set(file, `https://app.test/${file}`);
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    try {
      const set = await loadSampleSetWith(urls, async () => ({ sampleRate: 44100, channels: [new Float32Array(1)] }), "rock");
      expect(set.drums.size).toBe(Object.keys(SAMPLE_MAP.kits.rock.drums).length);
      const wanted = new Set(Object.values(SAMPLE_MAP.kits.rock.drums).flatMap((entry) => entry.layers.flatMap(takeFiles)));
      expect(requested.filter((url) => url.includes("/drums/")).length).toBe(wanted.size);
      await expect(loadSampleSetWith(urls, async () => ({ sampleRate: 44100, channels: [new Float32Array(1)] }), "jazz")).rejects.toThrow(/jazz/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pickDrumSample", () => {
  it("picks the lowest layer for a quiet hit, and scales by velocity / nominal", () => {
    const { set, audio } = stubSet();
    expect(pickDrumSample(set, 36, 31)).toEqual({ audio: audio("drums/kick-v1-rr1.flac"), gain: 1, transpose: 0 });
    expect(pickDrumSample(set, 36, 20).gain).toBeCloseTo(20 / 31);
  });

  it("picks the layer whose range holds the velocity", () => {
    const { set, audio } = stubSet();
    expect(pickDrumSample(set, 36, 48).audio).toBe(audio("drums/kick-v2-rr1.flac"));
    expect(pickDrumSample(set, 36, 79).audio).toBe(audio("drums/kick-v2-rr1.flac"));
    expect(pickDrumSample(set, 36, 80).audio).toBe(audio("drums/kick-v3-rr1.flac"));
    expect(pickDrumSample(set, 36, 85).gain).toBeCloseTo(85 / 95);
  });

  it("picks the top layer from its range up, and lets the gain rise above 1 at 127", () => {
    const { set, audio } = stubSet();
    expect(pickDrumSample(set, 38, 127).audio).toBe(audio("drums/snare-v5-rr1.flac"));
    expect(pickDrumSample(set, 38, 127).gain).toBeCloseTo(127 / 120);
  });

  it("cycles a layer's takes by the take counter", () => {
    const { set, audio } = stubSet();
    const files = [1, 2, 3].map((n) => audio(`drums/kick-v3-rr${n}.flac`));
    expect([0, 1, 2, 3, 4].map((take) => pickDrumSample(set, 36, 90, take).audio)).toEqual([files[0], files[1], files[2], files[0], files[1]]);
  });

  it("plays the mid tom from the low tom files, transposed up 3 semitones", () => {
    const { set, audio } = stubSet();
    const mid = pickDrumSample(set, 47, 79);
    expect(mid.audio).toBe(audio("drums/tom-low-v3.flac"));
    expect(mid.transpose).toBe(3);
    expect(pickDrumSample(set, 45, 79).transpose).toBe(0);
  });

  it("clamps the velocity into 1 to 127", () => {
    const { set, audio } = stubSet();
    expect(pickDrumSample(set, 38, 0).audio).toBe(audio("drums/snare-v1-rr1.flac"));
    expect(pickDrumSample(set, 38, 300).gain).toBeCloseTo(127 / 120);
  });

  it("throws for a pitch with no sample", () => {
    const { set } = stubSet();
    expect(() => pickDrumSample(set, 0, 80)).toThrow(/GM pitch 0/);
  });
});

describe("pickDrumLayers", () => {
  it("plays one layer well inside its range", () => {
    const { set, audio } = stubSet();
    const mix = pickDrumLayers(set, 36, 63);
    expect(mix).toHaveLength(1);
    expect(mix[0].weight).toBe(1);
    expect(mix[0].pick.audio).toBe(audio("drums/kick-v2-rr1.flac"));
  });

  it("plays two layers with equal-power weights 3 steps below a boundary", () => {
    const { set, audio } = stubSet();
    // The kick's layers meet between 79 and 80.
    const mix = pickDrumLayers(set, 36, 76);
    expect(mix.map((m) => m.pick.audio)).toEqual([audio("drums/kick-v2-rr1.flac"), audio("drums/kick-v3-rr1.flac")]);
    expect(mix[0].weight ** 2 + mix[1].weight ** 2).toBeCloseTo(1);
    expect(mix[0].weight).toBeGreaterThan(mix[1].weight);
  });

  it("meets at equal weights on the boundary and is continuous across it", () => {
    const { set } = stubSet();
    const below = pickDrumLayers(set, 36, 79);
    const above = pickDrumLayers(set, 36, 80);
    // One velocity step moves a weight by about 0.08 (a whole zone is 12 steps), and the lower layer never jumps up.
    expect(Math.abs(below[0].weight - above[1].weight)).toBeLessThan(0.12);
    expect(Math.abs(below[1].weight - above[0].weight)).toBeLessThan(0.12);
    expect(below[1].weight).toBeGreaterThan(0.6);
  });

  it("uses the same take for both layers", () => {
    const { set, audio } = stubSet();
    const mix = pickDrumLayers(set, 36, 76, 2);
    expect(mix.map((m) => m.pick.audio)).toEqual([audio("drums/kick-v2-rr3.flac"), audio("drums/kick-v3-rr3.flac")]);
  });

  it("plays only the first or the last layer at the ends of the velocity range", () => {
    const { set } = stubSet();
    expect(pickDrumLayers(set, 36, 1)).toHaveLength(1);
    expect(pickDrumLayers(set, 36, 127)).toHaveLength(1);
  });
});

describe("pickBassSample", () => {
  it("uses the note's own root at rate 1 and the f layer from velocity 76", () => {
    const { set, audio } = stubSet();
    expect(pickBassSample(set, 29, 100)).toEqual({ audio: audio("bass/bass-f1-f.flac"), playbackRate: 1 });
  });

  it("uses the nearest root, and the rate that moves it to the note", () => {
    const { set, audio } = stubSet();
    const pick = pickBassSample(set, 31, 50);
    expect(pick.audio).toBe(audio("bass/bass-ab1-p.flac"));
    expect(pick.playbackRate).toBeCloseTo(2 ** (-1 / 12));
  });

  it("moves an octave below the lowest root down at rate 0.5", () => {
    const { set } = stubSet();
    expect(pickBassSample(set, 17, 60).playbackRate).toBeCloseTo(0.5);
  });

  it("picks the p layer up to velocity 75 and the f layer from 76", () => {
    const { set, audio } = stubSet();
    expect(pickBassSample(set, 47, 75).audio).toBe(audio("bass/bass-b2-p.flac"));
    expect(pickBassSample(set, 47, 76).audio).toBe(audio("bass/bass-b2-f.flac"));
  });

  it("uses the top root for a note above it", () => {
    const { set, audio } = stubSet();
    const pick = pickBassSample(set, 60, 90);
    expect(pick.audio).toBe(audio("bass/bass-b3-f.flac"));
    expect(pick.playbackRate).toBeCloseTo(2 ** (1 / 12));
  });
});

describe("pickBassLayers", () => {
  it("plays the soft layer alone below velocity 66, and the hard layer alone above 86", () => {
    const { set, audio } = stubSet();
    expect(pickBassLayers(set, 47, 50)).toEqual([{ pick: { audio: audio("bass/bass-b2-p.flac"), playbackRate: 1 }, weight: 1 }]);
    expect(pickBassLayers(set, 47, 100)).toEqual([{ pick: { audio: audio("bass/bass-b2-f.flac"), playbackRate: 1 }, weight: 1 }]);
    expect(pickBassLayers(set, 47, 65)).toHaveLength(1);
    expect(pickBassLayers(set, 47, 67)).toHaveLength(2);
    expect(pickBassLayers(set, 47, 85)).toHaveLength(2);
    expect(pickBassLayers(set, 47, 86)).toHaveLength(1);
  });

  it("plays both layers between 66 and 86, with equal-power weights that meet at 76", () => {
    const { set, audio } = stubSet();
    const [soft, hard] = pickBassLayers(set, 47, 76);
    expect(soft.pick.audio).toBe(audio("bass/bass-b2-p.flac"));
    expect(hard.pick.audio).toBe(audio("bass/bass-b2-f.flac"));
    expect(soft.weight).toBeCloseTo(Math.SQRT1_2);
    expect(hard.weight).toBeCloseTo(Math.SQRT1_2);
    expect(soft.weight ** 2 + hard.weight ** 2).toBeCloseTo(1);
  });

  it("moves the soft and hard layers of the nearest root to the note", () => {
    const { set, audio } = stubSet();
    const mix = pickBassLayers(set, 31, 80);
    expect(mix.map((entry) => entry.pick.audio)).toEqual([audio("bass/bass-ab1-p.flac"), audio("bass/bass-ab1-f.flac")]);
    for (const entry of mix) expect(entry.pick.playbackRate).toBeCloseTo(2 ** (-1 / 12));
  });

  it("falls back to one layer when the root has only one", () => {
    const { set, audio } = stubSet();
    const single: SampleSet = { drums: set.drums, bass: set.bass.filter((sample) => !(sample.root === 47 && sample.layer === "f")) };
    expect(pickBassLayers(single, 47, 80)).toEqual([{ pick: pickBassSample(single, 47, 80), weight: 1 }]);
    expect(pickBassLayers(single, 47, 80)[0].pick.audio).toBe(audio("bass/bass-b2-p.flac"));
  });
});
