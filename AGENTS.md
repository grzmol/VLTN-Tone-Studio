# AGENTS.md

Instructions for coding assistants working in this repository. People should read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this is

VLTN Tone Studio: an editor and librarian for Valeton GP-5, GP-50, GP-150, GP-180 and GP-200 pedals, plus a song player with stems, MIDI cues and a generated band. Electron 43, React 19, TypeScript, Tailwind v4, zustand, Vitest. License GPL-3.0-only. All code is in `app/`; the root `package.json` forwards scripts to it.

## Commands

Run from `app/`.

| Command | Use |
|---|---|
| `npm run dev` | desktop app with HMR |
| `npm run web` | the renderer in a browser at `http://localhost:5790`; add `?mock=gp200` (or another device key) for a simulated pedal |
| `npm run typecheck` | main/preload and renderer projects |
| `npm test` | Vitest |
| `npm run test:toolkit` | byte-exact protocol and `.prst` tests (`node --test`) |
| `npx electron-vite build` | compile check, as CI does on three operating systems |

Before you say a change is done, run `npm run typecheck && npm test && npm run test:toolkit`. If you touched a screen, open it in the browser on a mock and read the console.

## Layout

- `app/src/main/`, `preload/`, `shared/`: Electron main process, the typed `window.gp5host` bridge, and types shared by both sides. An OS capability is one interface in `shared/host/` with `main/ipc/<domain>.ts`, `preload/<domain>.ts` and `renderer/src/host/web/<domain>.ts`.
- `app/src/renderer/src/state/`: the device store (`device.ts`), `driver/` (one driver per protocol family), navigation.
- `app/src/renderer/src/screens/`: `rig`, `library`, `setlist`, `tones`, `device`, `song`, `capture`, `audience`, `follower`.
- `app/src/renderer/src/gp5/`, `gp200/`, `gp150/`: protocol code per pedal family (`lib/`) with byte-exact tests (`tests/`). They are the source of truth for the protocols.
- `app/src/shared/devices.ts`: `DeviceKey` and `DeviceProfile`. Read geometry (slots, blocks, switches) from the profile; do not hard-code it.
- `docs/`: guides, architecture, roadmap and plans. `CHANGELOG.md` and `README.md` stay at the root.

## Rules

- **Hardware safety first.** Never send, or add a path that sends, firmware, factory-reset or other destructive frames. The codecs refuse them (`DANGEROUS` in `gp150/lib/protocol.mjs`, `dangerOf` in `gp200/lib/protocol.mjs`); do not bypass the guard. A new write path stays experimental or simulator-only until it passed a round trip on a real unit. Back up before a write and verify by reading back.
- **Test without a pedal.** Use the simulators (`?mock=gp5|gp50|gp200|gp200lt|gp200jr|gp150|gp180`) and the toolkit tests. Do not claim hardware behaviour you did not observe.
- **Trust boundaries.** Validate `.prst` bytes (length, header, parse) before they reach a pedal. Tokens and secrets stay in the main process.
- **No vendor data in the repo.** Effect catalogs, factory presets and firmware are generated from the user's installation at runtime. Take facts and byte vectors from other projects, not code that conflicts with GPL-3.0-only.
- **File names** that differ only by case are forbidden (`app/src/case-collisions.test.ts`).
- **Tests** sit next to the code as `*.test.ts(x)`. A bug fix gets a test that fails without it.
- **User-visible changes** add a line under `## [Unreleased]` in `CHANGELOG.md` and update the guide in `docs/` that describes the feature, in the same change.
- **Git-ignored paths** (`.claude/`, `.omp/`, `skills-lock.json`, `backups/`, `docs/.omc/`) are never referenced from committed files.
- Keep changes small and in the style of the surrounding code. Do not add abstractions, dependencies or files the task does not need.

## Commits and pull requests

Work on a branch from `develop`; open pull requests against `develop`. Merging `develop` into `main` publishes a release.

The Slop check (`.github/scripts/check-slop.mjs`) rejects, in commit messages, PR text and added lines:

- subjects that are not `type(scope): subject` (types: feat, fix, docs, test, refactor, chore, perf, style, build, ci, revert), that are vague (`fix: update code`), longer than 120 characters or contain emoji;
- chatbot filler, tool footers such as "Generated with ...", and placeholders that stand in for omitted code;
- AI tool and instruction files.

Write commit subjects that name what changed, and add no AI attribution footer.

### Commits are made as the user

Every commit carries the repository owner's identity, never an assistant's.

- Commit with the configured git identity (`git config user.name` and `user.email`). Do not pass `--author`, do not set `GIT_AUTHOR_*` or `GIT_COMMITTER_*`, and do not change the git config to an assistant name or address.
- Before the first commit of a session, run `git config user.name && git config user.email`. If either is empty, or names an assistant (Claude, Anthropic, Codex, Copilot, Gemini, a `noreply@anthropic.com` address), stop and ask the user. Do not commit under a guessed identity.
- No `Co-authored-by:` trailer for an assistant, no "Generated with ..." line, in commits and in PR text.
- Commit only when the user asks. Never push, force-push or open a pull request unasked, and never amend or rewrite a commit that is already pushed.
- Check the result with `git log -1 --format='%an <%ae> / %cn <%ce>'`; author and committer must both be the user. If not, fix it with `git commit --amend --reset-author --no-edit` before anything else.

## Releases

Bump `version` in `app/package.json`, add a `## [x.y.z]` section to `CHANGELOG.md`, move the README's `### Download v...` buttons, then merge to `main`. See [Contributing](docs/CONTRIBUTING.md#releases).
