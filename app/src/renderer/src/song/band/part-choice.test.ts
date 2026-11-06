import { describe, expect, it } from "vitest";
import type { Mix } from "@/song/stems/mix";
import type { TrackInfo } from "@/song/tracks";
import {
  applyPartChoices,
  defaultPartChoice,
  defaultPartChoices,
  effectiveChoice,
  ORIGINAL_PARTS,
  partKeysOf,
  readPartChoices,
  silencedByChoice,
  type PartChoices,
  type PartKeys,
} from "./part-choice";
import { GENERATED_PART_NAMES } from "./generated-names";

const BOTH: PartKeys = { drums: { original: "drums", generated: "track1" }, bass: { original: "bass", generated: "track2" } };

function choices(drums: PartChoices["drums"], bass: PartChoices["bass"] = "original"): PartChoices {
  return { drums, bass };
}

/** The mute flag of each key after applying choices to a mix that starts unmuted, with a custom volume to check it survives. */
function muted(keys: PartKeys, next: PartChoices): Record<string, boolean> {
  const mix: Mix = { drums: { volume: 0.4, mute: false, solo: false, pan: 0.2 }, track1: { volume: 0.8, mute: false, solo: false } };
  const out = applyPartChoices(mix, next, keys);
  return Object.fromEntries(Object.entries(out).map(([key, entry]) => [key, entry.mute]));
}

describe("defaultPartChoice", () => {
  it("starts an absent or partial part on its generated track when there is one", () => {
    expect(defaultPartChoice("absent", true)).toBe("generated");
    expect(defaultPartChoice("partial", true)).toBe("generated");
  });

  it("keeps the original for a present part, and for a song with no generated track", () => {
    expect(defaultPartChoice("present", true)).toBe("original");
    expect(defaultPartChoice("absent", false)).toBe("original");
    expect(defaultPartChoice("unknown", false)).toBe("original");
  });

  it("keeps both for a part not checked yet, which is how such a song already plays", () => {
    expect(defaultPartChoice("unknown", true)).toBe("both");
  });
});

describe("defaultPartChoices", () => {
  it("works out each part on its own, from the split's result and the generated keys", () => {
    const keys: PartKeys = { drums: { original: "drums", generated: "track1" }, bass: { original: "bass" } };
    expect(defaultPartChoices({ drums: "absent", bass: "present" }, keys)).toEqual({ drums: "generated", bass: "original" });
  });

  it("starts an unchecked song with a generated track on both, and one with none on the original", () => {
    expect(defaultPartChoices(null, { drums: { original: "drums", generated: "track1" } })).toEqual({ drums: "both", bass: "original" });
    expect(defaultPartChoices(undefined, { drums: { original: "drums" } })).toEqual(ORIGINAL_PARTS);
  });
});

describe("readPartChoices", () => {
  it("reads each part's saved choice", () => {
    expect(readPartChoices({ drums: "generated", bass: "both" }, ORIGINAL_PARTS)).toEqual({ drums: "generated", bass: "both" });
  });

  it("takes the fallback for a missing, invalid or damaged value", () => {
    const fallback = choices("both", "generated");
    expect(readPartChoices(undefined, fallback)).toEqual(fallback);
    expect(readPartChoices("nonsense", fallback)).toEqual(fallback);
    expect(readPartChoices([], fallback)).toEqual(fallback);
    expect(readPartChoices({ drums: "loud", bass: "original" }, fallback)).toEqual({ drums: "both", bass: "original" });
  });
});

describe("partKeysOf", () => {
  const tracks: Record<string, TrackInfo> = {
    track1: { kind: "user", name: GENERATED_PART_NAMES.drums, bus: "main" },
    track2: { kind: "user", name: "Click" },
  };

  it("finds the original stems the song has and the generated tracks by name", () => {
    const stems = { drums: {}, bass: {} };
    expect(partKeysOf({ ...tracks }, stems)).toEqual({
      drums: { original: "drums", generated: "track1" },
      bass: { original: "bass", generated: undefined },
    });
  });

  it("leaves a part out when the song has neither an original nor a generated track", () => {
    expect(partKeysOf({}, { other: {} })).toEqual({});
  });
});

