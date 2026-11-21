# Custom effects and sharing by hash

Status: **analysis and proposal**, 2026-11-21. Surveys the public GitHub projects around Valeton pedals and their firmware tools, then asks two questions for **every supported model and every kind of effect**: can users create their own, and how can they share them by content hash or through a community. It feeds the [product plan](PRODUCT-PLAN.md) (item B6) and the [Community plan](community-plan.md).

Scope: GP-5, GP-50, GP-200, GP-200LT, GP-200JR, GP-150, GP-180. "Effect" means each thing a user can make and pass on: a single effect block with its settings, a chain of blocks, a whole preset, a bank of presets, a SnapTone, a user IR, a firmware mod and a firmware.

Evidence comes from the repositories' own READMEs and docs read on 2026-11-21 (star counts and dates change). Nothing here was tested on a pedal. Where a claim is an inference it says so.

## 1. Summary

1. **On Valeton's own firmware nobody can write a new effect algorithm, on any model.** What users create is data: settings, chains, presets, SnapTones, IRs. Algorithms are code inside the firmware.
2. **Changing the firmware itself exists for three families, at different depths.** GP-5: a complete open firmware with a C framework, [OpenGP5](https://github.com/OpenGP5/OpenGP5) (MIT, alpha). GP-200 and GP-200LT: a browser patcher that applies a fixed set of reverse-engineered mods to Valeton's image (tuner, tap tempo, output balance, labels, languages), not new DSP. GP-50 and GP-5 translations: string patches. **GP-150 and GP-180: no firmware tooling found.**
3. **Sharing by content hash works the same way on every model** if it sits above the family codecs this app already has. Presets, blocks, chains, banks, SnapTones and IRs are validated data; firmware is code and needs stricter trust rules.
4. **Recommendation:** build one family-independent share layer (canonical hash, bundle, import check) first, with a repository catalog and no server. Treat firmware as interoperability only: detect it, refuse to speak Valeton protocol to what it cannot identify, link to the right tool. Do not flash or patch firmware from this app.

## 2. What exists on GitHub

Search of topic `valeton` and keyword searches; stars and last push as of 2026-11-21.

| Repository | Stars | License | Last push | What it is | Models |
|---|---|---|---|---|---|
| [Builty/TonexOneController](https://github.com/Builty/TonexOneController) | 434 | Apache-2.0 | 2026-11-19 | ESP32 controller (touch screen, WiFi, footswitch, Bluetooth, MIDI) for the IK Tonex One and Tonex pedal; GP-5 support since V2.0.2.2 | GP-5 |
| [OpenGP5/OpenGP5](https://github.com/OpenGP5/OpenGP5) | 28 | MIT | 2026-11-20 | open firmware platform v0.8.0 alpha: NAM Loader, Dreamcatcher, Tremolo example; firmware catalog; web flasher | GP-5 |
| [OpenGP5/Launchpad](https://github.com/OpenGP5/Launchpad) | n/a | MIT | recent | desktop app v0.3.0 alpha: flash, load NAM and IR, edit presets, live editing from a firmware's own parameter list, backups, mods to Valeton firmware V1.0.6 | GP-5 |
| [tntexplosivesltd/gp200-patcher](https://github.com/tntexplosivesltd/gp200-patcher) | 23 | see repo | 2026-10-17 | offline browser page that applies eight optional mods to Valeton's firmware image and recognises the pedal by the image's SHA-256; only the built page is published, not the reverse-engineering source | GP-200, GP-200LT |
| [kabir0st/gp200-studio](https://github.com/kabir0st/gp200-studio) | 30 | GPL-3.0 | 2026-09-25 | browser editor, patch manager and loop station; no account, no upload, no server | GP-200 family |
| [drewmerc302/valeton-gp50](https://github.com/drewmerc302/valeton-gp50) | 20 | MIT | 2026-10-26 | browser editor with preset explorer, reorder, **make a template from a preset**, GP-5 to GP-50 converter, capture usage lookup | GP-5, GP-50 |
| [drewmerc302/nam-a2a1-converter](https://github.com/drewmerc302/nam-a2a1-converter) | 18 | none | 2026-08-02 | distills NAM A2 captures into GP-50-ready A1 files | GP-50 |
| [helvecioneto/gp5-wc](https://github.com/helvecioneto/gp5-wc), [jmiskovic/webgp-200](https://github.com/jmiskovic/webgp-200), [fsanchezlme97-ui/gp5-editor](https://github.com/fsanchezlme97-ui/gp5-editor), [leocosta1/pocket-cortex](https://github.com/leocosta1/pocket-cortex) | 0 to 17 | mixed | 2025 to 2026 | small web editors and controllers | GP-5, GP-50, GP-200 |
| [majabojarska/Valeton-GP180-Rev-Eng](https://github.com/majabojarska/Valeton-GP180-Rev-Eng) | 1 | GPL-3.0 | 2026-09-02 | reverse-engineering notes, already credited by this app | GP-150, GP-180 |
| [lshug/valeton-gp200-english-patch](https://github.com/lshug/valeton-gp200-english-patch), [kosmo-sys/valeton-english-patch](https://github.com/kosmo-sys/valeton-english-patch), [pagueobaixista-afk/valeton-gp5-ptbr](https://github.com/pagueobaixista-afk/valeton-gp5-ptbr) | 0 to 12 | GPL-3.0, MIT | 2026 | string-table translations; the GP-200 image is checksummed | GP-50, GP-5, GP-100, GP-200 |
| [flameshikari/valeton-unlocker](https://github.com/flameshikari/valeton-unlocker) | 2 | MIT | 2026-11-18 | browser tool that changes a pedal's language and can generate activation codes for a device-bound lock | GP-5 tested |
| [cesardamien/hotone-family-firmware-fix](https://github.com/cesardamien/hotone-family-firmware-fix) | 3 | MIT | 2026-09-03 | Windows 11 fix for Valeton, Hotone and Sonicake pedals not detected | all |

Reading: a small, active community that is moving from "editor" toward "open firmware". It is uneven: the GP-5 has a full platform, the GP-200 family has binary mods, the GP-150 and GP-180 have only protocol notes.

## 3. Firmware tools and what they can change

### 3.1 Levels of change, per model

| Level | What it changes | GP-5 | GP-50 | GP-200 / LT | GP-200JR | GP-150 / GP-180 | Risk |
|---|---|---|---|---|---|---|---|
| **0. Presets, blocks, chains** | existing blocks and their settings | yes | yes | yes | yes | yes | low: validated, backed up, read back |
| **1. Captures** | SnapTone (NAM) and IR files | yes | yes | yes; LT SnapTone unknown | IR; SnapTone unknown | SnapTone 50, IR 20 | low to medium: size and conversion limits |
| **2. Firmware mods** | behaviour or text inside Valeton's image | strings (translations), Launchpad "Mods" | strings | eight binary mods (patcher) | none found | none found | medium: a bad image can brick; GP-200 images are checksummed; some units refuse images with changed labels |
| **3. Replace the firmware** | everything the pedal runs | OpenGP5 | none found | none found | none found | none found | high, with a documented recovery path |

New signal processing exists only at level 3, and only for the GP-5.

### 3.2 OpenGP5 (GP-5)

Facts from its README and docs:
- **What it is.** Code for both processors written from scratch under MIT; "nothing in it comes from Valeton or the chip vendor"; the user can go back to Valeton's firmware. Alpha; at least four GP-5s run it, per its known-limits page.
- **How an effect is written.** Plain C: a manifest (`firmware.json`), a settings list (`params.h`), the sound (`dsp/firmware.h`, one function per 64-sample block) and the controls and screen. The platform stores settings and presets and lets a computer list and change them, so Launchpad builds an editor for any firmware with no code of its own for it.
- **Budget.** DSP about 19.7 KB variables, 123 KB buffers, 38.9 KB code; control processor about 258 KB RAM; about 300 KB storage with at most 64 presets; at most about 250 parameters, each a 16-bit integer; mono in, stereo out; C only; a 160 by 80 screen.
- **Trade-offs.** A firmware replaces Valeton's amp models, presets and Bluetooth. SnapTones and IRs on Valeton's firmware cannot be backed up by its tools. Rarely, recovery needs a debug adapter and soldering.
- **Distribution.** A repository catalog: one JSON per firmware (`id`, author, repo, license, releases with `url`, `sha256`, `size`, platform). CI downloads each release and checks hash, size and the image's own metadata. Outside listings show "Not reviewed by OpenGP5"; the checks do not examine what the code does.
- **Wire protocol.** The same nibble SysEx framing and CRC-8 as the GP-5 family, with its own command class (`0x7E`) for identity, live parameters and presets. Inference: a tool that assumes a stock GP-5 could send Valeton commands to a pedal running other firmware.

### 3.3 GP-200 patcher

A single offline HTML page. It identifies the pedal from the firmware image's SHA-256, offers only the mods that exist for that image, patches client-side and lets the user download the result. Mods are fixed features (strobe tuner, carry-over tap tempo, output balance, footswitch labels, faster patch change, language unlock and Portuguese, reset cleanup). Source of the mods is not published. Useful lessons: identify by hash, keep the stock file, support only known versions, and releases that change version labels can be refused silently by newer boot software.

### 3.4 Translations and the unlocker

The translation projects replace Chinese strings at the same byte length. The unlocker can generate activation codes for a language lock tied to a device ID. That is a vendor control; this project should not include it. If users ask, point to those projects.

## 4. Creating your own effects

### 4.1 What a user can create, per model

| Thing to create | GP-5 | GP-50 | GP-200 / LT / JR | GP-150 / GP-180 | Needs |
|---|---|---|---|---|---|
| **Block setting** (one effect model with its parameters) | yes | yes | yes | yes | family codec and catalog |
| **Chain template** (blocks, order, settings, no name) | yes | yes | yes | yes | codec |
| **Preset** | yes | yes | yes | yes | codec |
| **Bank** (set of presets) | yes | yes | yes | yes | codec, slot rules |
| **SnapTone** | yes | yes | yes (LT and JR unknown) | yes | NAM conversion and size limit |
| **User IR** | yes | yes | yes | yes | resample and slot rules |
| **Firmware mod or firmware** | OpenGP5 | strings | patcher | none found | external tools |

### 4.2 Options for this app

| Option | What the user gets | Models | Effort | Fit |
|---|---|---|---|---|
| **A. Block and chain templates** | save a block with its settings, or a chain, as a named reusable item and apply it to any slot | all | S to M | proven by valeton-gp50 ("make a template"); fits the Rig |
| **B. Capture packs** | a SnapTone or IR with notes, a suggested chain and the source link, as one item | all with captures | M | fits Tones and the TONE3000 flow |
| **C. Generic editor for a firmware's own parameter list** | a Live editor generated from a firmware's description of its settings | GP-5 now; any family that offers it later | L | only if OpenGP5 is supported; overlaps Launchpad |
| **D. Flash or patch firmware from this app** | one app for everything | GP-5, GP-200 | L | overlaps existing tools; highest risk; not recommended |
| **E. Generate activation codes** | none | n/a | n/a | not recommended |

Recommendation: A and B for every model now; C after talking to the OpenGP5 maintainers; D and E not planned.

### 4.3 The family-independent design

The app already has one `DeviceProfile` per model, one driver per family (`gp5`, `gp200`, `gp150`), a catalog adapter and per-family codecs with sniffing and validation. Sharing adds one small layer on top, a **share codec per family** with three functions:
- `canonicalize(item)` returns the bytes that are hashed;
- `validate(item, device)` uses the family's existing codec checks (length, header, parse, catalog lookups);
- `apply(item, device, slot)` turns the item into the existing preset edit or write, so the backup and read-back already in the write path still apply.

Anything not in a family's share codec is refused for that model with a clear message. Cross-family items (GP-5 to GP-200) are refused until a model mapping table exists; the GP-5 to GP-50 and GP-200 to LT and JR conversions that already exist can be reused.

A block setting is shared by effect id and parameter values, not by vendor names or catalog text, so vendor data is never copied. A receiver without the GP-200 catalog (it is generated from the user's own `algorithm.xml`) can still apply a block, and the UI shows ids until the catalog is loaded.

## 5. Sharing by hash

### 5.1 What a hash identifies

A hash is useful when two people can compute the same one for the same thing. Files contain parts that differ without changing the sound, so hash a canonical form. Use SHA-256 shown in full, with a short prefix for display.

| Item | Source of difference | Canonical form (proposal) |
|---|---|---|
| GP-5 and GP-50 `.prst` (507, 552 bytes) | preset name in the file | file hash on exact bytes; sound hash with the name field zeroed |
| GP-200 family `.prst` (1224 bytes) | volatile bytes (`volatileMask` in `gp200/lib/prst.mjs` already defines them for write verification), name, author | file hash on exact bytes; sound hash with volatile bytes, name and author zeroed |
| GP-150 and GP-180 `.prst` | checksum algorithm unknown; the app clears it on edit | sound hash on the body without the checksum, name zeroed |
| Block or chain | item has no file | hash of a canonical record: `family`, effect ids in order, parameter values, no name |
| Bank | order and names | hash of the ordered list of sound hashes |
| SnapTone | converter version changes the pedal file | hash the **source** NAM file; record the converter version beside it |
| User IR | resampling and channel choice | hash the source audio and the prepared result separately |
| Firmware image | none | exact bytes, `sha256` (what OpenGP5's catalog and the GP-200 patcher use) |

Two hashes per item, **file** (integrity: these exact bytes) and **sound** (identity: same sound whatever the name), give safe download checks and de-duplication. The device store already hashes full preset bytes to detect unsaved changes (`slotHashes`), so the plumbing exists.

### 5.2 A share bundle

One file, for example `.vltnshare` (a zip), with a manifest:

```json
{
  "schema": 1,
  "kind": "preset",
  "family": "gp200",
  "devices": ["gp200", "gp200lt", "gp200jr"],
  "name": "Glass Clean",
  "author": "name or handle",
  "license": "CC-BY-4.0",
  "notes": "Strat, neck pickup",
  "files": [{ "path": "glass-clean.prst", "sha256": "…", "soundSha256": "…", "size": 1224 }],
  "signature": "optional author signature over the manifest"
}
```

`kind` is one of `block`, `chain`, `preset`, `bank`, `snaptone`, `ir`, `pack`. Import re-computes both hashes, validates with the family codec, shows what will be written and where, and only then reaches the existing write path. A mismatch refuses the import.

### 5.3 Where the community lives

| Model | How it works | Pros | Cons |
|---|---|---|---|
| **1. Files and links** | send a bundle by any channel; a link plus its hash | no infrastructure, private, works today | no discovery |
| **2. Catalog in a repository** | one JSON per item, added by pull request; CI downloads and checks hash, size, format and license (the OpenGP5 model) | no server or auth; review by pull request; history; free hosting | needs a GitHub account; a curator |
| **3. Server** (the Community plan) | upload, search, likes, reports | best discovery | backend, sign-in, moderation, legal cost |
| **4. Peer-to-peer** | fetch by hash from peers | no host | complexity, no moderation; unsuited to a small niche |

Order: 1 now, 2 when there is enough to browse, 3 only through the product plan's decision gate. Models 1 and 2 use the same bundle and hashes, so nothing is thrown away if a server comes later. The catalog index is one file per family, so the app lists only what fits the connected model.

### 5.4 Trust, safety and legal

| Concern | Presets, blocks, chains, banks | Captures and IRs | Firmware and mods |
|---|---|---|---|
| Can it harm the pedal? | not if validated by the family codec | low | yes: code that runs on the pedal |
| Rule | validate on the client always; sniff the device, never trust the declared one | check size and conversion before upload | never auto-flash; show source, author and hash; mark unreviewed; keep recovery steps in view |
| Copyright | parameter sets; artist names in titles can draw claims | the capturer's license; some IRs are commercial products | the author's license |
| Takedown | remove by hash; keep a hash blocklist so a removed item is not re-shared | same | same |
| Privacy | no account in models 1 and 2; author fields optional | same | same |

Assumption to verify before sharing captures: the TONE3000 terms and each capture's license decide whether redistribution is allowed. Link to the source page instead of copying the file unless the license says otherwise.

Author signatures (for example Ed25519 over the manifest) give "same author as before" without accounts. They do not prove content is safe, so they are optional for data and recommended but not sufficient for firmware.

## 6. How this fits the market and the plans

- **OpenGP5 is both threat and opportunity**, for the GP-5 only. It already offers captures, presets and backups in a desktop app. Differentiate on what it does not do: seven models, the song and stage side, a library across models. Cooperate on shared ground: the same `.prst` and SnapTone formats and possibly a common share format.
- **Other models have no equivalent.** For the GP-200 family the patcher is a closed set of mods; the GP-150 and GP-180 have nothing. Data-level sharing is therefore where all models can be served equally, and it is the gap no tool fills.
- **Safety gap to close regardless.** If a pedal runs firmware this app does not recognise (OpenGP5 on a GP-5, a patched GP-200 image), the app must not assume stock behaviour. Needed first, for every family: record what each pedal's identity and version replies look like on stock firmware, detect a reply that does not match, show "custom firmware", and block writes until the user chooses. Test with the simulators and with the maintainers or owners of such units.
- **The Community plan stands but is not the first step.** Section 5.3 turns it into a staged path.

## 7. Proposed work

Added to the [product plan](PRODUCT-PLAN.md); IDs continue its numbering.

| ID | Work | Scope and acceptance | Size | Phase |
|---|---|---|---|---|
| C1 | Firmware awareness, all families | record stock identity and version replies per model; detect a mismatch; show "custom firmware"; block Valeton writes to it; simulator test per family | M | 1.1 |
| C2 | Canonical hashes per family | file and sound hash as in 5.1 for presets, blocks, chains, banks; fixtures that differ only in name, author or volatile bytes give equal sound hashes | S to M | 1.3 |
| C3 | Share bundle, export and import | the manifest in 5.2 for every kind; import validates, previews, writes through the existing gate, refuses on mismatch; tested on every family | M | 1.3 |
| C4 | Block and chain templates | save and apply per family, shared as bundles | S to M | 1.3 |
| C5 | Capture pack | SnapTone or IR with notes, suggested chain, source link, license field | M | 1.3 |
| C6 | Catalog repository | public repository of bundles; CI checks hash, size, format and license; "not reviewed" label; the app reads one index per family | M | 1.4 |
| C7 | Open firmware interoperability | talk to the OpenGP5 maintainers; if they agree, a generic Live editor driven by a firmware's own parameter list; for other families, revisit when tooling exists | L | decision first |
| C8 | Server | only through the product plan's decision gate | XL | later |

Not planned: flashing or patching firmware, generating activation codes.

## 8. Risks and open questions

| Risk | Mitigation |
|---|---|
| A shared item is malformed or targets the wrong model | sniff the device, validate with the family codec, preview, back up, read back |
| Hash scheme changes after items are shared | `schema` number in the manifest; the file hash stays exact so old bundles stay verifiable |
| Different families need different canonical rules | one share codec per family with its own fixtures; unsupported kinds are refused, not guessed |
| Redistribution of captures breaks a license | link to the source by default; require a license field; blocklist by hash |
| Duplicate effort with Launchpad and other editors | agree on shared formats; focus on other models and the song side |
| A firmware project changes its protocol while in alpha | support it only through its own identity and parameter commands; ask first |

Open questions:
1. Is the audience for custom DSP effects large enough to justify C7? Today at least four GP-5 users report running OpenGP5, and there is no equivalent for other models.
2. Which license should shared items default to? This is question 2 of the Community plan too.
3. Does the maintainer want a bundle format owned by this project, or one agreed with OpenGP5?
4. Who curates a catalog repository?
5. Which family goes first for C3? Suggested: the GP-200 family (one `.prst` for three models, and the codec already has the volatile mask), then GP-5 and GP-50, then GP-150 and GP-180.

## Sources

Read 2026-11-21.

- [OpenGP5 README](https://github.com/OpenGP5/OpenGP5), and in the same repository its catalog README and `docs/platform/known-limits.md`, `params.md`, `concepts.md`, `protocols.md`
- [OpenGP5 Launchpad README](https://github.com/OpenGP5/Launchpad)
- [GP-200 patcher README](https://github.com/tntexplosivesltd/gp200-patcher)
- [TonexOneController README](https://github.com/Builty/TonexOneController)
- [valeton-gp200-english-patch](https://github.com/lshug/valeton-gp200-english-patch), [valeton-english-patch](https://github.com/kosmo-sys/valeton-english-patch), [valeton-unlocker](https://github.com/flameshikari/valeton-unlocker)
- [gp200-studio](https://github.com/kabir0st/gp200-studio), [valeton-gp50](https://github.com/drewmerc302/valeton-gp50), [nam-a2a1-converter](https://github.com/drewmerc302/nam-a2a1-converter)
- Repository search: `gh search repos --topic valeton` and keyword searches
