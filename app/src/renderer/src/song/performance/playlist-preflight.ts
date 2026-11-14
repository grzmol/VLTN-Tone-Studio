import { expandSectionCues } from "./chart";
import { PreparationHistory } from "./preparation-repeat";
import { preparationSequence, type PreparationSequence } from "./preparation-sequence";
import { preparationPreflight } from "./preparation-preflight";
import { savedPreparation, PREPARATION_DEFAULTS, type PreparationSettings } from "./start-preparation";
import { ownLeadIn, resolveLeadIn, LEAD_IN_DEFAULTS, type LeadIn } from "./lead-in";
import { preRollStart } from "./rhythm";
import { pedalTempoMessages } from "./pedal-tempo";
import type { LibraryPreflightSong } from "@shared/song-library";
import { trackKey, trackKindOf } from "@shared/song-library";
import { midiPreflight, type PreflightOptions } from "./midi-preflight";
import { rigCheck, type RigFacts } from "./rig-check";
import type { MidiMacro } from "./midi-macros";
import { parseSections } from "./sections";
import { midiFileFromOptions } from "./smf";
import { songCues } from "./song-cues";
import { playedTrimStart, storedShape } from "./song-shape";
import { playRange } from "./transition";
import { clampSpeed, effectiveBpm } from "./speed";
import { orderedKeys } from "../tracks";
import { describeBinding, type Binding } from "./bindings";
import { readTempoSource } from "./tempo-source";
import { bindingClaiming, triggerClashes, type SongEntry } from "./song-triggers";

