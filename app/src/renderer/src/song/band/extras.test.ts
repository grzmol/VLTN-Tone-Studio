import { describe, expect, it } from "vitest";
import { extraKeysIn, loadExtras, packExtras, unpackExtras } from "./extras";
import type { PcmAudio } from "../types";
import { playableStems } from "../stems/playable";

const pcm = (frames: number, value = 0.5): PcmAudio => ({
  sampleRate: 44100,
  channels: [new Float32Array(frames).fill(value), new Float32Array(frames).fill(-value)],
});

describe("packExtras and unpackExtras", () => {
  it("gives nothing for no extras", () => {
    expect(packExtras({ exits: {} })).toBeNull();
  });

  it("packs the count and the exits end to end, and cuts each back out", () => {
    const packed = packExtras({
      countIn: { audio: pcm(100, 0.1), start: -2 },
      exits: { verse: { audio: pcm(50, 0.2), from: 8, to: 10 } },
    })!;
    expect(packed.audio.channels[0]).toHaveLength(150);
    expect(packed.manifest.countIn).toEqual({ at: 0, frames: 100, start: -2 });
    expect(packed.manifest.exits.verse).toEqual({ at: 100, frames: 50, from: 8, to: 10 });
    const back = unpackExtras(packed.audio, JSON.parse(JSON.stringify(packed.manifest)));
    expect(back.countIn?.start).toBe(-2);
    expect(back.countIn?.audio.channels[0]).toHaveLength(100);
    expect(back.countIn?.audio.channels[0][0]).toBeCloseTo(0.1);
    expect(back.exits.verse.audio.channels[1][0]).toBeCloseTo(-0.2);
    expect(back.exits.verse).toMatchObject({ from: 8, to: 10 });
  });

  it("leaves out an entry that is damaged or reaches past the track, so the part plays as before", () => {
    const track = pcm(100);
    const manifest = {
      sampleRate: 44100,
      countIn: { at: 90, frames: 50, start: -1 },
      exits: { a: { at: 0, frames: 10, from: 4, to: 2 }, b: { at: 0, frames: 10, from: 2, to: 4 }, __proto__: { at: 0, frames: 1, from: 0, to: 1 } },
    };
    const back = unpackExtras(track, manifest);
    expect(back.countIn).toBeUndefined();
    expect(Object.keys(back.exits)).toEqual(["b"]);
    expect(unpackExtras(track, { ...manifest, sampleRate: 48000 }).exits).toEqual({});
    expect(unpackExtras(track, null).exits).toEqual({});
  });
});

describe("extraKeysIn and loadExtras", () => {
  const packed = packExtras({ countIn: { audio: pcm(100), start: -1 }, exits: {} })!;
  const options = { generatedParts: { drums: "track0", drumsExtras: "track1", bass: "track2" }, bandExtras: { drums: packed.manifest } };

  it("names the extras tracks, which are not the parts", () => {
    expect(extraKeysIn(options)).toEqual(["track1"]);
    expect(extraKeysIn({})).toEqual([]);
  });

  it("loads a part's extras with the track the part plays on", () => {
    const stems = { track0: pcm(1000), track1: packed.audio, track2: pcm(1000) };
    const loaded = loadExtras(options, stems);
    expect(loaded.drums?.track).toBe("track0");
    expect(loaded.drums?.extras.countIn?.start).toBe(-1);
    expect(loaded.bass).toBeUndefined();
  });

  it("loads nothing when the extras track is gone", () => {
    expect(loadExtras(options, { track0: pcm(1000) })).toEqual({});
    expect(loadExtras(options, null)).toEqual({});
  });

  it("keeps the extras track out of the player's stems", () => {
    const stems = { track0: pcm(1000), track1: packed.audio };
    expect(Object.keys(playableStems(stems, pcm(1000), extraKeysIn(options)))).toEqual(["track0"]);
    expect(Object.keys(playableStems(stems, pcm(1000)))).toEqual(["track0", "track1"]);
  });
});
