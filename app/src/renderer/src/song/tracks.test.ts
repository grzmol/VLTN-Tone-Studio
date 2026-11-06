import { describe, expect, it } from "vitest";
import { defaultMix, stemGains } from "./stems/mix";
import {
  busDefaults,
  clickStretchWarning,
  mergeTrackDefaults,
  mixDefaults,
  pitchDefaults,
  savedSettingsOf,
  trackInfoOf,
  defaultBus,
  isClickLike,
  lengthVerdict,
  medianSeconds,
  NAMED_COLOURS,
  orderedKeys,
  parseTrackName,
  setSolo,
  silenceGroupmates,
  toggleMuteGroup,
} from "./tracks";

describe("track order", () => {
  it("keeps the splitter's stems in their own order, then imported tracks in the order they came", () => {
    expect(orderedKeys(["vocals", "track2", "drums", "track0", "bass"])).toEqual(["drums", "bass", "vocals", "track2", "track0"]);
  });

  it("leaves a split song's stems exactly as they were", () => {
    expect(orderedKeys(["source", "piano", "guitar"])).toEqual(["source", "guitar", "piano"]);
  });
});

describe("click detection", () => {
  it("finds a click or guide track by its name, in any case", () => {
    expect(isClickLike("Click")).toBe(true);
    expect(isClickLike("guide vocal")).toBe(true);
    expect(isClickLike("Metronome")).toBe(true);
    expect(isClickLike("Keys L")).toBe(false);
  });

  it("starts a click track on the click bus and every other track on Main", () => {
    expect(defaultBus("01 Click")).toBe("click");
    expect(defaultBus("Bass")).toBe("main");
  });
});

describe("track file names", () => {
  it("uses the base name, without the folder, the extension or a leading track number", () => {
    expect(parseTrackName("/music/song/03 Keys L.wav").name).toBe("Keys L");
    expect(parseTrackName("C:\\songs\\Bass.flac").name).toBe("Bass");
  });

  it("reads bus, colour, volume, pan, pitch and mute groups from brackets and parentheses", () => {
    const parsed = parseTrackName("Keys L [bus=Aux1] (color=blue) [gain=0.5] [pan=-0.25] (pitch=no) (group=1,2).wav");
    expect(parsed).toEqual({
      name: "Keys L",
      bus: "aux1",
      color: NAMED_COLOURS.blue,
      gain: 0.5,
      pan: -0.25,
      transpose: false,
      muteGroups: [1, 2],
    });
  });

  it("takes a hex colour as it is written", () => {
    expect(parseTrackName("Pads (color=#ff00aa).wav").color).toBe("#ff00aa");
  });

  it("ignores an option it cannot read and keeps the name", () => {
    const parsed = parseTrackName("Pads [bus=bogus] [gain=9] [group=9].wav");
    expect(parsed).toEqual({ name: "Pads" });
  });

  it("names a track that has only options Track", () => {
    expect(parseTrackName("[bus=click].wav").name).toBe("Track");
  });
});

describe("length tolerance", () => {
  it("takes a track within half a second of the median without a word", () => {
    expect(lengthVerdict(100.4, 100)).toBe("ok");
  });

  it("pads a track that is a few seconds out, and refuses one far out", () => {
    expect(lengthVerdict(103, 100)).toBe("pad");
    expect(lengthVerdict(96, 100)).toBe("pad");
    expect(lengthVerdict(120, 100)).toBe("reject");
  });

  it("uses the median, so one long stray file does not set the reference", () => {
    expect(medianSeconds([100, 101, 500])).toBe(101);
    expect(medianSeconds([100, 102])).toBe(101);
    expect(medianSeconds([])).toBe(0);
  });
});

describe("click stretch warning", () => {
  it("warns when a click track would be stretched", () => {
    const warning = clickStretchWarning(0.8, [
      { key: "track0", name: "Click", bus: "click" },
      { key: "track1", name: "Keys", bus: "main" },
    ]);
    expect(warning).toContain("Click is stretched to 80%");
    expect(warning).toContain("built-in metronome");
  });

  it("says nothing at 100%, or when no click is playing", () => {
    expect(clickStretchWarning(1, [{ key: "track0", name: "Click", bus: "click" }])).toBeNull();
    expect(clickStretchWarning(0.8, [{ key: "track1", name: "Keys", bus: "main" }])).toBeNull();
  });
});

