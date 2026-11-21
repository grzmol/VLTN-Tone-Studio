// Builds the GitHub wiki pages from the Markdown in docs/ (plus the changelog), so docs/ stays the single source.
// Plain Node, no dependencies. Usage: node .github/scripts/build-wiki.mjs <out-dir> [repo-url]
// Then copy <out-dir> into a clone of <repo>.wiki.git, commit and push.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = "https://github.com/grzmol/VLTN-Tone-Studio";

// source file (relative to the repository root) -> wiki page name, in sidebar order, grouped.
export const GROUPS = [
  ["Using the app", [
    ["docs/DEVICES.md", "Supported-devices"],
    ["docs/PERFORMANCE.md", "Performance"],
    ["docs/SONG-LIBRARY.md", "Song-library"],
    ["docs/SONG-MAP.md", "Song-maps"],
    ["docs/MIDI-PEDALS.md", "MIDI-pedals"],
    ["docs/BLUETOOTH.md", "Bluetooth-MIDI"],
  ]],
  ["Building the app", [
    ["docs/ARCHITECTURE.md", "Architecture"],
    ["docs/CONTRIBUTING.md", "Contributing"],
    ["docs/ROADMAP.md", "Roadmap"],
    ["docs/PRODUCT-PLAN.md", "Product-plan"],
    ["docs/CUSTOM-EFFECTS-AND-SHARING.md", "Custom-effects-and-sharing"],
  ]],
  ["Plans", [
    ["docs/device-expansion-plan.md", "Plan-device-expansion"],
    ["docs/gp200-wiring-plan.md", "Plan-GP-200-wiring"],
    ["docs/community-plan.md", "Plan-community"],
  ]],
  ["Project", [["CHANGELOG.md", "Changelog"]]],
];
export const HOME = ["docs/README.md", "Home"];

const PAGES = new Map([HOME, ...GROUPS.flatMap(([, pages]) => pages)]);

/** Rewrites one link target found in `from` (a repository path). Anchors are kept; GitHub builds the same ones. */
export function rewriteTarget(target, from, repo = REPO) {
  if (/^([a-z][a-z0-9+.-]*:|#|mailto:)/i.test(target)) return target;
  const [path, anchor = ""] = target.split(/(?=#)/);
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  const page = PAGES.get(resolved);
  if (page) return page + anchor;
  return `${repo}/blob/main/${resolved}${anchor}`;
}

/** Rewrites Markdown links `[text](target)` and leaves code spans and fences alone. */
export function rewriteLinks(markdown, from, repo = REPO) {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line
        .split(/(`[^`]*`)/)
        .map((part) => (part.startsWith("`") ? part : part.replace(/(\]\()([^)\s]+)(\))/g, (_, a, t, c) => a + rewriteTarget(t, from, repo) + c)))
        .join("");
    })
    .join("\n");
}

export function sidebar() {
  const lines = ["**[Home](Home)**", ""];
  for (const [title, pages] of GROUPS) {
    lines.push(`**${title}**`, "");
    for (const [, page] of pages) lines.push(`- [${page.replaceAll("-", " ")}](${page})`);
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const [out, repo = REPO] = process.argv.slice(2);
  if (!out) throw new Error("usage: build-wiki.mjs <out-dir> [repo-url]");
  mkdirSync(out, { recursive: true });
  for (const [src, page] of PAGES) {
    const body = rewriteLinks(readFileSync(join(ROOT, src), "utf8"), src, repo);
    const note = `<!-- Generated from ${src} by .github/scripts/build-wiki.mjs. Edit that file in the repository, not this page. -->\n\n`;
    writeFileSync(join(out, `${page}.md`), note + body);
  }
  writeFileSync(join(out, "_Sidebar.md"), sidebar());
  writeFileSync(join(out, "_Footer.md"), `This wiki is generated from [\`docs/\`](${repo}/tree/main/docs) in the repository. To change a page, edit the file there.\n`);
  console.log(`${PAGES.size} pages written to ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
