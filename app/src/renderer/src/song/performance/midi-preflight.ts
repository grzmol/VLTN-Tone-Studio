import { timedCues, type Cue } from "./chart";
import { chaseTriggerSet, isChased, triggerKey, type TriggerCc } from "./midi-chase";
import { sectionIssues, type Section } from "./sections";
import { parseOffset, type TimecodeRate } from "./timecode";
export interface PreflightOptions {
  duration: number;
  tempoChannel?: number;
  clock: boolean;
  outputName?: string;
  /**
   * The configured pedals. `unassigned` counts trigger commands whose CC is not set; `triggers` lists the assigned trigger controllers
   * (see `configuredPedals`). Both are optional so a caller with only names and channels still works.
   */
  pedals: { name: string; channel: number; unassigned?: number; triggers?: TriggerCc[] }[];
  /** The song's sections, checked against its tempo grid when a tempo is given */
  sections?: Section[];
  /** The part of the audio that plays, when the song is trimmed. Cues outside it never fire. */
  range?: { start: number; end: number };
  bpm?: number;
  beats?: number;
  firstBeat?: number;
  /** Set only while MIDI timecode is on: the rate, the song's offset text, and whether the output is Bluetooth */
  timecode?: { fps: TimecodeRate; offset: string; bluetooth: boolean };
}
export interface PreflightIssue {
  code: string;
  text: string;
}
export function midiPreflight(cues: Cue[], options: PreflightOptions) {
  const issues: PreflightIssue[] = [],
    channels = new Map<number, number>(),
    notes = new Map<string, number>();
  const add = (code: string, text: string) => {
    if (issues.length < 100) issues.push({ code, text });
  };
  // Triggers have no time, so they are checked below rather than on the timeline.
  // The chase replays a controller unless it is an assigned trigger here or a fixed one (see midi-chase.ts).
  const triggers = chaseTriggerSet(options.pedals.flatMap((pedal) => pedal.triggers ?? []));
  const events = timedCues(cues)
    .filter((c) => c.messages.length)
    .slice()
    .sort((a, b) => a.time - b.time);
  // Start, Continue and Stop are sent by the app's own clock; a cue that sends them as well gives the pedal a second one.
  const transportCue = cues.some((c) => c.messages.some((bytes) => [250, 251, 252].includes(bytes[0])));
  if (options.clock && transportCue)
    add("transport-conflict", "A Start, Continue or Stop cue conflicts with app MIDI clock, which already sends Start and Stop. Turn clock off or remove the cue.");
  if (events.length && !options.outputName)
    add("output", "No MIDI output selected. Connect the intended output and explicitly enable Send cues before performing.");
  const referenced = options.pedals.filter((p) => events.some((c) => c.label?.startsWith(p.name + ":")));
  const labels = new Map<number, string[]>();
  for (const pedal of referenced) {
    const names = labels.get(pedal.channel) || [];
    names.push(pedal.name);
    labels.set(pedal.channel, names);
  }
  for (const [channel, names] of labels)
    if (names.length > 1) add("channel-collision", `Configured channel ${channel} is shared by ${names.join(", ")}. Verify physical receive settings.`);
  if (options.tempoChannel && referenced.some((p) => p.channel === options.tempoChannel && !/GP-?(150|180)/i.test(p.name)))
    add("tempo-channel", "Automatic GP-150 / GP-180 tempo shares a configured downstream pedal channel. Its CC73/74 may affect that pedal.");
  if (options.timecode) {
    const { fps, offset, bluetooth } = options.timecode;
    if (bluetooth)
      add(
        "timecode-bluetooth",
        "MIDI timecode over Bluetooth is not recommended: quarter frames come every few milliseconds and BLE cannot keep them steady. Use USB, or turn timecode off.",
      );
    const parsed = parseOffset(offset || "00:00:00:00", fps);
    if ("error" in parsed) add("timecode-offset", `Timecode offset: ${parsed.error}`);
    if (options.clock) add("timecode-clock", "MIDI timecode and app MIDI clock are exclusive. Timecode is sent and clock is ignored; turn clock off.");
  }
  if (options.clock && /GP.?(150|180)/i.test(options.outputName || ""))
    add("clock", "Continuous app clock failed the GP-180 hardware test. Use one-time tempo with the pedal’s internal clock.");
  let windowStart = 0,
    windowBytes = 0,
    dense = false;
  const conflicts = new Map<string, string>();
  const pressed = new Map<string, { time: number; value: number }>();
  let warnedMomentary = false;
  let warnedUnassigned = false;
  const warnedTriggers = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const cue = events[i];
    if (!Number.isFinite(cue.time) || cue.time < 0) add("time", "A MIDI cue has an invalid timestamp.");
    if (cue.time > options.duration) add("past-end", `Cue at ${cue.time.toFixed(2)} s is beyond the ${options.duration.toFixed(2)} s audio and will not play.`);
    windowBytes += cue.messages.reduce((sum, b) => sum + b.length, 0);
    while (events[windowStart].time < cue.time - 0.02) {
      windowBytes -= events[windowStart++].messages.reduce((sum, b) => sum + b.length, 0);
    }
    if (windowBytes > 62 && !dense) {
      add("burst", "A 20 ms cue window exceeds 62 MIDI bytes. Physical DIN serialization or BLE queueing may delay this burst.");
      dense = true;
    }
    for (const bytes of cue.messages) {
      const kind = bytes[0] & 240,
        channel = (bytes[0] & 15) + 1;
      if (bytes[0] < 240) channels.set(channel, (channels.get(channel) || 0) + 1);
      if (bytes.length > 256) add("sysex", "A long SysEx command can delay subsequent commands. Rehearse it with the actual device.");
      if (cue.time > options.duration) continue;
      if (kind === 144 && bytes[2] > 0) {
        if (notes.has(`${channel}:${bytes[1]}`))
          add("retrigger", `Note ${bytes[1]} on channel ${channel} is retriggered before its previous note-off. Verify the receiver’s behavior.`);
        notes.set(`${channel}:${bytes[1]}`, cue.time);
      }
      if (kind === 128 || (kind === 144 && bytes[2] === 0)) notes.delete(`${channel}:${bytes[1]}`);
      if (options.tempoChannel === channel && kind === 176 && [73, 74].includes(bytes[1]))
        add("tempo-conflict", `Saved CC${bytes[1]} on channel ${channel} can override automatic song tempo. Verify its value and ordering.`);
      if (kind === 192 || (kind === 176 && ![0, 32].includes(bytes[1]))) {
        const id = `${cue.time}:${channel}:${kind}:${kind === 176 ? bytes[1] : ""}`,
          value = bytes.join(",");
        const previous = conflicts.get(id);
        if (previous)
          add(
            previous === value ? "duplicate" : "conflict",
            `${previous === value ? "Repeated" : "Conflicting"} ${kind === 192 ? "program change" : "CC" + bytes[1]} ` +
              `on channel ${channel} at ${cue.time.toFixed(2)} s. ` +
              `Verify intentional trigger/order.`,
          );
        conflicts.set(id, value);
      }
      if (kind === 176 && cue.chase === undefined && bytes[1] !== 0 && bytes[1] !== 32) {
        // A raw controller that is an assigned trigger is skipped by the chase, which the user should know about. Otherwise, one that would
        // be chased on a pedal with trigger commands still unassigned cannot be told apart from a trigger, so the user must decide.
        const key = triggerKey(channel, bytes[1]);
        const unassigned = options.pedals.filter((pedal) => pedal.channel === channel && (pedal.unassigned ?? 0) > 0);
        if (triggers.has(key) && !warnedTriggers.has(key)) {
          warnedTriggers.add(key);
          add(
            "chase-assigned-trigger",
            `CC${bytes[1]} on channel ${channel} at ${cue.time.toFixed(2)} s is an assigned trigger, so it is not replayed when starting mid-song. ` +
              `Add {chase} to the cue to replay it.`,
          );
        } else if (!triggers.has(key) && unassigned.length && isChased(cue, bytes, triggers) && !warnedUnassigned) {
          add(
            "chase-unassigned-trigger",
            `CC${bytes[1]} on channel ${channel} at ${cue.time.toFixed(2)} s would be replayed when starting mid-song, ` +
              `but ${unassigned.map((pedal) => pedal.name).join(", ")} ` +
              `has trigger commands with no CC assigned, so the app cannot tell whether it is one. ` +
              `Set the pedal’s CC assignments in Performance, ` +
              `or add {nochase} to the cue.`,
          );
          warnedUnassigned = true;
        }
      }
      if (kind === 176 && isChased(cue, bytes, triggers) && !warnedMomentary) {
        // A press followed by a release within half a second looks like a button, which should not be replayed when starting mid-song.
        const key = `${channel}:${bytes[1]}`,
          last = pressed.get(key);
        if (last && cue.time - last.time <= 0.5 && last.value !== bytes[2] && (last.value === 0 || bytes[2] === 0)) {
          add(
            "chase-momentary",
            `CC${bytes[1]} on channel ${channel} at ${cue.time.toFixed(2)} s looks like a press and release but would be replayed when starting mid-song. ` +
              `Add {nochase} to the cue.`,
          );
          warnedMomentary = true;
        }
        pressed.set(key, { time: cue.time, value: bytes[2] });
      }
      if (cue.label) {
        const pedal = options.pedals.find((p) => cue.label!.startsWith(p.name + ":"));
        if (pedal && bytes[0] < 240 && pedal.channel !== channel)
          add("saved-channel", `${pedal.name} cue uses channel ${channel}; its current profile is channel ${pedal.channel}. Existing cue bytes are unchanged.`);
      }
    }
  }
  if (options.range) {
    const { start, end } = options.range;
    const outside = events.filter((c) => c.time < start || c.time > end);
    if (outside.length)
      add(
        "cue-trim",
        `${outside.length} cue${outside.length === 1 ? "" : "s"} outside the trimmed range (${start.toFixed(2)}–${end.toFixed(2)} s) will not play, ` +
          `starting at ${outside[0].time.toFixed(2)} s.`,
      );
  }
  for (const issue of sectionIssues(options.sections ?? [], {
    duration: options.duration,
    bpm: options.bpm,
    beats: options.beats,
    firstBeat: options.firstBeat,
    range: options.range,
  }))
    add(issue.code, issue.text);
  for (const [note, time] of notes)
    add("note-off", `Note ${note.split(":")[1]} on channel ${note.split(":")[0]} at ${time.toFixed(2)} s has no later note-off before the audio ends.`);
  return { issues, channels: [...channels].sort((a, b) => a[0] - b[0]), commands: events.reduce((n, c) => n + c.messages.length, 0) };
}
