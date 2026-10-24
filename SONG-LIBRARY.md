# Saved songs and live playlists

In the desktop app, open **Song → Songs & playlists**.

1. **Import audio**, then prepare stems and the Performance chart/lyrics as needed.
2. Enter the song title and artist and choose **Save song to library**. Use **Save song changes** after subsequent edits or a new split.
3. Create a playlist and add songs from the library. Entries can repeat. Use the up/down buttons to set the order. Playlist edits save immediately; removing an entry does not remove the song.
4. Choose **Play playlist** to perform the whole set, or **Play from here** on an entry to start partway through. Performance loads and starts each next song automatically, then stops after the last entry. It shows the current position, next title, **Previous song / Next song**, and **Stop playlist**. Pause/resume controls the set; skipping while paused loads the destination paused. **Load set paused** remains available for preparation. The queue uses a snapshot of the selected playlist order.

Songs restore their saved BPM, MIDI Clock preference, chart, lyrics and mix. The global metronome follows each song. Audio loads between songs, so this is automatic sequential playback rather than gapless playback. Stop can cancel a pending next-song load; loading errors stop the set and show a message. Leaving Performance pauses the playlist.

## What is saved

Each saved song has a unique ID independent of its filename. The library copies decoded source audio and all available stems as lossless planar float32 PCM; the original MP3 and NAS files are not modified or needed to reopen the song. It also saves the editable chord/MIDI chart, separate lyrics text track, BPM, transpose, chord-source override, metronome settings (including first-beat alignment) and stem mixer volume/mute/solo state. Stems and Performance share the saved mix. Song-key estimates and manual key corrections are included in the performance options. Background lyrics/key updates that complete while audio is being saved are promoted into the saved song rather than replaced with the earlier settings snapshot.

MIDI port preferences are remembered globally on this computer; they are not part of a saved song or exported chart. Cue arming and active playback are never saved to disk. Manually reopening a song starts disarmed. During a running playlist, an explicitly armed MIDI output carries across songs for that set, provided the same output remains connected. A disconnected or replacement device stays disarmed until enabled again. To send MIDI cues from the first instant of the set, choose **Load set paused**, connect and enable **Send cues** once, then press **Play playlist** in Performance. Returning to the library and starting a new playlist clears the carried MIDI session; arm it again before expecting cues. GP-150 and GP-180 USB editor sessions allow changes without a write-unlock switch. Bluetooth MIDI remains available for performance controls; Bluetooth editor management is disabled. Text/settings edits of a saved song are captured when moving to another saved song; use **Save song changes** before quitting to explicitly save all edits and newly generated audio. Completed automatic lyrics are written back to the saved song even if you switch tabs during transcription.

The data lives under `%APPDATA%\VLTN Tone Studio\song-library` on Windows. `library.json` holds the song and playlist metadata. UUID-named directories hold the audio revisions. Do not rename files inside this folder. Use the portable backup controls below, or close the app and copy the complete folder; metadata-only copies do not contain audio. Float32 storage is large: a 4:28 stereo song with six stems uses approximately 661 MB.

A save writes every audio asset before atomically replacing the index. Incomplete saves do not replace a previously saved song. Interrupted operations can leave unreferenced audio directories; automatic recovery/garbage collection is not implemented. Deleting a song removes it from playlists and deletes its managed audio; it never deletes the imported source. The UI requires a second confirmation for song/playlist deletion. Deleting a playlist keeps its songs.

## Portable backup and restore

In **Song → Songs & playlists**, use **Export library backup…**. Choose where to save the `.tar.gz` archive. It includes every saved song's copied source audio, available stems, chord/MIDI chart, separate lyrics, BPM, key estimate/manual correction, mixer/performance options, and all playlists with their order and repeated entries intact. Original audio/NAS files are not needed to restore it.

Save a newly imported song or new stem split before exporting. Current local text/settings edits to an already-saved song are flushed before the backup begins. Audio and metadata are then exported as one consistent snapshot. Later edits and transcription results belong to a subsequent backup. The UI shows file-based progress while the main process streams the audio; the whole library is not copied into renderer memory.

On this or another computer, choose **Restore backup as new copies…** and select the archive. Existing songs and playlists are kept. Restored songs/playlists receive fresh IDs, and repeated playlist entries point to the corresponding restored song. Restoring the same archive again creates another set of copies. Nothing starts playing or arms MIDI automatically. Connect and configure outputs on the destination computer.

The archive includes `backup-manifest.json`, `library.json`, and referenced UUID audio directories. SHA-256 checksums, byte lengths, metadata, playlist references and every file path/type are checked before the restored library index is published. Links, duplicate/undeclared files and paths outside the expected audio layout are rejected. A failed restore does not replace the existing index. Export writes a temporary archive beside the chosen destination and only replaces the destination after compression succeeds, so a failed export preserves an earlier backup.

MIDI device/port preferences, cue arming, custom/OpenMIDI pedal definitions, account credentials, downloaded analysis models and application-wide preferences are not included. Song MIDI cues retain their actual commands, channels and labels and do not require the original pedal profiles for playback. This exports the song library, not a backup of physical pedal presets.

The first archive format supports up to 50,000 declared files, 512 GiB of uncompressed content, and 8 MiB each for metadata/manifest. Backups can still be large because they include full float32 audio. Allow free space for the compressed archive when exporting, and for all restored audio when importing. Keep the app open until completion. Interrupted operations can leave temporary archives or unreferenced staging directories; automatic resume/garbage collection is not implemented.

## Whole-playlist preflight

Select a playlist under **Song → Songs & playlists**, then choose **Check playlist** before the set. Save song changes first: the report checks saved songs, not unsaved edits or newly split audio. It does not load or play a song, change cues, arm an output or send MIDI.

The report lists each entry in order, including repeats. It checks for missing songs and audio assets, incorrect PCM file sizes, malformed charts/settings, invalid or unsupported tempo, continuous-clock/automatic-tempo conflicts, and the existing cue/channel warnings (including past-end cues, missing note-offs and dense/conflicting commands). Audio checks use file metadata without transferring the recordings into renderer memory. They do not detect same-size audio corruption or assess sound quality.

Errors and warnings are advisory and do not block intentional playback. The report uses current saved MIDI preferences and configured pedal channels; it cannot confirm a connected output, physical receive channels or pedal response. Playlist/library or MIDI preference changes clear the report. Recheck after external file changes. Preflight is unavailable while a library operation or playlist playback is active.

## Stage mode

Prepare the song or playlist, check the output and arm MIDI as needed, then choose **Enter stage mode** in Performance. Stage mode fills the window with larger lyrics and transport buttons. It keeps MIDI status and faults visible, hides setup/mixer/editor controls, and disables seeking, rewind and chord popups. It does not arm MIDI or change the song BPM. The stage view stays active across automatic playlist transitions.

**Play/Pause**, **Stop playback** and **Panic / stop MIDI** remain accessible. Panic pauses playback/the set, clears queued MIDI and disarms cues using the existing cleanup rules. It cannot reverse commands already received by a pedal. Use **Exit stage mode** to seek, edit, change the mix or reconnect/rearm; Escape and outside clicks do not accidentally unlock the stage view. Leaving the Performance screen resets stage mode.

In the desktop app, active stage playback requests system/display sleep prevention. Pausing, finishing the set, exiting stage mode or leaving Performance releases it. Requests renew during playback and expire after 15 seconds without renewal; closing the window or a renderer crash also clears them. The browser build reports that sleep prevention is unavailable. This does not override deliberate sleep, lid-close behavior or system power policy.
