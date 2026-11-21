# Plan: wire the GP-200 family into the app (phase 6, remaining work)

Status 2026-10-11, branch `feature/gp50-support`. Follows `docs/device-expansion-plan.md` phase 6. Line numbers drift; search by name.

## Where we are
| piece | state |
|---|---|
| GP-200 protocol lib `app/src/renderer/src/gp200/lib` (codec, `.prst`, catalog builder, session, `MockGp200`) | done, 115 toolkit tests green, nothing run on hardware |
| `Gp200Driver` + `gp200-globals.ts` | done and **registered** (`DRIVER_FAMILIES = ["gp5", "gp200"]`); the simulator runs at `FAST_SIMULATOR` pace |
| effect-catalog import from the user's `algorithm.xml` (`gp200/app/catalog-store.ts`, `catalog-adapter.ts`) | loads when a GP-200 family pedal connects; **`Gp200CatalogPanel` not mounted** (G0) |
| registry profiles `gp200` / `gp200lt` / `gp200jr` | `simulator: true`; `writable: false` on the LT and JR (no memory writes on a real unit until one is tested) |
| store and files (step 1) | done: every family connects, syncs, edits, saves, renames, writes and backs up; Rig, Library, Tones, Device and Song render on `?mock=gp200*` |
| screens | GP-5 layouts with GP-200 data: step 2 below |

Gates: `npm run typecheck`, `npm test`, `npm run test:toolkit` from `app/`, plus a browser smoke on `?mock=gp200`, `?mock=gp200lt`, `?mock=gp200jr` and `?mock=gp5` / `?mock=gp50` unchanged.

