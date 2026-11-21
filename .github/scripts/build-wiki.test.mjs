import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteLinks, rewriteTarget, sidebar } from "./build-wiki.mjs";

const repo = "https://example.test/r";

test("links between docs become wiki page links and keep anchors", () => {
  assert.equal(rewriteTarget("PERFORMANCE.md#remote-control", "docs/MIDI-PEDALS.md", repo), "Performance#remote-control");
  assert.equal(rewriteTarget("../CHANGELOG.md", "docs/README.md", repo), "Changelog");
});

test("links to other repository files and external links", () => {
  assert.equal(rewriteTarget("../app/README.md#x", "docs/README.md", repo), "https://example.test/r/blob/main/app/README.md#x");
  assert.equal(rewriteTarget("https://a.test/x.md", "docs/README.md", repo), "https://a.test/x.md");
  assert.equal(rewriteTarget("#top", "docs/README.md", repo), "#top");
});

test("code spans and fences are not rewritten", () => {
  const md = "see [a](SONG-MAP.md) and `[b](SONG-MAP.md)`\n```\n[c](SONG-MAP.md)\n```";
  assert.equal(rewriteLinks(md, "docs/README.md", repo), "see [a](Song-maps) and `[b](SONG-MAP.md)`\n```\n[c](SONG-MAP.md)\n```");
});

test("the sidebar lists every group", () => {
  assert.match(sidebar(), /Using the app[\s\S]*Building the app[\s\S]*Plans[\s\S]*Project/);
});
