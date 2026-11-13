import { describe, expect, it } from "vitest";
import type { Section } from "../performance/sections";
import {
  DEFAULT_BAND_SETTINGS,
  defaultFills,
  energyForName,
  isBandSettings,
  parseBandSettings,
  parseBassTone,
  planSections,
  WHOLE_SONG_ID,
  type BandSettings,
  type BassTone,
} from "./arrangement";

function section(id: string, name: string, start: number, end: number): Section {
  return { id, name, start, end, mode: "continue" };
}

const settings = (overrides: Partial<BandSettings> = {}): BandSettings => ({ ...DEFAULT_BAND_SETTINGS, ...overrides });

describe("energyForName", () => {
  it("gives the default energy for each section name", () => {
    expect(energyForName("Intro")).toBe(2);
    expect(energyForName("Verse 1")).toBe(2);
    expect(energyForName("Pre-Chorus")).toBe(3);
    expect(energyForName("Chorus")).toBe(4);
    expect(energyForName("Bridge")).toBe(3);
    expect(energyForName("Guitar SOLO")).toBe(4);
    expect(energyForName("Outro")).toBe(2);
  });

  it("gives 3 for a name it does not know", () => {
    expect(energyForName("Breakdown")).toBe(3);
  });

  it("does not mistake a pre-chorus for a chorus", () => {
    expect(energyForName("pre chorus")).toBe(3);
  });
});