/** The part of a song that plays, when its stored options trim it. Null for a song that plays whole. */
function trimRange(duration: number, options: object): { start: number; end: number } | undefined {
  const raw = options as Record<string, unknown>;
  const shape = { ...storedShape(raw), trimStart: playedTrimStart(raw) };
  if (shape.trimStart === undefined && shape.trimEnd === undefined) return undefined;
  return playRange(duration, shape);
}
export interface PlaylistCheck {
  entry: number;
  id: string;
  title: string;
  errors: string[];
  warnings: string[];
  advice: string[];
  /** Information only, shown without the warning label */
  notes: string[];
  /** Fresh-load preparation from the saved playable beginning, with no live repeat history. */
  preparation?: PreparationSequence;
}
export function playlistPreflight(
  ids: string[],
  songs: LibraryPreflightSong[],
  config: {
    tempoOnStart: boolean;
    tempoChannel: number;
    outputName?: string;
    pedals: PreflightOptions["pedals"];
    /** The GP-150 / GP-180 preset names as last known, to warn about a cue that recalls a preset which has changed. */
    presetNames?: PreflightOptions["presetNames"];
    /** Whether a song's speed or pitch render was built in advance. Unset means the render is not checked. */
    renderReady?: (id: string) => boolean;
    /** The MIDI macros the charts refer to. A chart that uses a missing one cannot play. */
    macros?: readonly MidiMacro[];
    /** Every saved song with its MIDI trigger, so a trigger shared with another song, or answered by a binding, is named. */
    songs?: readonly SongEntry[];
    bindings?: readonly Binding[];
    preparationDefaults?: PreparationSettings;
    leadInDefaults?: LeadIn;
    /** The connected GP-150 / GP-180's settings and the app's side. Its issues are added once, to the first entry; `appClock` is taken from the songs. */
    rig?: RigFacts | null;
  },
): PlaylistCheck[] {
  const byId = new Map(songs.map((s) => [s.id, s]));
  let anyClock = false;
  const checks = ids.map((id, entry) => {
    const saved = byId.get(id),
      song = saved?.song;
    const errors = [...(saved?.errors ?? ["Song was not checked."])],
      warnings: string[] = [],
      notes: string[] = [], advice: string[] = [];
    let preparation: PreparationSequence | undefined;
    if (song) {
      if (config.tempoOnStart && !config.outputName)
        warnings.push("Automatic tempo is enabled but no MIDI output preference is saved. Select and arm the intended output before performing.");
      let options: {
        clock?: boolean;
        sections?: unknown;
        beats?: unknown;
        firstBeat?: unknown;
        analysis?: unknown;
        tempoSource?: unknown;
        preRollBeats?: unknown;
        preparation?: unknown;
      } = {};
      try {
        const value = JSON.parse(song.settings[":options"] || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        options = value;
      } catch {
        errors.push("Saved performance options are invalid.");
      }
      anyClock ||= options.clock === true;
      const raw = song.settings[":bpm"];
      const bpm = raw ? Number(raw) : 120;
      if (!raw) warnings.push("No saved BPM; playback defaults to 120. Confirm the recording tempo.");
      // Earlier builds saved 120 for songs that were never given a tempo. Such a tempo has no source and is only a guess.
      else if (raw === "120" && !readTempoSource(options)) warnings.push("BPM may be the old 120 default. Open the song to detect it, or confirm the tempo.");
      if (!options.analysis) warnings.push("Song not analysed yet. Open it once so its tempo, key and parts are worked out.");
      if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) errors.push("Saved BPM must be between 30 and 300.");
      // The pedal is sent the tempo the song plays at, so the tempo range applies to the BPM times the saved speed.
      const speed = clampSpeed(options as Record<string, unknown>);
      const played = effectiveBpm(bpm, speed.rate);
      if (Number.isFinite(played) && config.tempoOnStart && (played < 40 || played > 300))
        errors.push(`At ${Math.round(speed.rate * 100)}% this song plays at ${Math.round(played)} BPM; automatic pedal tempo requires 40–300 BPM.`);
      const changed = speed.rate !== 1 || speed.semitones !== 0 || speed.cents !== 0;
      // The first song renders as it loads and the second is the one the set prepares next, so a render that is not ready for either is
      // a warning. Later songs are prepared in turn and are only noted, so the warnings stay for what needs doing.
      if (changed && config.renderReady && !config.renderReady(id)) {
        const text = "Its speed or pitch is not rendered in advance yet. It plays at its own speed until the render is ready.";
        if (entry <= 1) warnings.push(text);
        else notes.push(text);
      }
      if (config.tempoOnStart && options.clock)
        warnings.push("Saved continuous clock is enabled alongside automatic tempo. Disable continuous clock for this setup.");
      // Every playable track, split stems and imported tracks alike. The source is a mix of them, not a track of its own.
      // In player order: the first one plays first, and its length is the one the song is checked against.
      const playable = song.audio.filter((a) => trackKindOf(a) !== "source");
      const byKey = new Map(playable.map((a) => [trackKey(a), a]));
      const tracks = playable.length ? orderedKeys([...byKey.keys()]).map((key) => byKey.get(key)!) : song.audio;
      if (!tracks.length) errors.push("Song has no playable audio tracks.");
      const duration = tracks.length ? tracks[0].frames / tracks[0].sampleRate : 0;
      if (Math.max(...tracks.map((a) => a.frames / a.sampleRate)) - Math.min(...tracks.map((a) => a.frames / a.sampleRate)) > 0.05)
        warnings.push("Playback tracks have different lengths; check the end of this song.");
      // The chart and the MIDI file are checked together, because the file's messages play beside the chart's.
      const trigger = config.songs?.find((entry) => entry.id === id)?.trigger;
      if (config.songs && trigger) {
        const clashes = triggerClashes(config.songs, id);
        if (clashes.length)
          warnings.push(
            `Its MIDI trigger is also used by ${clashes.map((other) => other.title).join(", ")}. The first song in the library loads for that message.`,
          );
        const bound = bindingClaiming(trigger, config.bindings ?? []);
        if (bound) warnings.push(`A remote action answers its MIDI trigger (${describeBinding(bound)}), so the song does not load from it.`);
      }
      const cued = songCues(song.settings[""] || "", config.macros ?? [], midiFileFromOptions(options));
      if (cued.error) errors.push(`${cued.part === "midi-file" ? "MIDI file" : "Chart"} cannot play: ${cued.error}`);
      else {
        const start = trimRange(duration, options)?.start ?? 0;
        const lead = resolveLeadIn({ countInBars: "", startDelay: "", preRollBeats: ownLeadIn("preRollBeats", options.preRollBeats) }, LEAD_IN_DEFAULTS);
        const report = midiPreflight(cued.cues, {
          duration,
          playbackStart: preRollStart(start, lead.preRollBeats, bpm),
          clock: options.clock === true,
          tempoChannel: config.tempoOnStart ? config.tempoChannel : undefined,
          outputName: config.outputName,
          pedals: config.pedals,
          presetNames: config.presetNames,
          sections: parseSections(options.sections),
          range: trimRange(duration, options),
          bpm,
          beats: typeof options.beats === "number" ? options.beats : 4,
          firstBeat: typeof options.firstBeat === "number" ? options.firstBeat : 0,
        });
        warnings.push(...report.warnings.map((i) => i.text));
        advice.push(...report.advice.map((i) => i.text));
        try {
          const settings = savedPreparation(song.settings, config.preparationDefaults ?? PREPARATION_DEFAULTS);
          const start = trimRange(duration, options)?.start ?? 0;
          const lead = resolveLeadIn(
            { countInBars: "", startDelay: "", preRollBeats: ownLeadIn("preRollBeats", options.preRollBeats) },
            config.leadInDefaults ?? LEAD_IN_DEFAULTS,
          );
          // An invalid tempo already has its own actionable error above. Do not encode it as MIDI.
          const tempo =
            config.tempoOnStart && Number.isFinite(played) && played >= 40 && played <= 300 ? pedalTempoMessages(played, config.tempoChannel) : null;
          const plan = preparationSequence({
            cues: expandSectionCues(cued.cues, parseSections(options.sections)),
            position: preRollStart(start, lead.preRollBeats, bpm),
            requestedPosition: start,
            start,
            settings,
            triggers: config.pedals.flatMap((pedal) => pedal.triggers ?? []),
            history: new PreparationHistory(),
            pedalChannel: config.tempoChannel,
            tempo,
          });
          if (settings.enabled) {
            preparation = plan;
            warnings.push(...preparationPreflight(plan, config.pedals).map((issue) => issue.text));
          }
        } catch (reason) {
          errors.push(`Before song cannot prepare: ${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }
    }
    return { entry: entry + 1, id, title: song?.title ?? "Missing song", errors, warnings, advice, notes, ...(preparation ? { preparation } : {}) };
  });
  // The pedal's settings are the same for every song, so they are reported once, on the first entry.
  if (config.rig && checks.length > 0) {
    for (const issue of rigCheck({ ...config.rig, appClock: anyClock })) {
      const text = `Pedal settings: ${issue.text}`;
      (issue.level === "error" ? checks[0].errors : issue.level === "warning" ? checks[0].warnings : checks[0].advice).push(text);
    }
  }
  return checks;
}
