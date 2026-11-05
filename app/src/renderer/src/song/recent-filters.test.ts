import { beforeEach, expect, it, vi } from "vitest";
import type { SmartRules } from "@shared/library-filter";
import { RECENT_FILTERS_KEY, RECENT_FILTERS_MAX, readRecentFilters, withRecentFilter, writeRecentFilters } from "./recent-filters";

const filter = (value: number): SmartRules => ({ match: "all", rules: [{ field: "bpm", op: "gt", value }], sort: "title" });

beforeEach(() => localStorage.clear());

it("puts the newest filter first, and does not repeat one already in the list", () => {
  const list = withRecentFilter([filter(1), filter(2)], filter(2));
  expect(list).toEqual([filter(2), filter(1)]);
});

it("keeps at most the newest filters", () => {
  let list: SmartRules[] = [];
  for (let i = 0; i < RECENT_FILTERS_MAX + 3; i++) list = withRecentFilter(list, filter(i));
  expect(list).toHaveLength(RECENT_FILTERS_MAX);
  expect(list[0]).toEqual(filter(RECENT_FILTERS_MAX + 2));
});

it("stores the list and reads it back", () => {
  writeRecentFilters([filter(90)]);
  expect(readRecentFilters()).toEqual([filter(90)]);
});

it("drops a stored filter that no longer passes the rules, and keeps the others", () => {
  const bad = { match: "all", rules: [{ field: "bpm", op: "contains", value: "x" }], sort: "title" };
  localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify([bad, filter(60)]));
  expect(readRecentFilters()).toEqual([filter(60)]);
});

it("reads nothing from a value that is not a list, or is not JSON", () => {
  localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify({ rules: [] }));
  expect(readRecentFilters()).toEqual([]);
  localStorage.setItem(RECENT_FILTERS_KEY, "{not json");
  expect(readRecentFilters()).toEqual([]);
});

it("does not fail when storage is blocked", () => {
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(() => writeRecentFilters([filter(1)])).not.toThrow();
  set.mockRestore();
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  expect(readRecentFilters()).toEqual([]);
  get.mockRestore();
});