describe("planSections", () => {
  const sections = [section("a", "Intro", 4, 20), section("b", "Verse", 20, 40), section("c", "Chorus", 40, 60), section("d", "Outro", 60, 70)];

  it("makes one plan per section, in time order", () => {
    const plans = planSections([sections[2], sections[0], sections[1], sections[3]], 80, settings());
    expect(plans.map((plan) => plan.sectionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("covers the whole song with no gaps, and the last plan runs to the song end", () => {
    const plans = planSections(sections, 80, settings());
    expect(plans[0].start).toBe(0);
    for (let i = 0; i < plans.length - 1; i++) expect(plans[i].end).toBe(plans[i + 1].start);
    expect(plans[plans.length - 1].end).toBe(80);
  });

  it("gives a song without sections one plan, with its default settings", () => {
    const [plan] = planSections([], 80, settings({ style: "funk", parts: { drums: false, bass: true } }));
    expect(plan).toMatchObject({ sectionId: null, start: 0, end: 80, style: "funk", energy: 3, fill: true, play: { drums: false, bass: true } });
  });

  it("applies the whole-song overrides to a song without sections", () => {
    const override = settings({ sections: { [WHOLE_SONG_ID]: { style: "metal", energy: 5, fill: false, play: { drums: true, bass: false } } } });
    const [plan] = planSections([], 80, override);
    expect(plan).toMatchObject({ style: "metal", energy: 5, fill: false, play: { drums: true, bass: false } });
  });

  it("keeps the whole-song overrides in the saved settings", () => {
    const saved = parseBandSettings({ sections: { [WHOLE_SONG_ID]: { energy: 1 } } });
    expect(saved.sections[WHOLE_SONG_ID]).toEqual({ energy: 1 });
  });

  it("extends the previous section over a gap", () => {
    const plans = planSections([section("a", "Verse", 0, 10), section("b", "Chorus", 15, 30)], 30, settings());
    expect(plans[0].end).toBe(15);
  });

  it("takes default energy from the section name", () => {
    const plans = planSections(sections, 80, settings());
    expect(plans.map((plan) => plan.energy)).toEqual([2, 2, 4, 2]);
  });

  it("turns a fill on before a chorus and on the last section, and nowhere else", () => {
    const plans = planSections(
      [section("a", "Verse", 0, 10), section("b", "Chorus", 10, 20), section("c", "Bridge", 20, 30), section("d", "Outro", 30, 40)],
      40,
      settings(),
    );
    expect(plans.map((plan) => plan.fill)).toEqual([true, false, false, true]);
  });

  it("does not fill before a pre-chorus", () => {
    const plans = planSections([section("a", "Verse", 0, 10), section("b", "Pre-chorus", 10, 20), section("c", "Chorus", 20, 30)], 30, settings());
    expect(plans.map((plan) => plan.fill)).toEqual([false, true, true]);
  });

  it("uses the song's style and parts unless a section overrides them", () => {
    const plans = planSections(sections, 80, settings({ style: "funk", parts: { drums: true, bass: false } }));
    expect(plans.every((plan) => plan.style === "funk")).toBe(true);
    expect(plans.every((plan) => plan.play.bass === false && plan.play.drums === true)).toBe(true);
  });

  it("lets per-section overrides win over the defaults", () => {
    const plans = planSections(
      sections,
      80,
      settings({
        sections: {
          c: { style: "pop", energy: 1, fill: false, play: { drums: false, bass: true } },
        },
      }),
    );
    expect(plans[2]).toMatchObject({ style: "pop", energy: 1, fill: false, play: { drums: false, bass: true } });
    expect(plans[1]).toMatchObject({ style: "rock", energy: 2 });
  });

  it("does not let an override move a section", () => {
    const plans = planSections(sections, 80, settings({ sections: { a: { energy: 5 } } }));
    expect(plans[0].start).toBe(0);
    expect(plans[0].end).toBe(20);
  });

  it("gives one plan for the whole song when there are no sections", () => {
    const plans = planSections([], 90, settings());
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ sectionId: null, start: 0, end: 90, fill: true, energy: 3, loud: 3 });
  });

  it("makes each section's loud level its energy, unless the section sets its own", () => {
    const plans = planSections(sections, 80, settings({ sections: { b: { loud: 5 } } }));
    // The intro (energy 2) and the outro (energy 2) take their energy, the verse (energy 2) is set to loud 5, and the chorus (energy 4) keeps 4.
    expect(plans.map((plan) => plan.loud)).toEqual([2, 5, 4, 2]);
    expect(planSections([], 90, settings({ sections: { song: { energy: 4 } } }))[0]).toMatchObject({ energy: 4, loud: 4 });
    expect(planSections([], 90, settings({ sections: { song: { energy: 4, loud: 1 } } }))[0]).toMatchObject({ energy: 4, loud: 1 });
  });
});

describe("bass notes from", () => {
  it("takes the original bass by default, and keeps a valid choice", () => {
    expect(DEFAULT_BAND_SETTINGS.bassFrom).toBe("original");
    expect(parseBandSettings({ bassFrom: "chords" }).bassFrom).toBe("chords");
    expect(parseBandSettings({ bassFrom: "piano" }).bassFrom).toBe("original");
    expect(parseBandSettings({}).bassFrom).toBe("original");
  });
});

describe("drumRoom", () => {
  it("defaults to 0.25, keeps a saved amount from 0 to 1, and ignores anything else", () => {
    expect(DEFAULT_BAND_SETTINGS.drumRoom).toBe(0.25);
    expect(parseBandSettings({}).drumRoom).toBe(0.25);
    expect(parseBandSettings({ drumRoom: 0 }).drumRoom).toBe(0);
    expect(parseBandSettings({ drumRoom: 0.6 }).drumRoom).toBe(0.6);
    expect(parseBandSettings({ drumRoom: 2 }).drumRoom).toBe(0.25);
    expect(parseBandSettings({ drumRoom: "loud" }).drumRoom).toBe(0.25);
  });
});

describe("isBandSettings and parseBandSettings", () => {
  it("accepts the defaults", () => {
    expect(isBandSettings(DEFAULT_BAND_SETTINGS)).toBe(true);
    expect(parseBandSettings(DEFAULT_BAND_SETTINGS)).toEqual(DEFAULT_BAND_SETTINGS);
  });

  it("gives the defaults for garbage", () => {
    for (const garbage of [null, undefined, 42, "drums", [], true]) {
      expect(parseBandSettings(garbage)).toEqual(DEFAULT_BAND_SETTINGS);
      expect(isBandSettings(garbage)).toBe(false);
    }
  });

  it("keeps valid fields and falls back for invalid ones", () => {
    const parsed = parseBandSettings({ style: "pop", complexity: 7, swing: -1, bassMode: "walking", seed: "x", ghostNotes: false });
    expect(parsed).toMatchObject({
      style: "pop",
      complexity: DEFAULT_BAND_SETTINGS.complexity,
      swing: DEFAULT_BAND_SETTINGS.swing,
      bassMode: "walking",
      seed: DEFAULT_BAND_SETTINGS.seed,
      ghostNotes: false,
    });
  });

  it("rejects an unknown style and an unknown bass mode", () => {
    const parsed = parseBandSettings({ style: "polka", bassMode: "slap" });
    expect(parsed.style).toBe(DEFAULT_BAND_SETTINGS.style);
    expect(parsed.bassMode).toBe(DEFAULT_BAND_SETTINGS.bassMode);
  });

  it("keeps valid section overrides and drops invalid fields inside them", () => {
    const parsed = parseBandSettings({
      sections: {
        a: { energy: 4, style: "funk", fill: "yes" },
        b: { energy: 9 },
        c: "nope",
      },
    });
    expect(parsed.sections).toEqual({ a: { energy: 4, style: "funk" } });
  });

  it("does not let a saved key change the prototype", () => {
    const parsed = parseBandSettings(JSON.parse('{"sections":{"__proto__":{"energy":1}}}'));
    expect(Object.getPrototypeOf(parsed.sections)).toBe(Object.prototype);
    expect(parsed.sections.__proto__).toBe(Object.prototype);
  });

  it("reads an old song with only some fields, keeping the rest at the defaults", () => {
    const parsed = parseBandSettings({ parts: { drums: true, bass: false } });
    expect(parsed.parts).toEqual({ drums: true, bass: false });
    expect(parsed.complexity).toBe(DEFAULT_BAND_SETTINGS.complexity);
  });

  it("keeps a valid loud level in a section and drops one that is not 1 to 5", () => {
    expect(parseBandSettings({ sections: { a: { loud: 4 } } }).sections).toEqual({ a: { loud: 4 } });
    expect(parseBandSettings({ sections: { a: { loud: 9 } } }).sections).toEqual({});
    expect(parseBandSettings({ sections: { a: { loud: "hard", fill: true } } }).sections).toEqual({ a: { fill: true } });
    expect(isBandSettings({ ...settings(), sections: { a: { loud: 0 } } })).toBe(false);
    expect(isBandSettings({ ...settings(), sections: { a: { loud: 2 } } })).toBe(true);
  });

  it("returns fresh objects, so changing a parsed result cannot change the defaults", () => {
    const parsed = parseBandSettings(undefined);
    parsed.parts.drums = false;
    expect(DEFAULT_BAND_SETTINGS.parts.drums).toBe(true);
  });
});

describe("follow-the-drummer setting", () => {
  it("is on by default, a saved choice is kept, and a damaged or older value falls back to on", () => {
    expect(DEFAULT_BAND_SETTINGS.followDrummer).toBe(true);
    expect(parseBandSettings({ followDrummer: false })).toMatchObject({ followDrummer: false });
    expect(parseBandSettings({ followDrummer: "no" })).toMatchObject({ followDrummer: true });
    expect(parseBandSettings({ bassMode: "roots" })).toMatchObject({ followDrummer: true });
  });
});

describe("follow-my-playing settings", () => {
  it("are on and automatic by default, and a saved choice is kept", () => {
    expect(DEFAULT_BAND_SETTINGS.followPlaying).toBe(true);
    expect(DEFAULT_BAND_SETTINGS.followSource).toBe("auto");
    expect(parseBandSettings({ followPlaying: false, followSource: "piano" })).toMatchObject({ followPlaying: false, followSource: "piano" });
  });

  it("falls back to the defaults for a damaged or older follow setting", () => {
    expect(parseBandSettings({ followPlaying: "yes", followSource: "bass" })).toMatchObject({ followPlaying: true, followSource: "auto" });
    expect(parseBandSettings({ bassMode: "roots" })).toMatchObject({ followPlaying: true, followSource: "auto" });
  });

  it("makes a settings object with a bad follow source fail the full check", () => {
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, followSource: "drums" })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, followPlaying: false, followSource: "mix" })).toBe(true);
  });
});