describe("mute groups", () => {
  it("mutes the other tracks in a group when one is unmuted", () => {
    const mix = defaultMix(["track0", "track1", "track2"]);
    const groups = { track0: [1], track1: [1], track2: [] as number[] };
    const next = silenceGroupmates(mix, groups, "track0");
    expect(next.track1.mute).toBe(true);
    expect(next.track2.mute).toBe(false);
    expect(next.track0.mute).toBe(false);
    expect(stemGains(next, ["track0", "track1", "track2"])).toEqual({ track0: 1, track1: 0, track2: 1 });
  });

  it("mutes a group's tracks when one of them is soloed, and not those outside it", () => {
    const mix = defaultMix(["a", "b", "c"]);
    mix.a = { ...mix.a, solo: true };
    const next = silenceGroupmates(mix, { a: [2], b: [2], c: [3] }, "a");
    expect(next.b.mute).toBe(true);
    expect(next.c.mute).toBe(false);
  });

  it("changes nothing when the track is muted or in no group", () => {
    const mix = defaultMix(["a", "b"]);
    mix.a = { ...mix.a, mute: true };
    expect(silenceGroupmates(mix, { a: [1], b: [1] }, "a")).toBe(mix);
    expect(silenceGroupmates(mix, { a: [], b: [1] }, "a")).toBe(mix);
  });

  it("keeps the other tracks' volume and pan", () => {
    const mix = defaultMix(["a", "b"]);
    mix.b = { volume: 0.4, mute: false, solo: false, pan: 0.5 };
    const next = silenceGroupmates(mix, { a: [1], b: [1] }, "a");
    expect(next.b).toEqual({ volume: 0.4, mute: true, solo: false, pan: 0.5 });
  });

  it("soloing a muted track in a group unmutes it and mutes the rest of the group", () => {
    const mix = defaultMix(["bass", "keys", "other"]);
    mix.bass = { ...mix.bass, mute: true };
    const groups = { bass: [1], keys: [1], other: [] as number[] };
    const next = setSolo(mix, groups, "bass", true);
    expect(next.bass).toMatchObject({ mute: false, solo: true });
    expect(next.keys.mute).toBe(true);
    expect(next.other.mute).toBe(false);
    expect(stemGains(next, ["bass", "keys", "other"])).toEqual({ bass: 1, keys: 0, other: 0 });
  });

  it("soloing a muted track in no group keeps its mute, so it stays silent", () => {
    const mix = defaultMix(["a", "b"]);
    mix.a = { ...mix.a, mute: true };
    const next = setSolo(mix, { a: [], b: [] }, "a", true);
    expect(next.a.solo).toBe(true);
    expect(next.a.mute).toBe(true);
    expect(stemGains(next, ["a", "b"])).toEqual({ a: 0, b: 0 });
  });

  it("clearing a solo changes only the solo flag", () => {
    const mix = defaultMix(["a", "b"]);
    mix.a = { ...mix.a, solo: true };
    const next = setSolo(mix, { a: [1], b: [1] }, "a", false);
    expect(next.a.solo).toBe(false);
    expect(next.b.mute).toBe(false);
  });
});

