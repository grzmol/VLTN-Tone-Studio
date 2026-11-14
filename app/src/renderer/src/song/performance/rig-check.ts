// Whether the GP-150 / GP-180's own MIDI settings agree with how the app is about to drive it. Pure rules: the caller reads the pedal's
// settings and the app's configuration, and shows the issues with a button for each fix.
import type { Gp150GlobalName } from "@/state/driver/gp150-globals";
import { gp150GlobalSpec } from "@/state/driver/gp150-globals";
import { pedalName } from "@/state/device-model";

export interface RigFacts {
  device: "gp150" | "gp180";
  globals: Partial<Record<Gp150GlobalName, number>>;
  /** The selected MIDI output: "system" is USB. Null when none is selected. */
  transport: "system" | "bluetooth" | null;
  /** The GP channel the app sends on (1–16) */
  pedalChannel: number;
  /** Channels of the other configured pedals */
  otherChannels: number[];
  /** The app sends MIDI clock */
  appClock: boolean;
  tempoOnStart: boolean;
  /** Any other configured pedal */
  downstreamPedals: boolean;
}
export interface RigIssue {
  code: string;
  level: "error" | "warning" | "advice";
  text: string;
  fix?: { name: Gp150GlobalName; value: number; label: string };
}

const SOURCE_TRS = 0,
  SOURCE_USB = 1,
  SOURCE_BLUETOOTH = 2,
  SOURCE_MIXED = 3;
const CLOCK_INTERNAL = 0,
  CLOCK_USB_ONLY = 2;
const FS_JACK_MIDI_OUT = 0;
const OMNI = 0;

/** The menu entry's name on the pedal, as the settings screen shows it. */
function label(name: Gp150GlobalName): string {
  return gp150GlobalSpec(name).label;
}
function fixTo(name: Gp150GlobalName, value: number, valueLabel: string) {
  return { name, value, label: `Set ${label(name)} to ${valueLabel}` };
}

export function rigCheck(facts: RigFacts): RigIssue[] {
  const { globals, transport, pedalChannel } = facts;
  const pedal = pedalName(facts.device);
  const issues: RigIssue[] = [];
  const usb = transport === "system";
  const channelName: Gp150GlobalName | null = transport === null ? null : usb ? "midiInChannelUsb" : "midiInChannelBt";
  const needed: Gp150GlobalName[] = [];
  if (transport) needed.push("midiInSource", channelName!);
  if (facts.appClock) needed.push("clockSource");
  if (facts.downstreamPedals) needed.push("clockOutTrs", "fsJack");
  if (needed.some((name) => globals[name] === undefined)) {
    return [{ code: "unknown", level: "advice", text: "Connect the pedal in the editor to check its MIDI settings." }];
  }

  const source = globals.midiInSource!;
  const wrongSource = usb ? source === SOURCE_TRS || source === SOURCE_BLUETOOTH : source === SOURCE_TRS || source === SOURCE_USB;
  if (transport && wrongSource) {
    const via = usb ? "USB" : "Bluetooth";
    issues.push({
      code: "in-source",
      level: "error",
      text: `The ${pedal} is not listening for MIDI over ${via}, so the cues will not reach it. Set ${label("midiInSource")} to Mixed.`,
      fix: fixTo("midiInSource", SOURCE_MIXED, "Mixed"),
    });
  }

  if (channelName) {
    const via = usb ? "USB" : "Bluetooth";
    const channel = globals[channelName]!;
    if (channel === OMNI && facts.otherChannels.length > 0) {
      issues.push({
        code: "in-channel-omni",
        level: "error",
        text: `The ${pedal} listens on every channel over ${via}, so commands for your other pedals will change its patch too. Set ${label(channelName)} to ${pedalChannel}.`,
        fix: fixTo(channelName, pedalChannel, String(pedalChannel)),
      });
    } else if (channel !== OMNI && channel !== pedalChannel) {
      issues.push({
        code: "in-channel-mismatch",
        level: "error",
        text: `The ${pedal} listens on channel ${channel} over ${via}, but the app sends to it on channel ${pedalChannel}. Set ${label(channelName)} to ${pedalChannel}, or change the app's channel to ${channel}.`,
        fix: fixTo(channelName, pedalChannel, String(pedalChannel)),
      });
    }
  }

  if (facts.otherChannels.includes(pedalChannel)) {
    issues.push({
      code: "in-channel-shared",
      level: "warning",
      text: `Another pedal is also set to channel ${pedalChannel}, so its commands will reach the ${pedal} as well. Give them different channels in the pedal settings.`,
    });
  }

  if (facts.appClock) {
    const clock = globals.clockSource!;
    if (clock === CLOCK_INTERNAL) {
      issues.push(
        usb
          ? {
              code: "clock-source",
              level: "warning",
              text: `The app sends MIDI clock but the ${pedal} keeps its own tempo. Set ${label("clockSource")} to USB only to follow the app.`,
              fix: fixTo("clockSource", CLOCK_USB_ONLY, "USB only"),
            }
          : {
              code: "clock-source",
              level: "warning",
              text: `The app sends MIDI clock but the ${pedal} keeps its own tempo (${label("clockSource")} is Internal). Following the clock over Bluetooth is unproven, so there is no one-press fix.`,
            },
      );
    } else if (facts.tempoOnStart) {
      issues.push({
        code: "clock-double",
        level: "advice",
        text: `The app sets the tempo when a song starts and also sends clock, and the ${pedal} follows the clock. The clock wins; turn off the tempo at start if you want to set it once.`,
      });
    }
  }

  if (facts.downstreamPedals) {
    if (globals.clockOutTrs === 0) {
      issues.push({
        code: "clock-out",
        level: "advice",
        text: `The ${pedal} does not send clock to the pedals after it. If they follow tempo, set ${label("clockOutTrs")} to On.`,
        fix: fixTo("clockOutTrs", 1, "On"),
      });
    }
    if (globals.fsJack !== FS_JACK_MIDI_OUT) {
      issues.push({
        code: "midi-out-jack",
        level: "error",
        text: `The ${pedal}'s FS jack is not set to MIDI out, so nothing reaches your other pedals. Set ${label("fsJack")} to MIDI out.`,
        fix: fixTo("fsJack", FS_JACK_MIDI_OUT, "MIDI out"),
      });
    }
  }
  return issues;
}