describe("humanise settings", () => {
  it("are at 50% with the style's feel by default", () => {
    expect(DEFAULT_BAND_SETTINGS.humanise).toEqual({ amount: 0.5, feel: "style" });
  });

  it("keep a valid amount and feel, and fall back for each field that is invalid or missing", () => {
    expect(parseBandSettings({ humanise: { amount: 0.2, feel: "pushed" } }).humanise).toEqual({ amount: 0.2, feel: "pushed" });
    expect(parseBandSettings({ humanise: { amount: 3, feel: "tight" } }).humanise).toEqual({ amount: 0.5, feel: "tight" });
    expect(parseBandSettings({ humanise: { amount: 0.2, feel: "groovy" } }).humanise).toEqual({ amount: 0.2, feel: "style" });
    expect(parseBandSettings({ humanise: "loose" }).humanise).toEqual(DEFAULT_BAND_SETTINGS.humanise);
    expect(parseBandSettings({ bassMode: "roots" }).humanise).toEqual(DEFAULT_BAND_SETTINGS.humanise);
  });

  it("makes a settings object with a bad humanise setting fail the full check", () => {
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, humanise: { amount: 2, feel: "style" } })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, humanise: { amount: 0, feel: "swing" } })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, humanise: { amount: 1, feel: "laid-back" } })).toBe(true);
  });
});