describe("saved track settings", () => {
  it("reads a library entry's settings into the track info, and back again", () => {
    const entry = {
      name: "Keys L",
      sampleRate: 44100,
      frames: 10,
      channels: 2,
      file: "track3.flac",
      codec: "flac" as const,
      bytes: 1,
      sha256: "a".repeat(64),
      kind: "user" as const,
      color: "#3b82f6",
      bus: "aux1" as const,
      transpose: false,
      gain: 0.5,
      pan: -0.2,
      muteGroups: [2],
    };
    const info = trackInfoOf(entry);
    expect(info).toEqual({ kind: "user", name: "Keys L", color: "#3b82f6", bus: "aux1", transpose: false, gain: 0.5, pan: -0.2, muteGroups: [2] });
    expect(savedSettingsOf(info)).toEqual({ color: "#3b82f6", bus: "aux1", transpose: false, gain: 0.5, pan: -0.2, muteGroups: [2] });
  });

  it("keeps a missing setting missing, so the default applies", () => {
    const legacy = { name: "drums", sampleRate: 44100, frames: 10, channels: 2, file: "drums.flac", codec: "flac" as const, bytes: 1, sha256: "a".repeat(64) };
    expect(trackInfoOf(legacy)).toEqual({ kind: "stem", name: "drums" });
    expect(savedSettingsOf(undefined)).toEqual({});
  });
});

describe("track defaults", () => {
  const tracks = {
    track0: { kind: "user" as const, name: "Click", bus: "click" as const, transpose: false },
    track1: { kind: "user" as const, name: "Keys", gain: 0.6, pan: -0.5, transpose: true },
    drums: { kind: "stem" as const, name: "drums" },
  };

  it("starts each track on its saved bus, volume and pan, and leaves the rest on the defaults", () => {
    expect(busDefaults(tracks)).toEqual({ track0: "click" });
    expect(mixDefaults(tracks)).toEqual({ track1: { volume: 0.6, mute: false, solo: false, pan: -0.5 } });
    expect(pitchDefaults(tracks)).toEqual({ track0: false, track1: true });
  });

  it("adds the saved pitch choices to a song's options, and keeps a choice the song already made", () => {
    const merged = JSON.parse(mergeTrackDefaults(JSON.stringify({ shift: 2, followsPitch: { track1: false } }), tracks));
    expect(merged).toEqual({ shift: 2, followsPitch: { track0: false, track1: false } });
  });

  it("starts from nothing when the options are missing or broken, and leaves them alone with no saved choice", () => {
    expect(JSON.parse(mergeTrackDefaults("", tracks))).toEqual({ followsPitch: { track0: false, track1: true } });
    expect(JSON.parse(mergeTrackDefaults("{broken", tracks))).toEqual({ followsPitch: { track0: false, track1: true } });
    expect(mergeTrackDefaults('{"shift":1}', { drums: { kind: "stem", name: "drums" } })).toBe('{"shift":1}');
  });
});

describe("toggleMuteGroup", () => {
  const tracks = {
    kick: { kind: "drums", name: "Kick", muteGroups: [1] },
    keys: { kind: "keys", name: "Keys", muteGroups: [1, 2] },
    bass: { kind: "bass", name: "Bass" },
  } as unknown as Parameters<typeof toggleMuteGroup>[1];

  it("mutes the members of a group that is audible", () => {
    const result = toggleMuteGroup(defaultMix(["kick", "keys", "bass"]), tracks, 1);
    expect("mix" in result && result.mix).toEqual({
      kick: { volume: 1, mute: true, solo: false },
      keys: { volume: 1, mute: true, solo: false },
      bass: { volume: 1, mute: false, solo: false },
    });
  });

  it("unmutes the members when they are all muted already", () => {
    const muted = { ...defaultMix(["kick", "keys", "bass"]), kick: { volume: 1, mute: true, solo: false }, keys: { volume: 1, mute: true, solo: false } };
    const result = toggleMuteGroup(muted, tracks, 1);
    expect("mix" in result && result.mix.kick.mute).toBe(false);
    expect("mix" in result && result.mix.keys.mute).toBe(false);
  });

  it("leaves the other groups alone", () => {
    const result = toggleMuteGroup(defaultMix(["kick", "keys", "bass"]), tracks, 2);
    expect("mix" in result && result.mix).toMatchObject({ keys: { mute: true }, kick: { mute: false }, bass: { mute: false } });
  });

  it("says so, and changes nothing, when no track is in the group", () => {
    expect(toggleMuteGroup(defaultMix(["kick"]), tracks, 6)).toEqual({ hint: "No track is in mute group 6." });
  });
});
