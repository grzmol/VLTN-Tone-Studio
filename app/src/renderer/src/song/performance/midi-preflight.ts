import { PREFLIGHT_TIME_TOLERANCE_S } from "./preflight-timing";
import { isPresetMessage, startPreparation, type PreparationSettings } from "./start-preparation";
import { expandSectionCues, timedCues, unmatchedSectionCues, type Cue } from "./chart";
import { chaseTriggerSet, isChased, triggerKey, type TriggerCc } from "./midi-chase";
import { sectionIssues, type Section } from "./sections";
import { parseOffset, type TimecodeRate } from "./timecode";
import { presetCueTarget, presetNumber, type PresetNames } from "./pedal-preset-names";
export interface PreflightOptions {
  duration: number;
  /** Actual initial MIDI position, including pre-roll; defaults to the playable range start. */
  playbackStart?: number;
  preparation?: PreparationSettings;
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
  /** The GP-150 / GP-180 preset names as last known (index = slot). Unset while they are unknown, which skips the preset-name check. */
  presetNames?: PresetNames;
}
/** A cue's label starts with its pedal's name; a GP-150 / GP-180 preset label leaves out the "Valeton" the profile name starts with. */
const labelIsFrom = (label: string | undefined, pedalName: string) =>
  !!label && (label.startsWith(pedalName + ":") || label.startsWith(pedalName.replace(/^Valeton /, "") + ":"));
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export interface PreflightIssue {
  level?: "advice";
  code: string;
  text: string;
}
export function midiPreflight(chartCues: Cue[], options: PreflightOptions) {
  // Section cues are checked where they fall in the song, like the timed cues they become.
  const cues = expandSectionCues(chartCues, options.sections ?? []);
  const issues: PreflightIssue[] = [],
    channels = new Map<number, number>(),
    notes = new Map<string, number>();
  let warningCount = 0,
    adviceCount = 0;
  const add = (code: string, text: string, level?: "advice") => {
    if (level === "advice" ? adviceCount >= 100 : warningCount >= 100) return;
    if (level === "advice") adviceCount++;
    else warningCount++;
    issues.push({ code, text, ...(level ? { level } : {}) });
  };
  const preparation = cues.filter((cue) => cue.trigger === "prepare");
  if (
    options.tempoChannel &&
    preparation.some((cue) =>
      cue.messages.some((bytes) => (bytes[0] & 240) === 176 && (bytes[0] & 15) + 1 === options.tempoChannel && [73, 74].includes(bytes[1])),
    )
  )
    add(
      "preparation-tempo",
      "Before song commands set GP tempo, but automatic song BPM runs afterwards. Turn off automatic BPM if the preparation tempo should win.",
    );
  for (const cue of preparation)
    for (const bytes of cue.messages) {
      if (bytes[0] < 240) {
        const channel = (bytes[0] & 15) + 1;
        channels.set(channel, (channels.get(channel) ?? 0) + 1);
        const pedal = options.pedals.find((pedal) => labelIsFrom(cue.label, pedal.name));
        if (pedal && pedal.channel !== channel)
          add(
            "saved-channel",
            `${pedal.name} Before song cue uses channel ${channel}; its current profile is channel ${pedal.channel}. Existing cue bytes are unchanged.`,
          );
      }
    }
  for (const cue of unmatchedSectionCues(chartCues, options.sections ?? []))
    add("section-cue", `On section ${cue.section!.name}: there is no section called ${cue.section!.name}. The cue never fires.`);
  // Triggers have no time, so they are checked below rather than on the timeline.
  // The chase replays a controller unless it is an assigned trigger here or a fixed one (see midi-chase.ts).
  const triggers = chaseTriggerSet(options.pedals.flatMap((pedal) => pedal.triggers ?? []));
  const rc10rTriggers = chaseTriggerSet(options.pedals.filter((pedal) => pedal.name === "BOSS RC-10R").flatMap((pedal) => pedal.triggers ?? []));
  const events = timedCues(cues)
    .filter((c) => c.messages.length)
    .slice()
    .sort((a, b) => a.time - b.time);
  // Start, Continue and Stop are sent by the app's own clock; a cue that sends them as well gives the pedal a second one.
  const transportCue = cues.some((c) => c.messages.some((bytes) => [250, 251, 252].includes(bytes[0])));
  if (options.clock && transportCue)
    add(
      "transport-conflict",
      "A Start, Continue or Stop cue conflicts with app MIDI clock, which already sends Start and Stop. Turn clock off or remove the cue.",
    );
  if ((events.length || preparation.some((cue) => cue.messages.length)) && !options.outputName)
    add("output", "No MIDI output selected. Connect the intended output and explicitly enable Send cues before performing.");
  const referenced = options.pedals.filter((p) => [...events, ...preparation].some((c) => labelIsFrom(c.label, p.name)));
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
    if (cue.time > options.duration + PREFLIGHT_TIME_TOLERANCE_S)
      add("past-end", `Cue at ${cue.time.toFixed(2)} s is beyond the ${options.duration.toFixed(2)} s audio and will not play.`);
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
        // The output gives recognized RC-10R press/release pairs a real hold time, even when their chart timestamps match.
        const spacedPulse =
          kind === 176 &&
          bytes[2] === 0 &&
          previous === `${bytes[0]},${bytes[1]},127` &&
          (cue.managed === "rhythm" || rc10rTriggers.has(triggerKey(channel, bytes[1])));
        if (previous && !spacedPulse)
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
        const pedal = options.pedals.find((p) => labelIsFrom(cue.label, p.name));
        if (pedal && bytes[0] < 240 && pedal.channel !== channel)
          add("saved-channel", `${pedal.name} cue uses channel ${channel}; its current profile is channel ${pedal.channel}. Existing cue bytes are unchanged.`);
      }
    }
  }
  if (options.presetNames) presetNameIssues([...events, ...preparation], options.presetNames, add);
  const playbackStart = options.playbackStart ?? options.range?.start ?? 0;
  const prepared = options.preparation?.enabled
    ? new Set(
        startPreparation(
          cues,
          playbackStart,
          options.preparation,
          options.pedals.flatMap((pedal) => pedal.triggers ?? []),
        ).opening.map((bytes) => bytes.join(",")),
      )
    : new Set<string>();
  const end = options.range?.end ?? options.duration;
  const outside = events.filter((cue) => {
    if (cue.time > options.duration + PREFLIGHT_TIME_TOLERANCE_S) return false; // Already reported as past-end.
    if (cue.time > end + PREFLIGHT_TIME_TOLERANCE_S) return true;
    if (cue.time >= playbackStart - PREFLIGHT_TIME_TOLERANCE_S) return false;
    // Only bank/PC bytes restored by the sender are accounted for. A mixed cue still warns about any unsent notes or controls.
    return cue.messages.some((bytes) => !isPresetMessage(bytes) || !prepared.has(bytes.join(",")));
  });
  if (outside.length)
    add(
      "cue-trim",
      `${outside.length} cue${outside.length === 1 ? "" : "s"} outside the trimmed range (${playbackStart.toFixed(2)}–${end.toFixed(2)} s) ${outside.length === 1 ? "has" : "have"} commands that will not play, starting at ${outside[0].time.toFixed(2)} s.`,
    );
  for (const issue of sectionIssues(options.sections ?? [], {
    duration: options.duration,
    bpm: options.bpm,
    beats: options.beats,
    firstBeat: options.firstBeat,
    range: options.range,
  }))
    add(issue.code, issue.text, issue.level);
  for (const [note, time] of notes)
    add("note-off", `Note ${note.split(":")[1]} on channel ${note.split(":")[0]} at ${time.toFixed(2)} s has no later note-off before the audio ends.`);
  const warnings = issues.filter((issue) => !issue.level),
    advice = issues.filter((issue) => issue.level === "advice");
  return {
    issues: [...warnings, ...advice],
    warnings,
    advice,
    channels: [...channels].sort((a, b) => a[0] - b[0]),
    commands: [...events, ...preparation].reduce((n, c) => n + c.messages.length, 0),
  };
}

/** Warns for each cue whose recorded preset name is not what its slot holds now, and says where the name went when exactly one slot has it. */
function presetNameIssues(cues: Cue[], known: PresetNames, add: (code: string, text: string) => void) {
  for (const cue of cues) {
    const channel = cue.messages.length ? (cue.messages[0][0] & 15) + 1 : 0;
    const target = channel ? presetCueTarget(cue, channel) : null;
    if (!target?.name || (known.model && target.model !== known.model)) continue;
    const now = known.names[target.slot];
    if (now === undefined || now.trim() === target.name) continue;
    const moved = known.names.flatMap((name, slot) => (name.trim() === target.name ? [slot] : []));
    const model = target.model === "gp150" ? "GP-150" : "GP-180";
    const when = cue.trigger && cue.trigger !== "section" ? "A Before song cue" : clock(cue.time);
    const text =
      `${when} recalls ${model} preset ${presetNumber(target.slot)}, saved as "${target.name}". ` +
      (now.trim() ? `That slot now holds "${now.trim()}".` : "That slot is now empty.");
    if (moved.length === 1) add("preset-moved", `${text} It is now at ${presetNumber(moved[0])}.`);
    else add("preset-renamed", text);
  }
}
