import { beforeEach, describe, expect, it, vi } from "vitest";
import { drift, indexOfSlot, move, parseImport, serialize, stepIndex, type Setlist, type SetlistItem } from "./setlist";
import { useSetlists } from "./store";

// The test runtime has no Web Storage; give the store one so its persistence can be checked.
const stored = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => stored.get(k) ?? null,
  setItem: (k: string, v: string) => void stored.set(k, String(v)),
});

const item = (slot: number, name: string): SetlistItem => ({ id: `i${slot}`, slot, name, note: "" });

describe("move / stepIndex", () => {
  it("reorders without touching the input", () => {
    const a = ["a", "b", "c"];
    expect(move(a, 0, 2)).toEqual(["b", "c", "a"]);
    expect(a).toEqual(["a", "b", "c"]);
    expect(move(a, 1, 9)).toEqual(a);
  });
  it("steps with wrap-around and from outside the list", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
  it("finds the playing item", () => {
    expect(indexOfSlot([item(5, "a"), item(9, "b")], 9)).toBe(1);
    expect(indexOfSlot([item(5, "a")], null)).toBe(-1);
  });
});

describe("drift", () => {
  const names = [
    { slot: 1, name: "Clean " },
    { slot: 2, name: "Lead" },
    { slot: 3, name: "Crunch" },
  ];
  it("is fine while the slot holds the same preset (or nothing is loaded)", () => {
    expect(drift(item(1, "Clean"), names)).toEqual({ kind: "ok" });
    expect(drift(item(1, "Clean"), [])).toEqual({ kind: "ok" });
  });
  it("finds the preset that moved, or says the slot was renamed", () => {
    expect(drift(item(1, "Lead"), names)).toEqual({ kind: "moved", slot: 2 });
    expect(drift(item(1, "Gone"), names)).toEqual({ kind: "renamed", now: "Clean" });
  });
});

describe("import / export", () => {
  const list: Setlist = { id: "x", name: "Friday", device: "gp5", items: [{ id: "y", slot: 3, name: "Crunch", note: "capo 2" }] };
  it("round-trips with fresh ids", () => {
    const [back] = parseImport(serialize([list]));
    expect(back).toMatchObject({ name: "Friday", device: "gp5", items: [{ slot: 3, name: "Crunch", note: "capo 2" }] });
    expect(back.id).not.toBe("x");
  });
  it("rejects what isn't a setlist file", () => {
    expect(() => parseImport("nope")).toThrow(/valid JSON/);
    expect(() => parseImport('{"v":2,"setlists":[]}')).toThrow(/setlist file/);
    expect(() => parseImport('{"v":1,"setlists":[{"name":"a","device":"gp5","items":[{"slot":-1}]}]}')).toThrow(/slot/);
    expect(() => parseImport('{"v":1,"setlists":[{"name":"a","device":"nope","items":[]}]}')).toThrow(/damaged/);
  });
});

describe("store", () => {
  beforeEach(() => {
    stored.clear();
    useSetlists.setState({ setlists: [], currentId: null });
  });
  it("creates, edits, reorders and persists", () => {
    const s = useSetlists.getState();
    s.create("  Friday  ", "gp5");
    const id = useSetlists.getState().currentId!;
    s.addItem(id, 4, "Clean");
    s.addItem(id, 7, "Lead");
    s.moveItem(id, 1, 0);
    const [first, second] = useSetlists.getState().setlists[0].items;
    expect([first.slot, second.slot]).toEqual([7, 4]);
    s.setNote(id, first.id, "solo");
    s.relink(id, second.id, { slot: 9, name: "Clean2" });
    expect(JSON.parse(stored.get("vltn.setlists.v1")!).setlists[0]).toMatchObject({ name: "Friday", items: [{ note: "solo" }, { slot: 9, name: "Clean2" }] });
    s.remove(id);
    expect(useSetlists.getState().currentId).toBeNull();
  });
});
