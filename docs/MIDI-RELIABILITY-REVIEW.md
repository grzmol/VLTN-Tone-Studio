# MIDI reliability review — updated 23 October 2026

This review covers Performance cue/clock scheduling, Bluetooth queueing and connection loss, transport input/output, and playlist MIDI session carry-over in PR #30. It is a source review with automated fault injection, not another physical-pedal session or a certification for stage use.

## Current implementation

Latest implementation validation: **813 application tests passed, 3 skipped**, across **103 files**; typechecking and production build passed. The earlier protocol suite passed **159 tests**. The 22 October counts below are historical.

Scheduling uses a prewarmed worker with 20 ms ticks, 50 ms lookahead, audio checkpoints and a renderer output bridge. Prepared-worker failures are checked before use. Missing start acknowledgement or ongoing worker responses for more than 250 ms trigger the same disarm and queue cleanup as other scheduler faults. Timing counters describe app dispatch, not pedal receipt.

**Reset timing counters** clears app and Bluetooth performance/clock measurements, including retained disconnected-session timing. It preserves traffic totals, the connection and queued messages; an in-flight write cannot restore timing from before the reset.

Preflight is advisory: Performance checks the loaded song, and Songs & playlists offers a whole-playlist saved-data check. Stage-mode sleep prevention is implemented. Configurable remote input channels and portable rig definitions are not implemented. GP-150 shares the command set, but the physical results remain GP-180-specific. USB editor writes no longer require a special unlock and still need physical write/readback validation.

## Final workflow review — 23 October 2026

A fresh focused run passed **83 tests across 7 files**: PerformancePanel, PlaylistPlayback, song library state, library storage, backup/restore, scheduler client and Bluetooth connection. No additional defect was found in these checked paths. The branch merged cleanly with fetched upstream main in a merge-tree check, and local guide file links resolved. This pass changed documentation only, so the full-suite/build results above refer to the unchanged implementation rather than a new full run. Physical hardware and packaged cross-platform checks remain outstanding.

## Confirmed defects corrected

| Failure | Correction |
| --- | --- |
| A renderer pause could replay every missed PC/CC/note cue immediately on resuming. | Poll gaps, overdue cues and frozen audio time are checked against a 250 ms interruption limit. MIDI disarms, pending commands clear and audio continues; the user checks the rig before explicitly rearming. |
| A GATT write could remain pending forever and block every later command. | Each packet write has a one-second deadline. Failure closes the connection and discards queued work without retrying uncertain delivery. |
| Commands could accumulate behind a slow Bluetooth write and execute long after their cue. | Commands over 250 ms late at dispatch close the connection instead of producing a catch-up burst. The existing 256-command queue bound remains. |
| A connected USB output object replacing another under the same ID could inherit arming. | Arming is bound to the exact connection object, including playlist carry-over. Replacement outputs require explicit rearming before any send. |
| Pause and effect cleanup could both clear the queue; the second clear cancelled the first BLE note releases. | Cleanup is idempotent until another performance message is sent. Note releases and transport Stop survive the duplicate cleanup. |
| A transport Stop echoed through a pedal could repeatedly generate another outgoing Stop. | Stop while already stopped does not retransmit Stop. This does not make arbitrary MIDI feedback routing safe. |
| The lookahead could enqueue a chart cue beyond the audio end. | Cue lookahead is clamped to audio duration. |

The 250 ms limit is a conservative interruption policy, not acceptable timing jitter for a delay or a timing guarantee. Most individual commands must arrive far closer to their cue. Commands already handed to hardware cannot be cancelled reliably; after a link failure the operator must verify actual pedal state.

## Historical validation — 22 October 2026

- Full Windows application suite: **779 passed, 3 skipped**, across 97 files.
- Focused Performance/Bluetooth lifecycle suites: **36 passed**, including eight new fault regressions.
- Protocol toolkit: **159 passed**. Typechecking, production build and local guide-link checks passed.
- Tests simulate blocked/slow GATT writes, stale cues, frozen audio time, replacement USB outputs, transport feedback, duplicated cleanup and cues beyond audio duration. Receiver timing, USB driver behavior and physical pedal reactions were not retested in this pass.

