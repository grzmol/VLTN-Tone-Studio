# Bluetooth MIDI for the GP-150 and GP-180

The Device screen has a **Connect Bluetooth MIDI** button. It opens a BLE-MIDI link to the pedal and shows how that link is doing. Editing the pedal (reading, writing and backing up presets and settings) still goes over USB.

## Connecting

Click **Connect Bluetooth MIDI** in the Device screen's header and pick the pedal. The desktop app shows its own chooser, because Electron has none. Browsers use theirs. The chooser lists devices named GP-150, GP-180 or Valeton, and anything that advertises the standard Bluetooth MIDI service.

Before it sends anything, the app checks that the device has the standard Bluetooth MIDI service. Valeton's phone app may talk to the pedal through a different service, so keep that app disconnected and the pedal close by. Bluetooth audio and Bluetooth MIDI are separate things: pairing the pedal as a speaker does not give you MIDI.

If the pedal asks for a PIN, pair it in your system's Bluetooth settings first and connect again.

On macOS, a development build started from a terminal crashes when you click the button, because the terminal has no Bluetooth permission. Build the app and open it from Finder instead. The packaged app asks once.

## Why editing stays on USB

On 21 October 2026 a GP-180 connected over Bluetooth, took the editor's hello, and then never answered, so the editor cannot use Bluetooth with this firmware (1.1.1). The code to run the editor protocol over Bluetooth is there (`Gp150Driver.fromBluetooth`), but nothing calls it. A successful sync on some firmware would be the sign that it can be switched on.

## What the link does

This version opens the link and keeps it alive. Nothing in the app sends cues over it yet.

* If the link drops, the app reconnects by itself without asking you to pick the device again, after 0.5, 1, 2, 4 seconds and so on, up to 30 seconds between attempts. **Stop reconnecting** gives up, including an attempt that is already running. Connecting by hand cancels any reconnect that is waiting or running.
* A write that fails or takes more than a second closes the link. It is not retried, because the pedal may already have received it.

## Diagnostics

**Copy diagnostic report** and **Save log** on the Device screen include the Bluetooth state: whether the Bluetooth API is there, the current device, the last error, and the counters of the last session (writes completed, notifications received, messages decoded, automatic reconnects). The counters survive the connection being closed, so you can read them afterwards.

## Hardware results

Rig: Valeton GP-180, firmware 1.1.1.

| Date | What | Result |
| --- | --- | --- |
| 21 Oct 2026 | Editor hello over Bluetooth | Connected, no reply. Editor use over Bluetooth stays off. |

The standard BLE-MIDI service is `03b80e5a-ede8-4b33-a751-6ce34ec4c700` and its characteristic is `7772e5db-3868-4112-a1a9-f2669d106bf3`.