describe("bass tone settings", () => {
  const capture = { source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp" } as const;
  const ir = { source: "tone3000", toneId: 43, modelId: 8, name: "4x10 cab" } as const;
  /** A spec 83 tone, as it was saved before the chain. */
  const nam = { kind: "nam", capture, ir, inputDb: 3, outputDb: -2, blend: 0.75 };
  /** The chain that tone becomes on load. */
  const amp = { type: "capture", role: "amp", file: capture, inputDb: 3, outputDb: -2, mix: 1, on: true } as const;
  const cab = { type: "ir", role: "cab", file: ir, inputDb: 0, outputDb: 0, mix: 1, on: true } as const;
  const chain: BassTone = { kind: "chain", blocks: [amp, cab], dryWet: 0.75, fast: false };
  const pedal = {
    type: "capture",
    role: "pedal",
    file: { source: "file", path: "/music/comp.nam", name: "Comp" },
    inputDb: -3,
    outputDb: 2,
    mix: 0.5,
    on: false,
  } as const;
  const room = {
    type: "ir",
    role: "space",
    file: { source: "file", path: "/music/room.wav", name: "Room" },
    inputDb: 0,
    outputDb: 0,
    mix: 0.2,
    on: true,
  } as const;

  it("is clean by default, so the generated bass plays as it always did", () => {
    expect(DEFAULT_BAND_SETTINGS.bassTone).toEqual({ kind: "clean" });
    expect(parseBandSettings(undefined).bassTone).toEqual({ kind: "clean" });
  });

  it("keeps a chain's blocks in order, with their roles, levels, mix and on switch", () => {
    const tone: BassTone = { kind: "chain", blocks: [pedal, amp, cab, room], dryWet: 1, fast: true };
    expect(parseBassTone(tone)).toEqual(tone);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: tone })).toBe(true);
  });

  it("migrates a spec 83 tone to a chain of its amp and cab, with the blend as the dry/wet", () => {
    expect(parseBassTone(nam)).toEqual(chain);
    expect(parseBassTone({ ...nam, ir: null }).kind).toBe("chain");
    expect(parseBassTone({ ...nam, ir: null })).toMatchObject({ blocks: [{ role: "amp" }], dryWet: 0.75 });
  });

  it("gives clean for garbage, for a kind it does not know, and for a spec 83 capture that is incomplete", () => {
    for (const value of [null, "nam", 3, { kind: "amp" }, { kind: "nam" }, { kind: "nam", capture: { source: "tone3000", name: "x" } }]) {
      expect(parseBassTone(value)).toEqual({ kind: "clean" });
    }
    const noPath = { kind: "nam", capture: { source: "file", name: "bass" }, ir: null, inputDb: 0, outputDb: 0, blend: 1 };
    expect(parseBassTone(noPath)).toEqual({ kind: "clean" });
  });

  it("drops a block it cannot read, and a block whose file does not match its role", () => {
    const parsed = parseBassTone({
      kind: "chain",
      blocks: [pedal, { ...room, type: "capture" }, { ...room, role: "amp" }, { ...room, role: "bogus" }, null],
      dryWet: 1,
      fast: false,
    });
    expect(parsed).toEqual({ kind: "chain", blocks: [pedal], dryWet: 1, fast: false });
  });

  it("keeps at most six blocks, the first six, and fails the full check for a seventh", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ ...room, file: { ...room.file, name: `Room ${i}` } }));
    const parsed = parseBassTone({ kind: "chain", blocks: seven, dryWet: 1, fast: false });
    expect(parsed.kind === "chain" && parsed.blocks.map((b) => b.file?.name)).toEqual(seven.slice(0, 6).map((b) => b.file.name));
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: { kind: "chain", blocks: seven, dryWet: 1, fast: false } })).toBe(false);
  });

  it("keeps an empty slot (a preset's block with no file yet), and an A1 capture's older flag", () => {
    const slot = { type: "capture", role: "pedal", file: null, inputDb: 0, outputDb: 0, mix: 1, on: true };
    const oldCapture = { ...amp, file: { ...capture, older: true } };
    const tone = { kind: "chain", blocks: [slot, oldCapture], dryWet: 1, fast: false };
    expect(parseBassTone(tone)).toEqual(tone);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: tone })).toBe(true);
    expect(parseBassTone({ kind: "chain", blocks: [{ ...slot, file: "bass.nam" }], dryWet: 1, fast: false })).toEqual({
      kind: "chain",
      blocks: [],
      dryWet: 1,
      fast: false,
    });
  });

  it("falls back to the defaults for a level, mix or dry/wet that is out of range, one field at a time", () => {
    const parsed = parseBassTone({ kind: "chain", blocks: [{ ...pedal, inputDb: 40, outputDb: -2, mix: 1.5, on: "yes" }], dryWet: 2, fast: "no" });
    expect(parsed).toEqual({ kind: "chain", blocks: [{ ...pedal, inputDb: 0, outputDb: -2, mix: 1, on: true }], dryWet: 1, fast: false });
  });

  it("makes a settings object with a bad bass tone fail the full check", () => {
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: { kind: "chain", blocks: [{ ...pedal, mix: 3 }], dryWet: 1, fast: false } })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: nam })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: chain })).toBe(true);
  });

  it("keeps a saved chain through parseBandSettings, and an older song without one gets clean", () => {
    expect(parseBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: chain }).bassTone).toEqual(chain);
    expect(parseBandSettings({ ...DEFAULT_BAND_SETTINGS, bassTone: nam }).bassTone).toEqual(chain);
    const { bassTone: _dropped, ...older } = DEFAULT_BAND_SETTINGS;
    expect(parseBandSettings(older).bassTone).toEqual({ kind: "clean" });
  });
});

