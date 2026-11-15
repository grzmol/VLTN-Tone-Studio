# Bluetooth MIDI for the GP-150 and GP-180

The Device screen offers Bluetooth MIDI performance controls: **Open macOS MIDI setup** on Mac, or **Connect Bluetooth MIDI** on other supported platforms. Editing the pedal (reading, writing and backing up presets and settings) still goes over USB.

## macOS performance MIDI

On Mac, choose **Open macOS MIDI setup** in Tone Studio. In Audio MIDI Setup choose **Window → Show MIDI Studio**, then **MIDI Studio → Open Bluetooth Configuration**. Connect your pedal there. Return to Tone Studio, enable USB / system MIDI if needed, select the pedal's **MIDI output**, then enable **Send cues**. Select its MIDI input separately if you use remote footswitch commands.

Bluetooth discovery runs in the system app, keeping Tone Studio's transport responsive. Opening can be cancelled or retried after a timeout. Closing or cancelling does not disconnect existing system MIDI connections. Reconnection never starts playback; prepare the pedals again before playing. The remembered Web Bluetooth output from older releases needs to be replaced with the system MIDI output once. Pedal channels, tempo and song cues stay the same.

## Windows and browser connections

Click **Connect Bluetooth MIDI** in the Device screen's header and pick the pedal. The desktop app shows its own chooser, because Electron has none. Browsers use theirs. The chooser lists devices named GP-150, GP-180 or Valeton, and anything that advertises the standard Bluetooth MIDI service.

Before it sends anything, the app checks that the device has the standard Bluetooth MIDI service. Valeton's phone app may talk to the pedal through a different service, so keep that app disconnected and the pedal close by. Bluetooth audio and Bluetooth MIDI are separate things: pairing the pedal as a speaker does not give you MIDI.

If the pedal asks for a PIN, pair it in your system's Bluetooth settings first and connect again.

Mac desktop builds use the system MIDI path described above, including during development.

## Why editing stays on USB

On 21 October 2026 a GP-180 connected over Bluetooth, took the editor's hello, and then never answered, so the editor cannot use Bluetooth with this firmware (1.1.1). The code to run the editor protocol over Bluetooth is there (`Gp150Driver.fromBluetooth`), but nothing calls it. A successful sync on some firmware would be the sign that it can be switched on.

## What the Windows and browser link does

The Bluetooth layer packs MIDI messages into BLE-MIDI packets, with a timestamp on each message, and writes them one at a time. A few details are worth knowing:

* Messages that arrive within a few milliseconds of each other share a packet. A message waiting for its timestamp never overtakes an earlier one, and two messages with the same timestamp keep the order they were sent in. Some pedals hold the next message while they load a patch, so the order matters.
* A timed message that reaches the radio more than 250 ms late is dropped and counted. The link stays open.
* A write that fails or takes more than a second closes the link. It is not retried, because the pedal may already have received it.
* If the link drops, the app reconnects by itself without asking you to pick the device again, after 0.5, 1, 2, 4 seconds and so on, up to 30 seconds between attempts. **Stop reconnecting** gives up, including an attempt that is already running. Connecting by hand cancels any reconnect that is waiting or running.

## Diagnostics

**Copy diagnostic report** and **Save log** on the Device screen include the Bluetooth state: whether the Bluetooth API is there, the current device, the last error, and the counters of the last session (writes completed, notifications received, messages decoded, late messages dropped, automatic reconnects). The counters survive the connection being closed, so you can read them afterwards.

## Hardware results

Rig: Valeton GP-180, firmware 1.1.1.

| Date | What | Result |
| --- | --- | --- |
| 21 Oct 2026 | Editor hello over Bluetooth | Connected, no reply. Editor use over Bluetooth stays off. |
| 26 Oct 2026 | Timed program changes over Bluetooth with packed writes (test 12-H1) | Passed: 23 pairs over 90 s, spacing 4000.3 ms with a spread of 7.0 ms, no drops. |
| 28 Oct 2026 | Same test again (12-H1) | Failed at first: in 2 of 17 pairs the pedal's message came before the other one, 65 ms and 158 ms apart. |
| 28 Oct 2026 | Same test after the ordering fix | Passed: 17 of 17 pairs in order, 0.35 ms apart. |

The standard BLE-MIDI service is `03b80e5a-ede8-4b33-a751-6ce34ec4c700` and its characteristic is `7772e5db-3868-4112-a1a9-f2669d106bf3`.