## Recommended live setup

1. Keep continuous app clock off for the tested GP-180/TimeLine rig. Both BLE and USB continuous clock failed the earlier hardware test. Use one-time GP-180 song tempo with the pedal's Internal clock and TRS clock output On. This establishes tempo, not shared beat phase.
2. Use distinct device channels and verify program numbering. The downstream defaults are TimeLine 1, RC-10R 2, IR-200 3 and SY-200 4. Test GP-180 channel 16 rather than OMNI, updating both its command-builder channel and existing cues, to avoid recalling the GP-180 when addressing another pedal. This isolated configuration has not yet been physically retested.
3. Rehearse the complete playlist with the actual pedal chain, including start-position patch/tempo order, every looper/assignable command and the end of the set. Loading songs is sequential and not gapless.
4. Prepare analysis and backups before performing. Keep Bluetooth close, close its phone app and avoid parallel MIDI editor/write traffic. Rehearse USB as the wired command alternative; this does not validate its continuous clock.
5. Test Pause, Panic, disconnect/reconnect, sleep/resume and the on-screen failure recovery. Reconnection must remain disarmed. Inspect latched notes/loopers on the actual pedals after every injected failure; do not replay old triggers blindly.

## Further robustness work, in priority order

Preflight warnings, queue timing counters and a dedicated worker scheduler are now implemented; see [Performance](../PERFORMANCE.md#midi-preflight-and-timing-diagnostics). The worker is prepared before armed audio playback and cancelled on stop, seek or replacement. Renderer output bridging and audio checkpoints remain necessary, so driver/receiver timing and real-time guarantees remain outside this implementation. Reported timing measures queueing, not pedal receipt. Hardware results above remain GP-180-specific; the shared command set also supports GP-150.

- **Session continuity:** centralize MIDI output ownership and recovery across screen changes and playlist loading. Stage mode now supplies a playback-only sleep blocker with cleanup; explicit suspend/resume handling remains a follow-up. Disconnection or timing failure must invalidate the carried playlist session synchronously.
- **Hardware fault matrix:** repeat Bluetooth/USB commands on real GP-180 and all downstream pedals under CPU load, range loss, cable loss, repeated playlist entries and long-running sets. Include explicit note-offs and looper trigger counts. Automated tests cannot establish receiver latency or physical MIDI forwarding behavior.

The Web MIDI specification defines equal-timestamp send ordering and queue clearing, but it does not provide a pedal-delivery acknowledgement. See the [W3C MIDIOutput contract](https://www.w3.org/TR/webmidi/#midioutput-interface).

## Shared-model update validation - 23 October 2026

Full Windows suite: **812 passed, 3 skipped**, across **103 files**. All **159 protocol tests**, typechecking and production build passed. Bluetooth discovery covers both model names; command tests verify shared banked recalls and tempo bytes, and preflight recognizes both models. Prior counts above describe earlier review runs. No new physical-pedal test was performed.

## Playlist preflight update — 24 October 2026

Whole-playlist preflight is now implemented under Songs & playlists, superseding the earlier recommendation to add it. It validates saved file metadata and charts/tempo/MIDI per entry, including repeated songs, without playback or MIDI transmission. The Performance panel still checks its loaded song. See [the playlist guide](../SONG-LIBRARY.md#whole-playlist-preflight) for snapshot limits and what remains a physical check.

Validation for playlist preflight: **821 application tests passed, 3 skipped**, across **105 files**; typechecking and production build passed. The 12 focused preflight/storage/UI tests include repeated entries, missing/truncated audio, malformed cues, incompatible tempo, playback-duration matching and stale-response suppression. No physical MIDI was sent.

## Stage mode update — 24 October 2026

Stage mode is implemented, superseding the earlier stage-mode/seek-lock/sleep-prevention recommendations. The modal reader hides setup and editing, disables seeking/rewind/chord popups, preserves transport and Panic, and persists across song transitions. Desktop sleep prevention uses renewable leases with pause/exit/crash cleanup. Browser sleep prevention and a real OS sleep-policy test are not claimed. See [Stage mode](../PERFORMANCE.md#stage-mode).