describe("applyPartChoices", () => {
  it("plays only the original for Original, and mutes the generated track", () => {
    expect(muted(BOTH, choices("original"))).toMatchObject({ drums: false, track1: true });
  });

  it("plays only the generated track for Generated, and mutes the original", () => {
    expect(muted(BOTH, choices("generated"))).toMatchObject({ drums: true, track1: false });
  });

  it("plays both for Both", () => {
    expect(muted(BOTH, choices("both"))).toMatchObject({ drums: false, track1: false });
  });

  it("falls back to the original when the song has no generated track", () => {
    const keys: PartKeys = { drums: { original: "drums" } };
    expect(muted(keys, choices("generated"))).toMatchObject({ drums: false });
    expect(muted(keys, choices("both"))).toMatchObject({ drums: false });
  });

  it("plays the generated track alone when the song has no original stem, so the part is not silenced", () => {
    const keys: PartKeys = { drums: { generated: "track1" } };
    expect(muted(keys, choices("original"))).toMatchObject({ track1: false });
    expect(muted(keys, choices("generated"))).toMatchObject({ track1: false });
  });

  it("controls each part on its own, so drums and bass can differ", () => {
    const keys: PartKeys = { ...BOTH };
    const out = muted(keys, choices("generated", "original"));
    expect(out).toMatchObject({ drums: true, track1: false, bass: false, track2: true });
    const bass = applyPartChoices({}, choices("original", "generated"), { bass: { original: "bass", generated: "track2" } });
    expect(bass).toEqual({ bass: { volume: 1, mute: true, solo: false }, track2: { volume: 1, mute: false, solo: false } });
  });

  it("keeps the volumes and pans of the tracks it switches", () => {
    const mix: Mix = { drums: { volume: 0.4, mute: false, solo: false, pan: 0.2 }, track1: { volume: 0.8, mute: false, solo: false } };
    const out = applyPartChoices(mix, choices("generated"), BOTH);
    expect(out.drums).toEqual({ volume: 0.4, mute: true, solo: false, pan: 0.2 });
    expect(out.track1).toEqual({ volume: 0.8, mute: false, solo: false });
  });

  it("leaves other tracks and parts with no keys untouched", () => {
    const mix: Mix = { click: { volume: 0.5, mute: true, solo: false } };
    const out = applyPartChoices(mix, choices("generated"), { drums: { original: "drums", generated: "track1" } });
    expect(out.click).toBe(mix.click);
  });

  it("does not change the input mix", () => {
    const mix: Mix = { drums: { volume: 1, mute: false, solo: false } };
    applyPartChoices(mix, choices("generated"), BOTH);
    expect(mix.drums.mute).toBe(false);
  });
});

describe("silencedByChoice", () => {
  it("names the track each choice silences, and nothing for a part that plays both", () => {
    expect(silencedByChoice(choices("generated"), BOTH)).toEqual({ drums: "Off: generated plays", track2: "Off: original plays" });
    expect(silencedByChoice(choices("original"), BOTH)).toEqual({ track1: "Off: original plays", track2: "Off: original plays" });
    expect(silencedByChoice(choices("both", "both"), BOTH)).toEqual({});
  });

  it("agrees with the mute levels applyPartChoices sets", () => {
    const mix: Mix = {};
    const muted = applyPartChoices(mix, choices("generated"), BOTH);
    expect(muted.drums?.mute).toBe(true);
    expect(muted.track1?.mute).toBe(false);
    expect(Object.keys(silencedByChoice(choices("generated"), BOTH)).sort()).toEqual(["drums", "track2"]);
  });

  it("marks nothing for a part with no generated track, since its original is the only track", () => {
    expect(silencedByChoice(choices("generated"), { drums: { original: "drums" } })).toEqual({});
  });
});

describe("effectiveChoice", () => {
  it("is Original for a part with no generated track, whatever was saved", () => {
    expect(effectiveChoice("generated", { original: "drums" })).toBe("original");
    expect(effectiveChoice("both", { original: "drums" })).toBe("original");
  });

  it("is Generated for a part with no original stem", () => {
    expect(effectiveChoice("original", { generated: "track1" })).toBe("generated");
  });

  it("is the saved choice when both tracks exist", () => {
    expect(effectiveChoice("generated", BOTH.drums!)).toBe("generated");
    expect(effectiveChoice("both", BOTH.drums!)).toBe("both");
  });
});