## Step 1: foundation (done: 6344815, f6d5c52, d95479d)
What step 2 builds on; all of it lives in files no step-2 agent owns.
- **Preset model** (`state/device-types.ts`): `PresetState.device` is any model; `footswitches: number[][]`, one block list per switch (FS1/FS2, or every CTRL record of a GP-200 patch: 8, also on the LT and JR; how many to show is the screen's call); `exp` stays GP-50 only; `gp200: Gp200Fields | null` holds author, note, pan, style, FX loop (mode, send/return level, send/return position), the 9 EXP entries (EXP 1A, 1B, 2 × 3) and the 3 Quick Access knobs. `BlockCode` adds WAH and VOL; `Gp5BlockCode` is the GP-5 family's. `ParamInfo` may carry `values` (menus with gaps) and `offAtMin`.
- **Codec seam** (`state/preset-codec.ts`): `toPresetState`, `editPrst(prst, PresetEdits)`, `modelFor(device, block, fxid, params?)`, `modelsFor(device, block)`, `defaultParamsFor(device, block, fxid)`, `clampParamValue`, `orderError`. GP-200 models come from the imported catalog and are block-aware; without a catalog blocks have no model ("Unknown model").
- **Store** (`state/device.ts`): `editPatch(Gp200Edit)` edits the GP-200 fields locally (they reach the pedal on save; the session has live commands for most of them, not wired yet); `setFootswitches(lists)`; tempo clamps to `profile.tempo` (GP-200 40-250); renaming the active GP-200 slot with unsaved edits is refused (the pedal saves the edit buffer to rename it); the catalog loads on connect and re-describes the open preset when it is imported or removed; unsaved-changes rows cover the GP-200 fields.
- **Helpers** (`state/device-model.ts`): `switchLabel(device, i)`, `globalSpecsFor` (GP-200 table) with `SettingSpec`, `writesLocked(device, mode)`, `acksFrames(device)`, per-family `EXPERIMENTAL_FEATURES` (none on the GP-200), `writeFrameCount` (7 frames on the GP-200). Registry: `profile.tempo`, `profile.writable`, `profile.captureBlock(slot)`.
- **Rig rules** (`screens/rig/order.ts`): every helper takes the device; AMP/CAB from the profile; all GP-200 blocks move; interim grouping keeps every block visible (AMP and CAB in the amp group, the rest before/after AMP).
- **Files**: summaries, the mini chain, the Inspector, import, the write dialog and conversion handle GP-200 family files; GP-200 ↔ LT/JR files need no conversion.
- **Fixed on the way**: a live param edit that read the edit buffer while another patch was selected was sent with the old model's fxid into the new patch (`Gp200Driver` now drops stale reads and edits).

Left for step 2 or later (not blockers):
- `midi-log.ts` still decodes as GP-5 SysEx: GP-200 traffic shows as "SysEx" out and "Unreadable frame" in (D).
- "Clear" refuses on models without empty slots with a message; the Library still offers it and an Empty tab (C, G20). "Duplicate" on a GP-200 says "Clear one first" (C).
- GP-200 SnapTones play in the AMP (0-4) or DST (5-9) block as fxid `0x0F00000n`; the Rig, picker and Tones still think in NS terms (A G13, C G16).
- The GP-200 "modified" state (the `0x1011` dirty push, `Gp200Session.dirty`) isn't a driver feature yet, so at connect an edited edit buffer reads as saved.
- Preset summaries are cached per byte array: one made before a catalog import keeps "Unknown model" until the bytes are read again.
- `--block-wah` / `--block-vol` tokens don't exist yet (A G14); `art.ts` has interim colours.
- The settings screen throws on a change for a read-only LT/JR on a real pedal (store refuses); it should disable the controls (D).

## Step 2: done (merged 2026-10-11: B 72c1b75, C a7eaa70, A 1701c71, D ee0cbd4, fix-up 2a2e6b2)
Gates after the last merge: typecheck clean, 441 vitest, 115 toolkit; all five mocks on all five screens with a clean console.

Follow-ups the agents reported (outside their files), not done yet:
- G21 factory banks: registry field `factorySlots` (GP-200 `[0, 99]` per the official manual: "the first 100 (01-A~25-D) containing default factory parameters"; LT/JR unknown), then dim rows in SlotList and warn in the write dialogs.
- `app/notify.tsx` notifyWriteFailed says "discarded the write" (GP-5 ACK behaviour): gate on `acksFrames`.
- `state/device.ts` busy labels use raw slot numbers: use `slotLabel`.
- `screens/capture/Pipeline.tsx`: replace check by `isEmptySlot(entry)`; 10-character names hard-coded.
- `screens/rig/ExpControl.tsx`, `live-edits.ts`: "GP-50 extras" copy → "Experimental pedal commands"; `shared/host/app.ts` doc comment.
- `globals.css`: `--color-block-wah` / `--color-block-vol` under `@theme inline`.
- `ParamInfo` off-at-max flag from the catalog adapter (MinISOff + valueType 2), so `knobsForBlock` drops its raw-catalog lookup.
- GP-200 IN dial in the chain overview (`inputLevel`, −20..20 dB).
- Drum style: names from the sync (session reads them) and 1-based in `unsaved-diff.ts`; StatusBar should pass the model to `liveStatusText` ("CTRL" on a GP-200).
- Live sends for the GP-200 patch fields (EXP, Quick Access, pan/send/return/loop/style, author, note, CTRL): the session has the commands.
- JR tempo clock source still offers DIN/TRS; Backups restore buttons aren't disabled on a real LT/JR; host's Suite check doesn't know the GP-200 editor.
- `prst.mjs encodePatchImage` defaults send/return to 0/0, outside the 1..11 the public sources give (lib owner; mirrored).
- Decision made by D: the GP-200 Global EQ write (0x1005, editor-RE only, changes every output) sits behind the experimental switch on real pedals.

Hardware checks to add to phase 7: send/return positions (1..11, send ≤ return, playing vs storage order), Global EQ ranges and the 0x1004 report, CTRL count on LT/JR, init patch vs the pedal's own reset, "modified" at connect.

## Step 2 file ownership (fan-out 2026-10-11)
Each agent works in its own git worktree and branch and edits only its own files; anything needed elsewhere is reported, not done.
- **A (Rig chain and art):** `screens/rig/{Pedalboard,ChainOverview,AmpCabView,ModelPicker,order,RigScreen,rig-store,snaptone}` (+ `order.test.ts`), `components/gear/**`, `styles/tokens.css`.
- **B (Rig patch controls):** `screens/rig/{RigHeader,FootswitchControl,ExpControl,TempoControl,BlockMenu,edits,tempo,history,live-edits,clipboard}` and new patch-panel files under `screens/rig/`.
- **C (Library, Tones, Song, palette, writes):** `screens/library/**`, `screens/tones/**`, `snaptone/**`, `userir/**`, `song/**`, `screens/song/**`, `app/palette/**`, `components/write/**`, `shared/tone3000.ts`.
- **D (Device, settings, app shell, state):** `screens/device/**`, `app/*.tsx`, `app/*.ts` except `palette/`, and the only writer of `state/**` in step 2 (`midi-log.ts`, Global EQ driver and store plumbing, `gp200-globals.ts`).
- Read-only for everyone: `gp5/lib/**`, `gp200/lib/**`, `shared/devices.ts`, `gp200/app/**` (A and C may read `useGp200Catalog` for their catalog call to action; D mounts the panel).
- Undoable GP-200 patch edits: `editPatchFields(edit)` in `screens/rig/edits.ts` (history kind "patch"); A calls it for the FX-loop nodes, B for the patch panel.
- G1 copy: each agent in the files it owns.

Notes from the step-1 smoke: after a Library rename the row shows "Not read yet" (same code path on the GP-5; C to check). The catalog loads before the first preset is described (fixed 8ce2d1c).

## Step 2: UI (four agents in parallel, disjoint files, after step 1)
Issue ids come from the UI × model review.

**A. Rig: chain and pedal art** (`screens/rig/{Pedalboard,ChainOverview,AmpCabView,ModelPicker,order}`, `components/gear/**`, `styles/tokens.css`)
- G8: flat 11-block chain with draggable FX-loop send/return nodes. No "fixed order" lock on the GP-200.
- G9: board overflow (up to 10 pedals before the amp): visible scroller, and the selected pedal scrolled into view.
- G10: models with more knobs than the art holds (Tape Delay S 10, Ice Delay 11, Hyper EQ 11 bands) need a "More controls" strip.
- G11: cab Low Cut / High Cut from `model.params`, with OFF at the range ends.
- G12: amp voicing and origin from the catalog category.
- G13: capture art chosen by fxid family (0x0F…), with no NS copy.
- G14: `--block-wah` and `--block-vol` tokens (≥3:1 against `--well`).
- G15: picker categories and copy per family.

**B. Rig: patch controls** (`screens/rig/{RigHeader,FootswitchControl,ExpControl,TempoControl,BlockMenu,edits,tempo}`, a new patch panel)
- G5: CTRL editor from `profile.ctrls` / `profile.footswitches` (GP-200 has 8 CTRL, LT 4 footswitches, JR 3), extending the Footswitches popover from U4.
- G6: GP-200 EXP editor: EXP1A / EXP1B / EXP2, 3 entries each, labelled per model (the LT has no built-in EXP, the JR has a built-in EXP plus one jack).
- G7: Quick Access knobs 1-3.
- G8 (patch side): loop mode, send/return level, pan, style, author, note.
- G23: tempo range from the profile (GP-200 40-250).
- U5 already sizes the name field from `nameLength` (16).

**C. Library, Tones, Song, palette** (`screens/library/**`, `screens/tones/**`, `snaptone/**`, `userir/**`, `song/**`, `app/palette/**`, `components/write/**`)
- G4: slot-label columns sized for `12-C`.
- G19: 16-character names.
- G20: no Empty tab or empty counts; "Clear" becomes "Reset to init patch" (`0x2009` is not verified on hardware).
- G21: factory banks 01-A…25-D dimmed, with a warning before writes.
- G22: confirm copy for the no-ACK write.
- G16: SnapTones grouped AMP 0-4 / DST 5-9, empties counted by `kind`.
- SnapTone conversion produces the GP-200 clone (`snaptone/worker.ts` makes the GP-5 2696-byte file today; the driver refuses it).
- User IR keeps 1024 samples (`userir/convert.ts` cuts to 512); `shared/tone3000.ts` finds empty slots by `kind`.
- G17: copy from the profile (`userIr.samples`, slot count).
- G25: Tone Match hidden or disabled with a reason until a GP-200 model mapping exists.
- Palette "load capture" uses the capture block from the profile (today it looks up `NS`, which gives -1 on the GP-200).

**D. Device and settings** (`screens/device/**`, `app/*.tsx`, `state/driver/gp200-globals.ts`)
- G0: mount `Gp200CatalogPanel`, and show a call to action on Rig / picker / Library while the catalog isn't ready.
- G1: no remembered-GP-50 copy while a GP-200 is attached (Device header, chip, Rig empty state, Diagnostics, Library, Tones, Song).
- G2: header wrap.
- G3: "Simulate a GP-200 / LT / JR" buttons.
- G18: settings per model (`only` restrictions: the JR has no DIN MIDI) and a Global EQ panel (31 values, `0x1005`).
- G26: rename "GP-50 extras" to a family-neutral experimental switch and list what it unlocks per family.
- `midi-log.ts` decodes all traffic as GP-5 SysEx; decode GP-200 frames with `gp200/lib/protocol.mjs`.

## Step 3: docs and release gates
- support matrix in `docs/DEVICES.md`, CHANGELOG `Unreleased`, `app/README.md` (drivers, `?mock=gp200*`), and the status of `docs/device-expansion-plan.md`.
- Hardware verification (phase 7) on a real GP-200: read-only first, writes on scratch user slots ≥ 100 after a full backup. Open items: CC0 bank polarity, `0x2009` init-patch, the CTRL count on LT/JR, and the GP-200 backup time (the profile's `backupSeconds: 300` is an estimate).

## Decisions already made
- Select a GP-200 patch with `0x1008` only, never CC/PC, until the CC0 polarity is verified.
- Keep the official editor's full sync sequence (including drum/style reads) as the hardware-safety baseline.
- The effect catalog is built from the user's own `algorithm.xml` and never shipped (vendor data).
- `DeviceDriver` capabilities stay optional, plus a `features` list; the families implement different subsets.
- A GP-200 `.prst` is never converted to or from the GP-5 family (no model mapping).
