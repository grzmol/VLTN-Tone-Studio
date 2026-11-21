import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings, type PartTone, type ToneBlock } from "./arrangement";
import type { PartToneFiles } from "./part-tone";
import { automaticUpdateBlock, cleanFallbackQuestion, generatedLabel, missingToneFiles, missingToneWarning, notUpdatedMessage } from "./tone-check";

const block = (role: "amp" | "cab" | "pedal" | "space", toneId: number, overrides: Partial<ToneBlock> = {}): ToneBlock => ({
  type: role === "cab" || role === "space" ? "ir" : "capture",
  role,
  file: { source: "tone3000", toneId, modelId: toneId + 100, name: `${role} ${toneId}` },
  inputDb: 0,
  outputDb: 0,
  mix: 1,
  on: true,
  ...overrides,
});
const chain = (...blocks: ToneBlock[]): PartTone => ({ kind: "chain", blocks, dryWet: 1, fast: false });

/** Files where the tones in `present` can be read and every other read fails, as a cleared cache does. */
function files(present: number[] = []): PartToneFiles {
  const read = (toneId: number) => (present.includes(toneId) ? Promise.resolve("text") : Promise.reject(new Error("not-found")));
  return {
    readNam: vi.fn(async (toneId: number) => read(toneId)),
    readIr: vi.fn(async (toneId: number) => (await read(toneId), new Uint8Array(1))),
    readLocalNam: vi.fn(async () => "text"),
    readLocalIr: vi.fn(async () => new Uint8Array(1)),
  };
}

const settings = (overrides: Partial<BandSettings> = {}): BandSettings => ({ ...DEFAULT_BAND_SETTINGS, ...overrides });

describe("missingToneFiles", () => {
  it("lists the files of the chain that cannot be read, with the part and role", async () => {
    const missing = await missingToneFiles(settings({ bassTone: chain(block("amp", 1), block("cab", 2)) }), files([1]));
    expect(missing.map((entry) => [entry.part, entry.role, entry.file.name])).toEqual([["bass", "cab", "cab 2"]]);
  });

  it("finds nothing when every file is there, and for clean and built-in tones", async () => {
    expect(await missingToneFiles(settings({ bassTone: chain(block("amp", 1)) }), files([1]))).toEqual([]);
    expect(await missingToneFiles(settings({ bassTone: { kind: "builtin", id: "warm" } }), files())).toEqual([]);
    expect(await missingToneFiles(settings(), files())).toEqual([]);
  });

  it("leaves out an off block and an empty slot, which play nothing", async () => {
    const tone = chain(block("amp", 1, { on: false }), block("cab", 2, { file: null }));
    expect(await missingToneFiles(settings({ bassTone: tone }), files())).toEqual([]);
  });

  it("checks a local file by its path and counts a file with no path as missing", async () => {
    const local = block("amp", 1, { file: { source: "file", path: "/tones/amp.nam", name: "amp" } });
    const noPath = block("cab", 2, { file: { source: "file", name: "cab" } });
    const present = files();
    const missing = await missingToneFiles(settings({ drumTone: chain(local, noPath) }), present);
    expect(present.readLocalNam).toHaveBeenCalledWith("/tones/amp.nam");
    expect(missing.map((entry) => [entry.part, entry.role])).toEqual([["drums", "cab"]]);
  });
});

describe("automatic updates with a missing tone file", () => {
  it("are blocked with a message, and leave the settings alone", async () => {
    const asked = settings({ bassTone: chain(block("amp", 1)), renderedTone: { bass: "chain" } });
    const before = structuredClone(asked);
    const reason = await automaticUpdateBlock(asked, files());
    expect(reason).toBe("Not updated: the bass tone's amp capture is missing. Download it or switch to Clean, then Generate.");
    expect(asked).toEqual(before);
  });

  it("are not blocked when every file is there", async () => {
    expect(await automaticUpdateBlock(settings({ bassTone: chain(block("amp", 1)) }), files([1]))).toBeNull();
  });

  it("name every missing file of each part", async () => {
    const asked = settings({ bassTone: chain(block("amp", 1), block("cab", 2)), drumTone: chain(block("space", 3)) });
    const message = notUpdatedMessage(await missingToneFiles(asked, files()));
    expect(message).toContain("the bass tone's amp capture and cab IR are missing");
    expect(message).toContain("the drum tone's space IR is missing");
  });
});

describe("an explicit Generate", () => {
  it("asks before a part is rendered clean", async () => {
    const missing = await missingToneFiles(settings({ bassTone: chain(block("amp", 1)) }), files());
    expect(cleanFallbackQuestion(missing)).toBe("Generate with a clean bass?");
    expect(cleanFallbackQuestion([])).toBeNull();
  });
});

describe("what the preflight and the mixer say", () => {
  it("names the missing file in the preflight", async () => {
    const [missing] = await missingToneFiles(settings({ bassTone: chain(block("cab", 2)) }), files());
    expect(missingToneWarning(missing)).toContain("cab IR (cab 2) is not on this computer");
  });

  it("says a generated part is clean where its tone asked for a chain", () => {
    const asked = settings({ bassTone: chain(block("amp", 1)) });
    expect(generatedLabel({ ...asked, renderedTone: { bass: "clean" } }, "bass")).toBe("Generated · clean (tone missing)");
    expect(generatedLabel({ ...asked, renderedTone: { bass: "chain" } }, "bass")).toBe("Generated");
    expect(generatedLabel({ ...asked, renderedTone: {} }, "bass")).toBe("Generated");
    expect(generatedLabel({ ...settings(), renderedTone: { bass: "clean" } }, "bass")).toBe("Generated");
  });
});