describe("rendered parts and first notes", () => {
  const rendered = { drums: { name: "drums.wav", importedAt: "2026-10-30T10:00:00.000Z" } };

  it("are empty by default, and a saved rendered part and first note are kept", () => {
    expect(DEFAULT_BAND_SETTINGS.rendered).toEqual({});
    expect(DEFAULT_BAND_SETTINGS.firstNote).toEqual({});
    const parsed = parseBandSettings({ ...DEFAULT_BAND_SETTINGS, rendered, firstNote: { drums: 0.5, bass: 1.25 } });
    expect(parsed.rendered).toEqual(rendered);
    expect(parsed.firstNote).toEqual({ drums: 0.5, bass: 1.25 });
  });

  it("drops a damaged rendered entry and a bad first note, and keeps the rest", () => {
    const parsed = parseBandSettings({
      rendered: { drums: { name: "", importedAt: "x" }, bass: { name: "bass.wav", importedAt: "2026-10-30" }, cymbals: { name: "c", importedAt: "x" } },
      firstNote: { drums: -1, bass: "soon" },
    });
    expect(parsed.rendered).toEqual({ bass: { name: "bass.wav", importedAt: "2026-10-30" } });
    expect(parsed.firstNote).toEqual({});
  });

  it("makes a settings object with a damaged rendered entry fail the full check", () => {
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, rendered: { drums: { name: 3, importedAt: "x" } } })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, firstNote: { drums: -2 } })).toBe(false);
    expect(isBandSettings({ ...DEFAULT_BAND_SETTINGS, rendered, firstNote: { drums: 0 } })).toBe(true);
  });
});

