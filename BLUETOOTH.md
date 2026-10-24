# Bluetooth MIDI and GP-150 / GP-180 USB support

## GP-150 and GP-180 support

GP-150 and GP-180 share the editor protocol, preset format and performance MIDI command set. GP-150 has two footswitches and a built-in expression pedal; GP-180 has three footswitches. Both are supported over USB and for Bluetooth performance MIDI. Separate model identities and footswitch layouts are preserved. The command builder offers both models, and setup presets cover both. Existing GP-180 saved settings and cues remain compatible. Physical validation in this project used GP-180; GP-150 has not been hardware-tested in this session.

Configure the MIDI-capable EXP/FS jack for your model. GP-180-specific jack numbers and hardware results below describe the tested rig.

## Supported connections

Use **Connect Bluetooth MIDI** in Device or Song → Performance to select a device advertising the standard BLE-MIDI service. The desktop app provides a device chooser; supported browsers use their own chooser. Bluetooth audio and Bluetooth MIDI are separate services.

Bluetooth MIDI remains available for performance cues, transport input and MIDI clock. **Bluetooth editor management is disabled.** Connect by USB to inspect or manage presets and pedal settings. There is no Manage GP-180 action over Bluetooth, and editor connection requests using that transport are rejected.

The BLE-MIDI transport implements timestamp framing, fragmented SysEx, serialized GATT writes, notification decoding, disconnect cleanup and bounded queues. Scheduling is best effort, not sample accurate. A successful service connection does not establish that a particular pedal accepts performance commands.

## Wireless song cues through the GP-180

The intended route is **Performance → Bluetooth MIDI → GP-180 → physical MIDI OUT/THRU → downstream MIDI pedals**. USB and the USB editor connection are not required. This route sends ordinary MIDI PC/CC/note/SysEx messages, not editor commands or preset uploads.

1. Open **Song → Performance → Performance MIDI controller**, click **Connect Bluetooth MIDI**, and select the GP-180 MIDI service. Connecting here selects Bluetooth as the performance output. An already-connected Bluetooth output is also available when opening a song. **Enable USB / system MIDI** is optional and is only for operating-system MIDI ports.
2. On the pedal, configure **MIDI IN Source** as **BT Only** or **Mixed**. Configure **EXP/FS jack 2** for MIDI OUT and use the appropriate TRS MIDI connection to the next pedal. Set the receiving pedals' channels and check any input/output channel filtering or remapping on the GP-180.
3. In **Song MIDI cues**, choose the time, destination channel and PC or CC command. **Add MIDI cue** adds a timestamped command to the song's saved chart. Different channels can address different downstream pedals. PC numbers are 0–127 on the wire; pedal displays may number programs 1–128.
4. Enable **Send cues**, then use **Send MIDI now** to check the selected command on the downstream pedal. A queued command or completed Bluetooth write does not prove it reached the physical MIDI output. Check the target pedal's response.
5. Play the song to send the timed cues. Pause, seeking, changing outputs and leaving Performance clear pending output. Manually reopening a song or replacing a Bluetooth session requires enabling **Send cues** again. During automatic playlist playback, an armed output carries across songs only while the same device stays connected. Bluetooth disconnect is independent of USB editor activity. MIDI clock is optional and needs separate clock-routing verification on the GP-180.

