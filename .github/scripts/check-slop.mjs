// Scans a pull request for AI slop: commit messages, the PR title and body, and the lines the PR adds.
// Plain Node, no dependencies. Run by .github/workflows/pr-hygiene.yml; locally: node .github/scripts/check-slop.mjs <base> <head>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TYPES = "feat|fix|docs|test|refactor|chore|perf|style|build|ci|revert";
const CONVENTIONAL = new RegExp(`^(${TYPES})(\\([^)]+\\))?!?: \\S`);
// "fix: update code" says nothing: a subject must name what changed.
const VAGUE_WORD = "update|updates|updated|change|changes|changed|fix|fixes|fixed|improve|improvements|misc|wip|stuff|code|files?|things?|bugs?";
const VAGUE = new RegExp(`^(${TYPES})(\\([^)]+\\))?!?: (${VAGUE_WORD})( (${VAGUE_WORD}))?\\.?$`, "i");
const MAX_SUBJECT = 120;
const EMOJI = /\p{Extended_Pictographic}/u;
// Chatbot filler and tool footers that end up pasted into messages, descriptions and code.
const SLOP = [
  /generated (with|by) \[?(claude|chatgpt|copilot|cursor|gemini|codex|ai\b)/i,
  /\bas an ai\b/i,
  /\bi hope this helps\b/i,
  /^\s*(certainly|sure|absolutely)[!,]/im,
  /\bhere(?:'s| is) (the|an?) (updated|revised|complete|full) /i,
  /\bdelve(s|d)? (in|into)\b/i,
  /\bin (today's|the ever-evolving|the rapidly evolving)\b/i,
];
// A truncated answer pasted in place of real code.
const PLACEHOLDER = /(\.\.\.|…)\s*(rest of|remaining|existing|same as before|unchanged|other)\b/i;
const AI_FILES = /(^|\/)(\.claude|\.omc|\.omp|\.cursor|\.windsurf|\.aider[^/]*|\.impeccable)(\/|$)|(^|\/)(CLAUDE|GEMINI|COPILOT)\.md$|(^|\/)\.cursorrules$/;
const SKIP_DIFF = /(^|\/)package-lock\.json$|^\.github\/scripts\/check-slop/;

export function checkCommit({ sha, message }) {
  const [subject = "", ...rest] = message.split("\n");
  const at = `commit ${sha.slice(0, 7)} "${subject.slice(0, 60)}"`;
  const out = [];
  if (!CONVENTIONAL.test(subject)) out.push(`${at}: subject must read type(scope): what changed (types: ${TYPES.replaceAll("|", ", ")})`);
  else if (VAGUE.test(subject)) out.push(`${at}: subject is too vague, say what changed`);
  if (subject.length > MAX_SUBJECT) out.push(`${at}: subject is ${subject.length} characters, keep it under ${MAX_SUBJECT}`);
  out.push(...prose(at, [subject, ...rest].join("\n")));
  return out;
}

/** Emoji and chatbot filler in free text. */
function prose(at, text) {
  const out = [];
  if (EMOJI.test(text)) out.push(`${at}: remove the emoji`);
  const hit = SLOP.find((re) => re.test(text));
  if (hit) out.push(`${at}: contains chatbot filler or a tool footer (${hit.source.slice(0, 40)})`);
  return out;
}

export function checkPr({ title, body, bot }) {
  const out = [];
  const at = `PR title "${title.slice(0, 60)}"`;
  if (!CONVENTIONAL.test(title)) out.push(`${at}: title must read type(scope): what changed`);
  else if (VAGUE.test(title)) out.push(`${at}: title is too vague, say what changed`);
  if (title.length > MAX_SUBJECT) out.push(`${at}: title is ${title.length} characters, keep it under ${MAX_SUBJECT}`);
  out.push(...prose(at, title));
  let text = body ?? "";
  for (let before = ""; before !== text; ) {
    before = text;
    text = text.replace(/<!--[\s\S]*?-->/g, "");
  }
  text = text.replace(/^#+.*$/gm, "");
  if (!bot && text.replace(/\s+/g, "").length < 30) out.push("PR description is empty: say what changed and why, in your own words");
  out.push(...prose("PR description", text));
  return out;
}

/** `diff` is `git diff -U0` output; only added lines and added files are judged. */
export function checkDiff(diff) {
  const out = [];
  let file = "";
  let line = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) {
      file = l.slice(4).replace(/^b\//, "");
      if (file !== "/dev/null" && AI_FILES.test(file)) out.push(`${file}: AI tool files and instructions stay out of the repo`);
    } else if (l.startsWith("@@")) line = Number(/\+(\d+)/.exec(l)?.[1] ?? 0) - 1;
    else if (l.startsWith("+") && !SKIP_DIFF.test(file)) {
      line++;
      const added = l.slice(1);
      if (PLACEHOLDER.test(added)) out.push(`${file}:${line}: truncated placeholder instead of code`);
      else if (SLOP.some((re) => re.test(added))) out.push(`${file}:${line}: chatbot filler or a tool footer`);
    }
  }
  return out;
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function main() {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) throw new Error("usage: check-slop.mjs <base> <head>");
  const problems = [];
  if (process.env.GITHUB_EVENT_PATH) {
    const pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request;
    if (pr) problems.push(...checkPr({ title: pr.title, body: pr.body, bot: pr.user?.type === "Bot" }));
  }
  const log = git("log", "--no-merges", "--format=%H%x00%B%x01", `${base}..${head}`);
  for (const entry of log.split("\x01").map((e) => e.trim()).filter(Boolean)) {
    const [sha, message] = entry.split("\0");
    problems.push(...checkCommit({ sha, message: message.trim() }));
  }
  problems.push(...checkDiff(git("diff", "-U0", "--no-color", `${base}...${head}`)));
  for (const p of problems) console.log(`::error::${p}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s). Fix the commit messages (git rebase -i / git commit --amend), the PR text or the lines above.`);
    process.exit(1);
  }
  console.log("No slop found.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
