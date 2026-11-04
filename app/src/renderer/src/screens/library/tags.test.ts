import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchesQuery, normTag, useTags } from "./tags";

// The test runtime has no Web Storage; give the store one so its persistence can be checked.
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
});

beforeEach(() => {
  stored.clear();
  useTags.setState({ meta: {} });
});

describe("matchesQuery", () => {
  const hay = ["Blues Lead", "01-Blues.prst", "clean", "Plexi 100"];
  it("matches every word against name, tags and models", () => {
    expect(matchesQuery("plexi clean", hay, { tags: [], stars: 0 })).toBe(true);
    expect(matchesQuery("plexi crunch", hay, { tags: [], stars: 0 })).toBe(false);
    expect(matchesQuery("#clean", hay, { tags: [], stars: 0 })).toBe(true);
  });
  it("filters by stars", () => {
    expect(matchesQuery("stars:4", hay, { tags: [], stars: 5 })).toBe(true);
    expect(matchesQuery("stars:4", hay, { tags: [], stars: 3 })).toBe(false);
  });
});

describe("tags store", () => {
  it("adds, dedupes, toggles stars and persists", () => {
    const s = useTags.getState();
    s.addTag("c/a", " #Lead Tone ");
    s.addTag("c/a", "lead-tone");
    s.setStars("c/a", 4);
    expect(useTags.getState().meta["c/a"]).toEqual({ tags: ["lead-tone"], stars: 4 });
    expect(JSON.parse(localStorage.getItem("vltn.presetMeta.v1")!)["c/a"].stars).toBe(4);
    s.setStars("c/a", 4);
    s.removeTag("c/a", "lead-tone");
    expect(useTags.getState().meta["c/a"]).toBeUndefined();
    expect(normTag("#A  b")).toBe("a-b");
  });
});