The [manufacturer's specifications](https://www.valeton.net/product/gp-180/) list MIDI OUT/THRU, and the [GP-180 manual's MIDI settings](https://www.manualslib.com/manual/4540022/Valeton-Gp-180.html?page=31) describe BT input routing. These do **not** clearly document arbitrary Bluetooth-to-TRS message forwarding. The final hop depends on pedal routing/firmware. The 22 October tests below confirmed timed patch changes through this route on the user’s GP-180/TimeLine rig; this does not establish compatibility with every pedal or routing configuration.

## GP-180 hardware results — 21 October 2026

GP-180 firmware **1.1.1** passed USB read-only inspection: 200 preset names, settings, the active preset and a complete backup of all 200 slots. The offline log audit checked **2,329 incoming frames and 419 outgoing frames**, covering 202 preset replies. Every outgoing frame passed the read-only allowlist. No preset selection, edits, uploads or firmware operations were tested.

These results establish compatibility with the inspected presets, not every model or write operation available in the firmware. Backups preserve the connected GP-180 model. The inspection panel displays knob assignments, expression records and footswitch masks without changing the pedal; unknown special targets remain numeric.

The **GP-180 BLE** standard MIDI service connected and notification subscription succeeded. Two editor hello writes completed at the GATT layer, but **zero notifications** were received. Bluetooth editor management was disabled following this result. At that checkpoint, physical performance MIDI was unverified; the 22 October follow-up below verified patch and tempo commands separately from the editor protocol.

Repeat an offline USB log audit with `node app/scripts/audit-gp180-log.mjs <session.log>`. This reads a local log and never opens MIDI.

## Bluetooth clock test — 22 October 2026

Timed Bluetooth playback recalled GP-180 patches 15 → 16 → 13, four seconds apart. The user confirmed the sequence and downstream TimeLine response, and a stopped seek to seven seconds left the GP-180 on patch 13 without replaying earlier cues. The GP-180 received OMNI; the TimeLine received channel 1.

Continuous 120 BPM clock over Bluetooth was **unstable on real hardware**: the GP-180 and downstream TimeLine showed the same large tempo changes. Starting the scheduler immediately and keeping pulse timestamps on a fixed grid corrected app scheduling issues, but did not resolve the hardware result. One measured run had GATT write-start intervals of **3.3–40.4 ms** (the target was 20.83 ms), maximum dispatch lateness of **21.3 ms**, and a maximum write duration of **23 ms**. These are host measurements, not over-the-air packet captures; they do not identify which layer introduces every delay. The Bluetooth controls expose these measurements under **Bluetooth clock timing**.

For this rig, use a one-time tempo command instead:

1. Set GP-180 **Clock Source = Internal** and **Clock Output (TRS) = On**. Enable clock receive on the downstream TimeLine.
2. Leave Performance's **Send MIDI Clock** off.
3. Apply **GP-180 + pedals · Bluetooth** to send the current song BPM automatically on playback start/resume, or in **Song MIDI cues**, choose **Valeton GP-180 → Set tempo (BPM)**, enter the recording BPM, and add the command at song time zero. Enable **Send cues** for playback.
4. Use a channel accepted by the GP-180 but ignored by downstream pedals when possible. In the tested rig, GP-180 receives OMNI and TimeLine receives channel 1, so channel 16 can address the GP-180 tempo without sending its CC controls to the TimeLine.

The documented GP-180 command sends CC 73 (BPM high bits) followed by CC 74 (low seven bits), supporting 40–300 BPM. Single 120 and 141 BPM commands over Bluetooth were physically confirmed to hold both pedals at the requested tempo when the GP-180 generated the outgoing clock. A saved time-zero cue on channel 16 also changed both pedals from 141 to a stable 120 BPM automatically when playback started. No USB connection was used. This sets tempo; it does not establish a shared beat phase or sample-accurate synchronization with the audio. The saved cue contains a BPM value; changing **Song BPM** does not rewrite an existing cue.

## USB performance test — 22 October 2026

With Bluetooth disconnected, a saved song-start CC 73/74 tempo cue sent over **GP-180 MIDI** set the GP-180 and downstream TimeLine to a stable **90 BPM**. USB editor inspection initially received no handshake reply even after changing MIDI IN Source to permit USB; restarting the pedal restored the editor connection. Firmware **1.1.1**, all **200 preset names**, active presets and global settings were read. The offline log audit of this app session checked **233 incoming editor SysEx frames and 134 outgoing editor SysEx frames**, eight preset replies across four slots, valid CRCs/chains and no unknown models. Every outgoing editor SysEx frame passed the read-only allowlist. This was an inspection, not another full backup or a preset-write test.

Continuous USB clock also **failed the rig's performance test**. At an app setting of 120 BPM, both pedals fluctuated from **119–122 BPM**; at 90 BPM, both fluctuated from **89–92 BPM**. The user reported audible delay pitch/time changes and judged this unusable. USB was less erratic than Bluetooth, but neither continuous-clock route is validated for performing with this rig. Keep app MIDI Clock off and use the one-time GP-180 tempo command with its internal hardware clock instead.

After restoring Internal clock and TRS clock output On, a single **120 BPM** command on **channel 16 over USB** was confirmed to hold both pedals steady at 120 BPM. Continuous app clock was left off. This repeats the successful one-time command result using USB rather than Bluetooth.

## USB editor access

GP-150 and GP-180 USB editor sessions allow preset selection, edits, saves and uploads without a special write unlock. The temporary GP-180 read-only guard and saved unlock setting have been removed. Existing backup prompts, busy-state checks, protocol validation and write verification remain in place. Historical read-only audit results above describe the earlier testing session; physical editor writes have not been retested.

Independent Performance MIDI output sends commands when explicitly configured and armed. Performance MIDI arming is independent of editor access. Saved songs do not contain routing or arming state. Port preferences are saved globally on this computer; output remains disarmed when a song is manually reopened. An existing Bluetooth connection can be selected automatically when opening a song, but cue sending remains off until enabled.

## Troubleshooting and diagnostics

- For presets and settings, connect the powered pedal by USB and use **Look for the pedal**. Ensure the pedal's MIDI input routing permits USB. Close other MIDI/editor applications that may hold the port.
- For wireless performance controls, use **Connect Bluetooth MIDI** and choose the MIDI device, rather than its audio pairing. Then select the connection in Performance and explicitly enable the desired MIDI output.
- If USB stops responding while Bluetooth is active, check the pedal's MIDI routing and test with Bluetooth audio and other MIDI applications disconnected. A USB fault alone does not establish its cause.
- **Copy diagnostic report** includes the editor transport, Bluetooth availability, current connection, last session device, completed GATT writes, received notifications and decoded MIDI message counts. Last-session counts survive connection cleanup.
- **Save log** in Diagnostics includes editor handshake attempts and decoded MIDI traffic even when the MIDI monitor is off. Desktop logs are stored locally; browser logs live in the current tab. Save the log before reloading or closing that tab.

The standard BLE-MIDI service is `03b80e5a-ede8-4b33-a751-6ce34ec4c700`; its characteristic is `7772e5db-3868-4112-a1a9-f2669d106bf3`.
