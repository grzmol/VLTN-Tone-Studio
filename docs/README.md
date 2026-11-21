# Documentation

Guides for people who use VLTN Tone Studio, and notes for people who build it. The project overview, install steps and screenshots are in the [README](../README.md); what changed in each version is in the [changelog](../CHANGELOG.md).

## Using the app

| Guide | Read it to |
|---|---|
| [Performance](PERFORMANCE.md) | play a song or a set, send MIDI cues, use stage mode, practice mute, the generated band and PDF charts |
| [Song library](SONG-LIBRARY.md) | save songs, playlists, sets, the queue, backups and the Trash |
| [Song maps](SONG-MAP.md) | export a song brief, have an assistant map the song, import the reply and undo it |
| [MIDI pedals](MIDI-PEDALS.md) | send commands to other pedals (BOSS, TimeLine and others), write macros and custom JSON profiles |
| [Bluetooth MIDI](BLUETOOTH.md) | connect a GP-150 or GP-180 over Bluetooth LE, and what stays on USB |

## Building the app

| Document | Read it to |
|---|---|
| [Architecture](ARCHITECTURE.md) | find your way around the code: processes, folders, the device layer, data flow |
| [Contributing](CONTRIBUTING.md) | set up, run the checks, name a branch and a commit, open a pull request, cut a release |
| [Roadmap](ROADMAP.md) | see what is being worked on, what comes next and what is parked |
| [Product plan](PRODUCT-PLAN.md) | read the market and feature analysis and the detailed, phased development plan behind the roadmap |
| [Custom effects and sharing](CUSTOM-EFFECTS-AND-SHARING.md) | see what exists on GitHub for firmware and custom effects, and the plan for sharing presets, blocks and captures by hash on every model |
| [`app/README.md`](../app/README.md) | look up commands, launch parameters and the details of each pedal family, SnapTones, User IRs and stems |
| [`AGENTS.md`](../AGENTS.md) | brief a coding assistant on the repository |

## Plans

Engineering plans written before the work started. They record decisions and open questions; the code and its tests stay the source of truth when they disagree.

| Plan | State |
|---|---|
| [Full GP-50 and GP-200 support](device-expansion-plan.md) | phases 1 to 6 are built; phase 7 (hardware verification) is open |
| [Wire the GP-200 family into the app](gp200-wiring-plan.md) | steps 1 and 2 merged; the follow-up list is still open |
| [Community tab](community-plan.md) | draft, waiting for approval and four open questions |

## Writing documentation

- A user guide describes what the app does now, in the second person, and links to the section of another guide instead of repeating it.
- A change a user can see gets a line in the changelog under `[Unreleased]`, and an update to the guide that describes it, in the same pull request.
- A claim about a pedal that has not been tried on hardware says so. The guides already mark these; keep the marks when you edit.
- Link with relative paths. Do not link to files that git ignores (`.claude/`, `.omp/`, `skills-lock.json`).
- A plan has a `Status` line with a date, and its finished work moves into the changelog when it ships.