describe("section bass parts", () => {
  const song = [
    section("i", "Intro", 0, 20),
    section("v", "Verse", 20, 40),
    section("p", "Pre-Chorus", 40, 50),
    section("c", "Chorus", 50, 70),
    section("b", "Bridge", 70, 90),
    section("o", "Outro", 90, 100),
  ];

  it("resolves Auto to a part for each section, so no plan is left on auto", () => {
    const plans = planSections(song, 100, settings());
    expect(plans.map((plan) => plan.bassPart)).toEqual(["ring", "ring", "pulse", "melodic", "melodic", "ring"]);
    expect(plans.every((plan) => plan.bassPart !== ("auto" as string))).toBe(true);
  });

  it("gives the intro its pedal lead, the pre-chorus its ramp, and the bridge an octave up", () => {
    const plans = planSections(song, 100, settings());
    expect(plans[0].bassLead).toEqual({ part: "pedal", bars: 2 });
    expect(plans[1].bassLead).toBeUndefined();
    expect(plans[2].bassRamp).toBe(true);
    expect(plans[4].octave).toBe(1);
    expect(plans[3].octave).toBe(0);
  });

  it("rings the bridge when the chorus is a groove, which a chorus at busy 3 is", () => {
    const grooveChorus = planSections(song, 100, settings({ sections: { c: { busy: 3 } } }));
    expect(grooveChorus[3].bassPart).toBe("groove");
    expect(grooveChorus[4].bassPart).toBe("ring");
  });

  it("keeps a chosen part, busy and octave over Auto's", () => {
    const plans = planSections(song, 100, settings({ sections: { b: { bassPart: "walking", busy: 5, octave: -1 }, v: { bassPart: "groove" } } }));
    expect(plans[4]).toMatchObject({ bassPart: "walking", busy: 5, octave: -1, bassLead: undefined });
    expect(plans[1]).toMatchObject({ bassPart: "groove", busy: 2 });
  });

  it("defaults busy to the energy, and the octave to 0 for a section that is not on auto", () => {
    const plans = planSections(song, 100, settings({ sections: { v: { bassPart: "pulse" } } }));
    expect(plans[1]).toMatchObject({ busy: 2, octave: 0, bassPart: "pulse" });
  });

  it("falls back to the song's default bass part for a song without sections, and for a name it does not know", () => {
    expect(planSections([], 90, settings({ defaultBassPart: "pulse" }))[0].bassPart).toBe("pulse");
    expect(planSections([], 90, settings({ defaultBassPart: "groove" }))[0].bassPart).toBe("groove");
    expect(planSections([section("x", "Breakdown", 0, 90)], 90, settings({ defaultBassPart: "walking" }))[0].bassPart).toBe("walking");
  });

  it("takes the default bass part from the old bass mode for a song saved before it existed", () => {
    expect(parseBandSettings({ bassMode: "fifths" }).defaultBassPart).toBe("groove");
    expect(parseBandSettings({ bassMode: "melodic" }).defaultBassPart).toBe("melodic");
    expect(parseBandSettings({ bassMode: "roots", defaultBassPart: "ring" }).defaultBassPart).toBe("ring");
    expect(parseBandSettings({ defaultBassPart: "rest" }).defaultBassPart).toBe("pulse");
  });

  it("parses the bass part, busy and octave of a section and the bass feel, and drops what is invalid", () => {
    expect(parseBandSettings({ sections: { a: { bassPart: "pedal", busy: 4, octave: -1 } } }).sections).toEqual({
      a: { bassPart: "pedal", busy: 4, octave: -1 },
    });
    expect(parseBandSettings({ sections: { a: { bassPart: "fly", busy: 0, octave: 2 } } }).sections).toEqual({});
    expect(parseBandSettings({ sections: { a: { bassPart: "auto" } } }).sections).toEqual({ a: { bassPart: "auto" } });
    expect(parseBandSettings({ bassFeel: 0.8 }).bassFeel).toBe(0.8);
    expect(parseBandSettings({ bassFeel: 2 }).bassFeel).toBe(DEFAULT_BAND_SETTINGS.bassFeel);
    expect(DEFAULT_BAND_SETTINGS.bassFeel).toBe(0.5);
    expect(isBandSettings({ ...settings(), bassFeel: -1 })).toBe(false);
  });
});

