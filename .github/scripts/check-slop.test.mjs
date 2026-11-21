import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCommit, checkDiff, checkPr } from "./check-slop.mjs";

const commit = (message) => checkCommit({ sha: "abcdef0123", message });

test("accepts plain conventional commits, including the Claude co-author trailer", () => {
  assert.deepEqual(commit("fix(gp200): read SnapTone slot flags the right way round"), []);
  assert.deepEqual(commit("feat(song): open on Stems\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"), []);
});

test("rejects free-form, vague, long and emoji subjects", () => {
  assert.equal(commit("Updated some stuff").length, 1);
  assert.match(commit("fix: update code")[0], /vague/);
  assert.match(commit(`feat: ${"x".repeat(120)}`)[0], /characters/);
  assert.match(commit("feat(ui): ✨ shiny new tab")[0], /emoji/);
});

test("rejects tool footers and chatbot filler in a message body", () => {
  assert.equal(commit("feat: add tab\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)").length, 2);
  assert.equal(commit("fix: x is wrong\n\nCertainly! Here's the updated fix").length, 1);
});

test("PR title and description", () => {
  assert.deepEqual(checkPr({ title: "feat(song): open on Stems", body: "The Song screen always opens on Stems; the last tab is no longer remembered.", bot: false }), []);
  assert.equal(checkPr({ title: "feat(song): open on Stems", body: "<!-- describe -->\n## Summary\n", bot: false }).length, 1);
  assert.deepEqual(checkPr({ title: "chore(deps): bump vitest", body: "", bot: true }), []);
  assert.equal(checkPr({ title: "Add a tab", body: "x".repeat(40), bot: false }).length, 1);
});

test("diff: added AI files, placeholders and filler, with line numbers", () => {
  const diff = ["+++ b/CLAUDE.md", "@@ -0,0 +1 @@", "+hello", "+++ b/src/a.ts", "@@ -1,2 +10,3 @@", "+const a = 1;", "+// ... rest of the code", "+// As an AI model I cannot", "-removed"].join("\n");
  const found = checkDiff(diff);
  assert.equal(found.length, 3);
  assert.match(found[1], /src\/a\.ts:11/);
  assert.match(found[2], /src\/a\.ts:12/);
  assert.deepEqual(checkDiff("+++ b/app/package-lock.json\n@@ -1 +1 @@\n+// ... rest of"), []);
});

test("allows AGENTS.md but not other AI tool files", () => {
  assert.deepEqual(checkDiff("+++ b/AGENTS.md\n@@ -0,0 +1 @@\n+Run the tests."), []);
  assert.equal(checkDiff("+++ b/CLAUDE.md\n@@ -0,0 +1 @@\n+hello").length, 1);
});
