# Roadmap

Status: **proposed**, 2026-11-21. Built from the plans in this folder, the open items in the [changelog](../CHANGELOG.md), the [README](../README.md) support table and the hardware notes in the guides. Nothing here has an owner or a date yet; the maintainer sets both. The market analysis and the detailed work packages are in the [product plan](PRODUCT-PLAN.md). Priorities are a judgement using Now / Next / Later, MoSCoW and value against effort, because there is no usage data to score with RICE.

## Where the product stands

- Version 0.9.0 is on `develop`; `release/1.0.0` prepares 1.0.0 (app icon, Linux desktop name, contributor credits). Packages are unsigned.
- Seven pedals are supported across three protocol families (GP-5 and GP-50, GP-200 / LT / JR, GP-150 and GP-180). Every model has a simulator.
- The song side is large: stems, analysis, saved library, setlists and stage mode, MIDI cues, a generated band, song maps, band sync, an audience window.
- The weak spot is **proof on hardware**. Only the GP-5 is fully hardware-verified. The GP-50 and GP-200 family follow decoded protocols and simulators; performance MIDI is confirmed on a GP-180 with a Strymon TimeLine only; audio outputs, speed and pitch, gapless joins and multitrack import are not yet tested on hardware.

## Now: finish 1.0 and prove what exists

| Item | Why | Size | MoSCoW |
|---|---|---|---|
| Release 1.0.0: merge `release/1.0.0` to `main`, then bring the version and changelog back to `develop` | `develop` still says 0.9.0 | S | Must |
| Hardware verification, phase 7 of the [device plan](device-expansion-plan.md): GP-50 and GP-200 read-only first, writes on scratch slots, results recorded as test fixtures | a feature leaves "experimental" only after a round trip on a real unit | L, needs the pedals | Must |
| Close the [GP-200 follow-ups](gp200-wiring-plan.md): factory slots, "discarded the write" wording on pedals without ACK, GP-200 frames in the MIDI log, the "modified" state at connect, read-only controls on LT and JR | known gaps on a family that ships | M | Should |
| Hardware pass for the performance features listed as untested (audio outputs, speed and pitch, gapless joins, multitrack import, timecode) | the guides promise them | M | Should |
| Keep docs true: update a guide and the changelog in the same pull request as the change | the docs drifted once already (`design/` links, the screen list) | S, ongoing | Must |

## Next: lower the cost of using it

| Item | Why | Size | MoSCoW |
|---|---|---|---|
| Signed and notarized macOS and Windows packages | today every first launch shows a Gatekeeper or SmartScreen warning | M, needs certificates | Should |
| Promote GP-50 experimental commands (live footswitch, order, tempo, expression, delete, copy, move) once each passes a hardware round trip | removes a Settings switch users must find | M | Should |
| Make the GP-200LT and GP-200JR writable after a unit is tested; settle whether they have SnapTone slots (README shows unknown) | two of seven models are read-only on real pedals | M, needs units | Should |
| GP-150 and GP-180: expression pedal and patch settings (README: not in Tone Studio) | the one clear feature gap in the support table | M | Could |
| Stable app MIDI clock; today the recommended setup is a one-time tempo command | the continuous clock was unstable on the tested rig | M | Could |
| Hardware tests for other pedal profiles (BOSS and others) | profiles come from manuals and are tested at byte level only | S per pedal | Could |

## Later: needs a decision first

| Item | Why it waits | Size |
|---|---|---|
| Community tab: share presets, browse, like, report (see the [plan](community-plan.md)) | needs a backend, sign-in, moderation and a legal text; four open questions are unanswered (domain, upload licence, signed-out browsing, bundles) | XL |
| Preset conversion between the GP-5 and GP-200 families | needs a model mapping table; refused today with a clear message | L |
| Linking Google and GitHub accounts, preset bundles, comments and profiles | explicitly out of the Community MVP | L |

## Value against effort

| | Low effort | High effort |
|---|---|---|
| **High value** | release 1.0.0, docs kept true, GP-200 follow-ups | hardware verification, signed packages |
| **Low value** | other pedal profile tests | Community tab until the open questions close, GP-5 to GP-200 conversion |

## Decisions the maintainer owns

1. Who verifies on hardware, and with which units and firmware. Without this the Must items cannot finish.
2. Whether to buy signing certificates, and for which platforms.
3. Whether the Community tab goes ahead; if yes, answer the four open questions in its plan first.
4. Capacity split. Suggested: about 70% on the Now and Next lists, 20% on tests and tech debt (the follow-up lists), 10% held for fixes and requests.

## Risks

| Risk | Mitigation |
|---|---|
| A write path that was never run on a real pedal loses a patch or worse | back up before every write, verify by reading back, keep it experimental until a hardware round trip passes |
| Hardware work waits on one person who owns the units | write the checks as a script of steps so a contributor with a pedal can run them and attach the logs |
| New song features outrun their documentation and tests | the pull request rule in [Contributing](CONTRIBUTING.md); stop adding features to a screen until its guide matches |
| The Community tab turns into a moderation and legal burden | decide the licence and the takedown path before any code |

## Updating this page

Review it at each release. Move finished items into the changelog and delete them here, record a changed priority with the reason, and keep the `Status` date current.
