# PR review — updated 23 October 2026

## Current status

The latest implementation validation passed **813 application tests, 3 skipped**, across **103 files**, plus typechecking and the production build. The earlier protocol run passed **159 tests**. The dated results below are historical checkpoints, not cumulative test totals.

The two subsequent review findings are corrected: a worker that failed after becoming ready cannot be reused, and missing start/heartbeat responses trigger MIDI fault cleanup; resetting timing now clears both app and Bluetooth timing without cancelling queued messages, including when a write is already in flight.

GP-150 and GP-180 share editor/preset/performance support while retaining separate model identities and footswitch layouts. The temporary GP-180 write guard and unlock setting are removed. Hardware evidence still covers GP-180 reads/backups and GP-180/TimeLine performance commands; enabling editor writes does not establish physical write validation. Bluetooth editor management remains disabled.

## Remaining checks and useful additions

Before release, exercise editor write/readback on the real GP-180, validate GP-150 hardware, rehearse long playlists and MIDI fault recovery on the actual chain, and test packaged backup/restore on a second computer. No new physical-pedal test was performed in this review.

The highest-value remaining additions are configurable input channel/footswitch mappings, next-song preloading and transition/count-in options, portable rig definitions, and exportable timing reports. These remain recommendations, not implemented features. Preflight is advisory: Performance checks the loaded song, and Songs & playlists checks the whole saved playlist; backup contains song cues but excludes global MIDI routing and pedal definitions.

## Final workflow review — 23 October 2026

A fresh focused run passed **83 tests across 7 files**: PerformancePanel, PlaylistPlayback, song library state, library storage, backup/restore, scheduler client and Bluetooth connection. No additional defect was found in these checked paths. The branch merged cleanly with fetched upstream main in a merge-tree check, and local guide file links resolved. This pass changed documentation only, so the full-suite/build results above refer to the unchanged implementation rather than a new full run. Physical hardware and packaged cross-platform checks remain outstanding.

## Historical review — 22 October 2026

## Scope

Reviewed the changes against upstream main across desktop Bluetooth selection/permissions and IPC, managed song/audio storage, playlist transitions, performance audio/MIDI scheduling, pedal profiles and OpenMIDI import, GP-180 inspection and the then-active write guards, recognition workers, documentation and dependency/build changes. Existing protocol and regression tests supplement source review; this review did not send commands to physical pedals.

## Issues corrected in this pass

- Untimed bracket chords were removed from the combined reader. They now remain visible, transposable and clickable; their tooltips do not show invalid timestamps. Timed MIDI rows sort consistently before untimed reading text.
- Incomplete/empty MIDI tokens were silently omitted. The chart parser now rejects them so playback cannot give a false impression that a malformed cue will execute.
- Background transcription/key updates finishing during the first audio save could be overwritten by the earlier settings snapshot. The saved song now receives the latest local settings after the audio copy completes.
- Reopening Performance cleared a saved automatic key while its worker ran. The previous same-source estimate now remains available until replacement, including if the worker fails.
- Pause/panic sent sustain-off CC64 on every channel, conflicting with the GP-180 looper Stop mapping. Note release is now limited to channels where the app actually queued note messages. Pending output is still cleared and enabled MIDI clock still sends Stop.

Each behavioural fix has regression coverage. Final local checks on Windows:

- `npm --prefix app test -- --maxWorkers=2 --testTimeout=20000`: **756 passed, 3 skipped**, across 95 files.
- `npm --prefix app run test:toolkit`: **159 passed**.
- `npm --prefix app run typecheck` and `npm --prefix app run build`: passed.
- Local guide links: no missing targets. Generic browser captures were visually checked.

The extended test timeout accommodates the protocol simulators on this Windows host. These are local results, not a claim of packaged-release or new physical-pedal verification.

### Portable library backup validation

The subsequent backup feature passed the full Windows suite: **770 passed, 3 skipped**, across 97 files. An additional publication-failure rollback test was added afterward; all **11 backup archive tests** passed, including exact PCM/settings/playlist round trips, repeated imports, highly compressed silence, corrupt/truncated archives, unsafe paths/links, and cleanup after a failed index publication. Typechecking and the production build passed. Native file-picker cancellation and renderer progress/listener handling have automated coverage; packaged cross-platform transfer testing remains a release check.

## Generic previews

The subsequent [MIDI reliability review](MIDI-RELIABILITY-REVIEW.md) documents fault-injection findings, queue/transport fixes and remaining live-performance work. It supersedes the earlier MIDI cleanup implementation details above where noted; the physical-pedal evidence remains unchanged.

[Performance, command builder and guitar tabs](screenshots/README.md) use fictional text and synthetic audio. Playback was paused; MIDI was disarmed. The captures show real UI components, not connected-device results. No reference application, user song text, preset names or device identifiers are included.

## Recommended follow-ups

1. **First-beat offset:** allow the recording's first real downbeat to anchor the metronome when there is silence or an unmetered intro. Current beat zero is audio time zero.
2. **Stage mode:** now implemented with seek/edit locks and sleep prevention; a real OS sleep-policy check remains outstanding.
3. **Recognition evaluation:** compare keys/chords/lyrics with reviewed real-song annotations, including relative minor, modes, detuned guitars and key changes. Existing synthetic tests are not an accuracy benchmark.
4. **Storage management:** portable library export/restore is now implemented; automatic cleanup of abandoned audio revisions and resumable transfers remain follow-ups. See [the library guide](../SONG-LIBRARY.md#portable-backup-and-restore).

The remaining follow-ups are recommendations; completed work is identified above. Cross-platform packaged builds, GP-180 editor writes and the full pedal-action catalogue still need their own hardware/release verification. Continuous app MIDI clock remains unsuitable for the tested GP-180/TimeLine rig; use the documented one-time tempo setup.

## Shared-model update validation - 23 October 2026

Full Windows suite: **812 passed, 3 skipped**, across **103 files**. All **159 protocol tests**, typechecking and production build passed. Bluetooth discovery covers both model names; command tests verify shared banked recalls and tempo bytes, and preflight recognizes both models. Prior counts above describe earlier review runs. No new physical-pedal test was performed.

## Playlist preflight update — 24 October 2026

Whole-playlist preflight is now implemented under Songs & playlists, superseding the earlier recommendation to add it. It validates saved file metadata and charts/tempo/MIDI per entry, including repeated songs, without playback or MIDI transmission. The Performance panel still checks its loaded song. See [the playlist guide](../SONG-LIBRARY.md#whole-playlist-preflight) for snapshot limits and what remains a physical check.

Validation for playlist preflight: **821 application tests passed, 3 skipped**, across **105 files**; typechecking and production build passed. The 12 focused preflight/storage/UI tests include repeated entries, missing/truncated audio, malformed cues, incompatible tempo, playback-duration matching and stale-response suppression. No physical MIDI was sent.

## Stage mode update — 24 October 2026

Stage mode is implemented, superseding the earlier stage-mode/seek-lock/sleep-prevention recommendations. The modal reader hides setup and editing, disables seeking/rewind/chord popups, preserves transport and Panic, and persists across song transitions. Desktop sleep prevention uses renewable leases with pause/exit/crash cleanup. Browser sleep prevention and a real OS sleep-policy test are not claimed. See [Stage mode](../PERFORMANCE.md#stage-mode).

Stage-mode validation: **827 application tests passed, 3 skipped**, across **107 files**; typechecking and the production build passed. Tests cover transport locks, Panic, song transitions, sleep-lease renewal/expiry and renderer cleanup. Actual OS sleep/wake behavior remains untested.
