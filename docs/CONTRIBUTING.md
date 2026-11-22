# Contributing

Thanks for helping with VLTN Tone Studio. This page covers setup, the checks every change must pass, and how branches, commits and releases work.

## Set up

CI uses Node 26. Any recent Node with npm works.

```bash
cd app
npm install
npm run dev        # desktop app with hot reload
npm run web        # the same UI in Chrome or Edge at http://localhost:5790
```

No pedal needed: add `?mock` to the browser address for a simulated GP-5, or `?mock=gp50|gp200|gp200lt|gp200jr|gp150|gp180`. The Device screen offers the same under *Simulate*. Launch parameters are listed in [`app/README.md`](../app/README.md#launch-parameters-web-build-demos-e2e).

## Commands

Run from `app/`. The root `package.json` forwards `dev`, `web`, `build`, `test` and `typecheck`.

| Command | What it does |
|---|---|
| `npm run dev` | Electron with HMR |
| `npm run web` | the renderer as a web app on port 5790 |
| `npm run typecheck` | typechecks the main/preload and renderer projects |
| `npm test` | Vitest (renderer, main and shared logic) |
| `npm run test:toolkit` | byte-exact protocol and `.prst` tests for GP-5, GP-200 and GP-150 |
| `npm run build` | `electron-vite` build |
| `npm run dist` | build and package with `electron-builder` |
| `npm run build:wasm` | rebuild the SnapTone kernels (needs clang with the wasm32 target; the `.wasm` files are committed) |

## Before you open a pull request

CI runs on every pull request and every push to `develop`. Run the same locally:

```bash
cd app && npm run typecheck && npm test && npm run test:toolkit
```

- CI also compiles with `electron-vite build` on macOS, Windows and Linux. Two files in one folder that differ only by case break there.
- Add or update a test with the change. Pure logic gets a Vitest test next to it; protocol changes get byte-exact vectors in the toolkit suite.
- Check the screen you touched in the browser on the mocks that matter, and watch the console. For a UI change, say in the pull request which mocks you checked.
- A user-visible change adds a line under `## [Unreleased]` in the [changelog](../CHANGELOG.md) and updates the guide in `docs/` that describes it.
- Do not commit vendor data (catalogs, factory presets, firmware) or files that only exist on your machine.

## Branches

| Branch | Use |
|---|---|
| `main` | released code; a merge from `develop` publishes a release |
| `develop` | integration branch; open pull requests against it |
| `feature/*`, `feat/*`, `fix/*` | your work, branched from `develop` |
| `release/x.y.z` | release preparation (version, changelog, README download buttons) |

## Commits and pull requests

The **Slop check** (`.github/workflows/pr-hygiene.yml`) must pass. It enforces:

- Conventional Commits: `type(scope): subject`, with `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `perf`, `style`, `build`, `ci` or `revert`.
- A subject that says what changed (`fix(gp200): read slot flags the right way round`, not `fix: update code`), at most 120 characters, no emoji.
- No chatbot filler or tool footers in commit messages, no `Co-authored-by:` trailers in commits, PR text or added lines, no placeholders that stand in for omitted code, and no AI tool files or instruction files.

Run it locally with `node .github/scripts/check-slop.mjs <base> <head>`.

Keep a pull request to one subject. Describe what changed and how you checked it, and link the issue if there is one.

## Writing for hardware

Anything that sends bytes to a real pedal needs extra care:

- Start from the protocol libraries in `renderer/src/gp5`, `gp200` and `gp150`, and their tests.
- Never send firmware, factory-reset or other destructive frames. The codecs refuse them on purpose.
- A new write path stays experimental or simulator-only until it has passed a round trip on a real unit. Say in the pull request which model and firmware you tested.
- Reverse-engineering notes go into code comments and tests as facts and byte vectors, not as copied code.

## Releases

1. Bump `version` in `app/package.json` on `develop` (or on a `release/x.y.z` branch).
2. Add a `## [x.y.z]` section to the changelog. The release workflow fails without it and puts that section at the top of the release notes.
3. Move the README's `### Download v...` buttons to the new version.
4. Merge into `main`. `.github/workflows/release.yml` typechecks, runs both test suites, builds the macOS (arm64 and x64), Windows, AppImage and `.deb` packages and publishes the GitHub Release `vx.y.z`. It fails if that release already exists.

Packages are unsigned for now. The TONE3000 sign-in in release builds needs the repository secret `T3K_CLIENT_ID`.

## Where to look

| I want to ... | Look at |
|---|---|
| add a screen | `renderer/src/screens/<name>/`, then `state/nav.ts`, `app/Rail.tsx`, `app/palette/CommandPalette.tsx` and the launch parameters in `app/AppShell.tsx` |
| add an OS-level capability | one interface in `shared/host/`, then `main/ipc/`, `preload/` and `host/web/` |
| change a pedal protocol | `renderer/src/<family>/lib/` and its tests; see [Architecture](ARCHITECTURE.md) |
| add a pedal model | `shared/devices.ts`, then the family's driver in `state/driver/`, its simulator and tests |
| fix the docs | this folder; see [Writing documentation](README.md#writing-documentation) |

## Security

Report a vulnerability privately through the repository's Security tab; see the [security policy](../.github/SECURITY.md). Do not open a public issue for it.

## License

By contributing you agree your work is released under the [GPL-3.0](../LICENSE), like the rest of the project.
