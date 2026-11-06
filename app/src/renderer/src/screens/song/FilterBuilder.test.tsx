import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FilterBuilder } from "./FilterBuilder";
import { RECENT_FILTERS_KEY } from "@/song/recent-filters";
import type { SmartRules } from "@shared/library-filter";

const base: SmartRules = { match: "all", rules: [{ field: "bpm", op: "gt", value: 90 }], sort: "title" };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("edits a rule and passes the whole new value up", () => {
  const changes: SmartRules[] = [];
  render(<FilterBuilder value={base} folders={[]} onChange={(next) => changes.push(next)} />);
  fireEvent.change(screen.getByLabelText("Rule 1 value"), { target: { value: "120" } });
  expect(changes.at(-1)!.rules[0]).toEqual({ field: "bpm", op: "gt", value: 120 });
  fireEvent.change(screen.getByLabelText("Match"), { target: { value: "any" } });
  expect(changes.at(-1)!.match).toBe("any");
});

it("changing the field resets the operator and the value to ones that field takes", () => {
  const changes: SmartRules[] = [];
  render(<FilterBuilder value={base} folders={[]} onChange={(next) => changes.push(next)} />);
  fireEvent.change(screen.getByLabelText("Rule 1 field"), { target: { value: "keyword" } });
  expect(changes.at(-1)!.rules[0]).toEqual({ field: "keyword", op: "has", value: "" });
});

it("shows a rule that cannot run with its problem, rather than failing", () => {
  const broken: SmartRules = { match: "all", rules: [{ field: "bpm", op: "between", value: [200, 100] }], sort: "title" };
  render(<FilterBuilder value={broken} folders={[]} onChange={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain("Enter a range from the smaller to the larger number.");
});

it("adds and removes rules, and offers the sort and limit for a smart playlist", () => {
  const changes: SmartRules[] = [];
  render(<FilterBuilder value={base} folders={[]} onChange={(next) => changes.push(next)} />);
  fireEvent.click(screen.getByText("Add rule"));
  expect(changes.at(-1)!.rules).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("Remove rule 1"));
  expect(changes.at(-1)!.rules).toEqual([]);
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "playCount" } });
  expect(changes.at(-1)!.sort).toBe("playCount");
  fireEvent.change(screen.getByLabelText("Song limit"), { target: { value: "5" } });
  expect(changes.at(-1)!.limit).toBe(5);
});

it("offers a recent filter, and applying it passes that filter up", () => {
  const older: SmartRules = { match: "any", rules: [{ field: "keyword", op: "has", value: "encore" }], sort: "title" };
  localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify([older]));
  const changes: SmartRules[] = [];
  render(<FilterBuilder value={base} folders={[]} onChange={(next) => changes.push(next)} />);
  fireEvent.click(screen.getByText("1 rule · Title"));
  expect(changes.at(-1)).toEqual(older);
});