describe("bass fills and hit the one", () => {
  const song = [section("i", "Intro", 0, 20), section("v", "Verse", 20, 40), section("c", "Chorus", 40, 60), section("c2", "Chorus", 60, 80)];

  it("defaults the fills by name: none for an intro or an outro, most for a chorus", () => {
    expect(defaultFills("Intro")).toBe(0);
    expect(defaultFills("Outro")).toBe(0);
    expect(defaultFills("Verse")).toBe(1);
    expect(defaultFills("Pre-Chorus")).toBe(1);
    expect(defaultFills("Chorus")).toBe(2);
    expect(defaultFills("Bridge")).toBe(1);
    expect(defaultFills("Breakdown")).toBe(1);
  });

  it("hits the one on a chorus that follows another kind of section, and not on a chorus after a chorus", () => {
    const plans = planSections(song, 80, settings());
    expect(plans.map((plan) => plan.fills)).toEqual([0, 1, 2, 2]);
    expect(plans.map((plan) => plan.hitTheOne)).toEqual([false, false, true, false]);
    expect(plans[1].name).toBe("Verse");
  });

  it("takes a section's fills and hit the one from its overrides", () => {
    const plans = planSections(song, 80, settings({ sections: { c: { fills: 0, hitTheOne: false }, v: { fills: 3 } } }));
    expect(plans[1].fills).toBe(3);
    expect(plans[2]).toMatchObject({ fills: 0, hitTheOne: false });
  });

  it("parses fills and hit the one defensively", () => {
    expect(parseBandSettings({ sections: { a: { fills: 2, hitTheOne: true } } }).sections).toEqual({ a: { fills: 2, hitTheOne: true } });
    expect(parseBandSettings({ sections: { a: { fills: 4, hitTheOne: "yes" } } }).sections).toEqual({});
    expect(isBandSettings({ ...settings(), sections: { a: { fills: 1.5 } } })).toBe(false);
  });
});

describe("planSections with what the song's own band does", () => {
  const sections = [section("a", "Verse", 0, 20), section("b", "Bridge", 20, 30), section("c", "Chorus", 30, 50), section("d", "Outro", 50, 60)];

  it("rests the bass where the original bass stops, and stops the drums where the original drums stop", () => {
    const plans = planSections(sections, 60, settings(), [
      { start: 20, end: 30, bassOff: true },
      { start: 50, end: 60, drumsOff: true },
    ]);
    expect(plans[1].bassPart).toBe("rest");
    expect(plans[3].play.drums).toBe(false);
    expect(plans[3].play.bass).toBe(true);
    expect(plans[0].bassPart).not.toBe("rest");
    expect(plans[0].play.drums).toBe(true);
  });

  it("moves the energy one level for a clearly louder or quieter section", () => {
    const plans = planSections(sections, 60, settings(), [
      { start: 0, end: 20, levelDb: -4 },
      { start: 30, end: 50, levelDb: 3 },
      { start: 50, end: 60, levelDb: 1 },
    ]);
    expect(plans[0].energy).toBe(energyForName("Verse") - 1);
    expect(plans[2].energy).toBe(Math.min(5, energyForName("Chorus") + 1));
    expect(plans[3].energy).toBe(energyForName("Outro"));
    expect(plans[2].loud).toBe(plans[2].energy);
  });

  it("keeps what the performer chose over the song's own band", () => {
    const chosen = settings({ sections: { b: { bassPart: "ring" }, d: { play: { drums: true, bass: true } }, a: { energy: 4 } } });
    const plans = planSections(sections, 60, chosen, [
      { start: 0, end: 20, levelDb: -6 },
      { start: 20, end: 30, bassOff: true },
      { start: 50, end: 60, drumsOff: true },
    ]);
    expect(plans[0].energy).toBe(4);
    expect(plans[1].bassPart).toBe("ring");
    expect(plans[3].play.drums).toBe(true);
  });

  it("plans the same as before without hints", () => {
    expect(planSections(sections, 60, settings(), [])).toEqual(planSections(sections, 60, settings()));
  });
});
