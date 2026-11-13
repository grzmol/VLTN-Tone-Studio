import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { host } from "@/host";
import { selectWholeSongStems, useSong } from "@/song/store";
import {
  planSections,
  RENDERED_KINDS,
  WHOLE_SONG_ID,
  type BandSettings,
  type FollowSource,
  type RenderedKind,
  type SectionBandHint,
  type SectionOverride,
} from "@/song/band/arrangement";
import { GENERATED_PART_NAMES } from "@/song/band/generated-names";
import type { NoteEvent } from "@/song/band/note";
import { encodeSmf } from "@/song/performance/smf";
import { startBeatGrid, type BeatGridJob } from "@/song/band/beat-grid-client";
import { chordChangeTimesOf, fixedBeatGrid, type BeatGrid } from "@/song/band/beat-grid";
import { bandSampleUrls, renderPreview, startBandRender, type BandJob } from "@/song/band/band-client";
import type { ChordAtBeat } from "@/song/band/harmony";
import type { BassOverride } from "@/song/band/bass-overrides";
import {
  THREE_FOUR_NOTE,
  bandHarmony,
  bandRequest,
  beatSources,
  chartChordTimes,
  followFor,
  followSourcesIn,
  levelStems,
  playsThreeFourDefault,
  previewMix,
} from "@/song/band/request";
import type { BassLineBeat } from "@/song/analysis/bass-line";
import { applyPartTone } from "@/song/band/part-tone";
import { automaticUpdateBlock, cleanFallbackQuestion, generatedLabel, missingToneFiles } from "@/song/band/tone-check";
import { storedShape } from "@/song/performance/song-shape";
import { renderPartChain } from "@/song/band/bass-chain";
import { bassOf, harmonyOf } from "@/song/analysis/analysis-audio";
import { followStatus } from "@/song/band/feel";
import { levelStatus } from "@/song/band/level";
import { startChordDetection } from "@/song/band/chord-detect-client";
import { barBeats } from "@/song/band/timing";
import { findStyle, type StyleId } from "@/song/band/styles";
import { sectionPreviewBars, type PreviewLength } from "@/song/band/band-job";
import type { PcmAudio } from "@/song/types";
import { parseChart, type Cue } from "@/song/performance/chart";
import type { Chord } from "@/song/performance/chords";
import type { Section } from "@/song/performance/sections";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import { useSongSettingsRevision } from "@/song/performance/use-song-settings";
import { registerBandRefresh, useBandRefreshStatus } from "@/song/band/refresh";
import { readOptions } from "@/song/performance/settings";
import { useSongLibrary } from "@/song/library";
import { bandAudioId } from "@/song/band/dependencies";
import { chartChordEvents } from "@/song/band/harmony";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { ORIGINAL_PARTS, partKeysOf, type PartChoices } from "@/song/band/part-choice";
import { asNotice, hasGeneratedParts, info, presenceLine, type BandNotice, type PartKind } from "./band-status";
import {
  BAND_ENTRY_ID,
  BASS_TONE_TEXT,
  DRUM_TONE_TEXT,
  PLAYHEAD,
  PLAYHEAD_BARS,
  PLAY_OFFER_MS,
  ownParts,
  PLAYING_TEXT,
  pendingLineUp,
  playOnce,
  replaceTitle,
  stageText,
  type PendingRendered,
} from "./band-panel-helpers";
import { BAND_TAB_LABELS, BAND_TABS, isBandTab, useBandPanel } from "./band-panel-state";
import { sectionKind, type BandSectionRow } from "./BandSections";
import { BandFooter, type PreviewChoice } from "./BandFooter";
import { BandTabFeel } from "./BandTabFeel";
import { BandTabNotes } from "./BandTabNotes";
import { BandTabParts } from "./BandTabParts";
import { BandTabSound } from "./BandTabSound";
import { BandTabTiming } from "./BandTabTiming";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { decodeAudioFile } from "@/song/decode";
import { MAX_IMPORT_SECONDS } from "@/song/import/import-tracks";
import { checkRenderedLength, firstOnsetSeconds, fitToLength, lineUpOffer } from "@/song/band/rendered";

/** The Band panel's inputs from the Performance screen: the song's chart, chords, sections and metronome. */
export interface BandPanelProps {
  /** The song's performance key, where its band settings and grid are saved. */
  songKey: string;
  /** True while the song or a playlist plays. Every action is disabled then. */
  playing: boolean;
  /** Actual audio playback, separate from a playlist waiting between songs. */
  audioPlaying?: boolean;
  chart: string;
  /** The detected chords, if the chord analysis has finished. */
  chords: Chord[];
  sections: Section[];
  /** The metronome's beats per bar, which is the bar length the beat is found with. */
  beats: number;
  bpm: number;
  firstBeat: number;
  /** True when the performer set the tempo by hand, tapped it or took it from the chart. The beat can then be found from it. */
  typedTempo?: boolean;
  /** Sets the metronome's tempo and first beat. Used by "Set metronome to this tempo". */
  onMetronome(bpm: number, firstBeat: number): void;
  /** The song position now, in seconds. The preview starts here when no section row is selected. */
  getPosition(): number;
  /** Starts playback from a song time, in seconds. Used by "Play from" after Generate. Not shown when not given. */
  onPlayFrom?(seconds: number): void;
  /** Which drums and bass play: the original, the generated track or both. */
  partChoices: PartChoices;
  /** Changes some parts' choice and updates the mix to match. Works while playing, since it only changes mute levels. */
  onPartChoice(patch: Partial<PartChoices>): void;
  /** The bass note the song's bass stem plays on each beat, from the song analysis. Null when the song has no bass stem or it is not read yet. */
  bassLine?: readonly BassLineBeat[] | null;
  /** The song analysis's sections: where the song's own drums or bass stop, and how loud each is. The plans default to follow them. */
  sectionHints?: readonly SectionBandHint[];
}

export { BandPanelButton, type BandPanelButtonProps } from "./BandPanelButton";

/** The Band panel: the song's beat grid, its band settings and sections, and the actions that generate, preview and remove the parts. */
export function BandPanel(props: BandPanelProps) {
  const open = useBandPanel((s) => s.open);
  const show = useBandPanel((s) => s.show);
  return (
    <Dialog open={open} onOpenChange={show}>
      <BandBody key={props.songKey} {...props} />
    </Dialog>
  );
}

function BandBody({
  songKey,
  playing,
  audioPlaying = playing,
  chart,
  chords,
  sections,
  beats,
  bpm,
  firstBeat,
  typedTempo = false,
  onMetronome,
  getPosition,
  onPlayFrom,
  partChoices,
  onPartChoice,
  bassLine = null,
  sectionHints = [],
}: BandPanelProps) {
  // On by default when the tempo was set by hand: the beat is then found near it, not from the tracker's own pick.
  const [useMyTempo, setUseMyTempo] = useState(true);
  const [stored] = useState(() => readStoredBand(songKey));
  const [settings, setSettings] = useState<BandSettings>(stored.settings);
  // The latest settings for the steps that finish later (a render, a rendered file), which would otherwise write the settings they started with.
  const settingsRef = useRef<BandSettings>(stored.settings);
  const [pendingRendered, setPendingRendered] = useState<PendingRendered | null>(null);
  const [confirmClean, setConfirmClean] = useState<{ question: string; run(): void } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<{ kinds: RenderedKind[]; run(): void } | null>(null);
  const [grid, setGrid] = useState<BeatGrid | null>(stored.grid);
  const settingsVersion = useSongSettingsRevision(songKey);
  const automaticPromise = useRef<Promise<void> | null>(null);
  const appliedInputs = useRef<string | null>(null);
  const hydratedInputs = useRef<string | null>(null);
  const requestedInputs = useRef<string | null>(null);
  const failedInputs = useRef<string | null>(null);
  const musicalTempo = useRef({ bpm, firstBeat, beats });
  const [outOfDate, setOutOfDate] = useState(stored.outOfDate);
  const [notices, setNoticeList] = useState<BandNotice[]>([]);
  const setNotices = (list: readonly (string | BandNotice)[]) => setNoticeList(list.map(asNotice));
  const [work, setWork] = useState<string | null>(null);
  const dialogOpen = useBandPanel((s) => s.open);
  const [selected, setSelected] = useState<number | null>(null);
  // What the running preview is, for the footer ("Previewing Chorus (8 bars)…"), or null when none plays.
  const [previewing, setPreviewing] = useState<string | null>(null);
  // The section menu's choice: a row index as text, "playhead", or null for the selected row (the first when none is selected).
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [previewLength, setPreviewLength] = useState<PreviewChoice>("whole");
  // True after a Generate that went through, until the next action. The footer then offers Close and Play from.
  const [done, setDone] = useState(false);
  // True while Find the beat runs, so its progress stays in the beat grid section and the footer shows the rest.
  const [finding, setFinding] = useState(false);
  const show = useBandPanel((s) => s.show);
  const tab = useBandPanel((s) => s.tab);
  const setTab = useBandPanel((s) => s.setTab);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The notes of the last Generate, kept so they can be exported as a MIDI file.
  const [lastNotes, setLastNotes] = useState<{ drums: NoteEvent[]; bass: NoteEvent[] } | null>(null);
  const job = useRef<{ cancel(): void } | null>(null);
  const active = useRef(true);
  const stopPreview = useRef<(() => void) | null>(null);
  const playingNow = useRef(audioPlaying);
  useEffect(() => {
    playingNow.current = audioPlaying;
  }, [audioPlaying]);
  useEffect(() => {
    if (!dialogOpen || playing) {
      stopPreview.current?.();
      stopPreview.current = null;
      setPreviewing(null);
      if (playing || !automaticPromise.current) job.current?.cancel();
    }
  }, [dialogOpen, playing]);
  useEffect(() => {
    useBandRefreshStatus.setState({ key: songKey, message: work ?? "" });
    return () => {
      if (useBandRefreshStatus.getState().key === songKey) useBandRefreshStatus.setState({ key: "", message: "" });
    };
  }, [songKey, work]);
  useEffect(() => {
    active.current = true;
    useSong.getState().checkMissingParts();
    return () => {
      active.current = false;
      job.current?.cancel();
      stopPreview.current?.();
    };
  }, []);

  const source = useSong((s) => s.source);
  const stems = useSong(selectWholeSongStems);
  const tracks = useSong((s) => s.tracks);
  const missing = useSong((s) => s.missingParts);
  const cues = useMemo<Cue[]>(() => {
    try {
      return parseChart(chart, useMidiConfiguration.getState().macros);
    } catch {
      return [];
    }
  }, [chart]);
  const songEnd = source ? source.audio.channels[0].length / source.audio.sampleRate : 0;
  const plans = useMemo(() => planSections(sections, songEnd, settings, sectionHints), [sections, songEnd, settings, sectionHints]);
  const harmony = useMemo<ChordAtBeat[]>(
    () => (grid ? bandHarmony({ grid, cues, chords, songEnd, settings, bassLine }) : []),
    [grid, cues, chords, songEnd, settings, bassLine],
  );
  const busy = work !== null;
  // With no song there is nothing to find a beat in or to render, so every action waits for one.
  const blocked = busy || playing || source === null;
  // Audio bookkeeping changes after Generate are not musical edits. Everything that determines the notes belongs to this key.
  const generationInputs = (using: BandSettings) => {
    // What a part was rendered with is a result of Generate, not an input to it.
    const { firstNote: _firstNote, rendered: _rendered, renderedTone: _renderedTone, ...musical } = using;
    const originalAudio = Object.entries(stems ?? {})
      .filter(([key]) => tracks?.[key]?.kind !== "user")
      .map(([key, audio]) => [key, audio ? bandAudioId(audio) : null]);
    return JSON.stringify([
      source && bandAudioId(source.audio),
      originalAudio,
      grid,
      chartChordEvents(cues),
      chords,
      sections,
      sectionHints,
      bassLine,
      musical,
    ]);
  };

  const generated = hasGeneratedParts(tracks);
  const partKeys = partKeysOf(tracks ?? {}, stems);
  const followSources: FollowSource[] = ["auto", ...(followSourcesIn(stems) as FollowSource[])];

  const save = (next: BandSettings) => {
    settingsRef.current = next;
    setSettings(next);
    setOutOfDate(true);
    writeStoredBand(songKey, { band: next, bandOutOfDate: true });
  };
  /** Saves band settings that are not an edit (the rendered parts and first notes). The parts stay as they are. */
  const commitBand = (next: BandSettings) => {
    settingsRef.current = next;
    setSettings(next);
    writeStoredBand(songKey, { band: next });
  };
  const change = (patch: Partial<BandSettings>) => save({ ...settings, ...patch });
  const changeStyle = (id: StyleId) => {
    const next = findStyle(id);
    // A walking bass is only offered for a style that walks, so a walking choice falls back to roots when the style changes away from it.
    save({
      ...settings,
      style: id,
      swing: next?.swingDefault ?? settings.swing,
      bassMode: settings.bassMode === "walking" && !next?.bass.walking ? "roots" : settings.bassMode,
    });
  };
  /** Writes a row's override. A song without sections keeps its one row's overrides under WHOLE_SONG_ID. */
  const changeRow = (sectionId: string | null, patch: SectionOverride) => {
    const key = sectionId ?? WHOLE_SONG_ID;
    const current = settings.sections[key] ?? {};
    save({ ...settings, sections: { ...settings.sections, [key]: { ...current, ...patch } } });
  };

  /** Gives every section of the same kind (Verse 1, Verse 2 …) the overrides this one has. Other sections keep theirs. */
  const copyToSameKind = (sectionId: string | null) => {
    const from = settings.sections[sectionId ?? WHOLE_SONG_ID];
    const source = rows.find((row) => row.plan.sectionId === sectionId);
    if (!from || !source) return;
    const next = { ...settings.sections };
    for (const row of rows) {
      if (row.plan.sectionId !== null && sectionKind(row.name) === sectionKind(source.name)) next[row.plan.sectionId] = { ...from };
    }
    save({ ...settings, sections: next });
  };
  /** Takes a section's overrides away, so its plan is automatic again. */
  const resetRow = (sectionId: string | null) => {
    const { [sectionId ?? WHOLE_SONG_ID]: _removed, ...rest } = settings.sections;
    save({ ...settings, sections: rest });
  };

  const applyGrid = (next: BeatGrid | null) => {
    setGrid(next);
    setOutOfDate(true);
    writeStoredBand(songKey, { beatGrid: next, bandOutOfDate: true });
  };

  /**
   * Runs one action that can fail or be cancelled. An error or a cancel becomes a notice in the panel, and the job and the busy line are
   * cleared, so an action cannot leave the panel busy, and nothing it does closes the dialog.
   */
  const attempt = async (cancelled: string, action: () => Promise<void>) => {
    setDone(false);
    try {
      await action();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      setNotices([aborted ? cancelled : error instanceof Error ? error.message : String(error)]);
    } finally {
      job.current = null;
      setWork(null);
      setFinding(false);
    }
  };

  const rows: BandSectionRow[] = plans.map((plan) => {
    const section = sections.find((candidate) => candidate.id === plan.sectionId);
    const override = settings.sections[plan.sectionId ?? WHOLE_SONG_ID] ?? {};
    return {
      plan,
      name: plan.sectionId === null ? "Whole song" : (section?.name ?? "Section"),
      choice: override.bassPart ?? "auto",
      override,
      color: section?.color,
      bars: grid ? Math.max(1, Math.round(((plan.end - plan.start) * grid.bpm) / 60 / barBeats(grid))) : null,
    };
  });

  /** Finds the beat in the song's audio. The drums stem is read when present, else the pitched stems, else the mix. */
  const findBeat = async () => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before finding the beat."]);
    setNotices([]);
    setWork("Finding the beat…");
    setFinding(true);
    await attempt("Finding the beat was cancelled.", async () => {
      const found: BeatGridJob = startBeatGrid({
        sources: beatSources(selectWholeSongStems(useSong.getState()), current.audio),
        sampleRate: current.audio.sampleRate,
        beatsPerBar: beats,
        // The chart's chord changes, or else the detected chords, so the downbeat follows the chords when the chart has none.
        chordChanges: chartChordTimes(cues).length ? chartChordTimes(cues) : chordChangeTimesOf(chords),
        tempoHint: typedTempo && useMyTempo ? bpm : undefined,
      });
      job.current = found;
      const next = await found.done;
      if (next.beats.length === 0) setNotices(["No beat was found in this song. Use fixed BPM, or set the tempo by hand."]);
      else applyGrid(next);
    });
  };

  /**
   * Finds chords in the bass-free audio, when the chart and the chord analysis gave none. Null when the step was cancelled. The job is the
   * panel's current job, so Cancel stops it the same way it stops the render.
   */
  const detectChords = async (audio: PcmAudio): Promise<Chord[] | null> => {
    setWork("Detecting chords…");
    const stems = selectWholeSongStems(useSong.getState());
    const detecting = startChordDetection({ harmony: harmonyOf(stems, audio).audio, bass: bassOf(stems), beats: grid?.beats ?? null });
    job.current = detecting;
    try {
      return await detecting.done;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return null;
      throw error;
    } finally {
      job.current = null;
    }
  };

  /**
   * Generates the parts. With `only`, just that part is generated and the other part's track is left alone: Back to generated uses this,
   * since the generated audio is not kept, so the part is rendered again.
   */
  /** The song's saved Trim end, so the ending lands on the last full bar before it. */
  const savedTrimEnd = (): number | undefined => storedShape(readOptions<Record<string, unknown>>(songKey, {})).trimEnd;

  const generate = async (requested: BandSettings, only?: RenderedKind) => {
    const using: BandSettings = only ? { ...requested, parts: { drums: only === "drums", bass: only === "bass" } } : requested;
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before generating parts."]);
    if (!grid) return setNotices(["Find the beat first, so the parts have a grid to follow."]);
    if (!using.parts.drums && !using.parts.bass) return setNotices(["Turn on drums or bass first."]);
    let succeeded = false;
    const startedInputs = generationInputs(requested);
    await attempt("Generating the parts was cancelled. The tracks were not changed.", async () => {
      const input = {
        grid,
        cues,
        chords,
        sections,
        settings: using,
        songEnd,
        trimEnd: savedTrimEnd(),
        lengthFrames: current.audio.channels[0].length,
        sampleUrls: bandSampleUrls(),
        follow: followFor(using, selectWholeSongStems(useSong.getState()), current.audio),
        mix: current.audio,
        originals: levelStems(selectWholeSongStems(useSong.getState())),
        bassLine,
        hints: sectionHints,
      };
      let request = bandRequest(input);
      const notes: (string | BandNotice)[] = [];
      if (playsThreeFourDefault(request)) notes.push(info(THREE_FOUR_NOTE));
      if (using.parts.bass && !request.harmony.some((entry) => entry.chord)) {
        // Neither the chart nor the screen's analysis has chords, so the bass would rest all song. Detect them from the audio first.
        let found: Chord[] | null = [];
        try {
          found = await detectChords(current.audio);
        } catch (error) {
          notes.push(error instanceof Error ? error.message : String(error));
        }
        if (found === null) return setNotices(["Generating the parts was cancelled. The tracks were not changed."]);
        if (found.length) request = bandRequest({ ...input, chords: found });
        if (!request.harmony.some((entry) => entry.chord)) {
          notes.push("No chords were found in the chart or the audio, so the bass will rest. Add chords to the chart, then generate again.");
        }
      }
      setNotices(notes);
      setWork(stageText("loading"));
      const rendering: BandJob = startBandRender(request);
      job.current = rendering;
      rendering.onProgress((stage) => setWork(stageText(stage)));
      const result = await rendering.done;
      if (!active.current || useSong.getState().source !== current) return;
      setLastNotes(result.notes);
      // The bass tone is applied before the bass is saved, so the saved bass is the one Generate made. A tone that can't be used
      // leaves the clean bass and a notice.
      let bass = result.bass;
      let drums = result.drums;
      const renderedTone: BandSettings["renderedTone"] = {};
      if (drums && using.drumTone.kind === "chain") {
        setWork(DRUM_TONE_TEXT);
        const toned = await applyPartTone(drums, using.drumTone, host.tones, renderPartChain, "drums");
        drums = toned.audio;
        renderedTone.drums = toned.tone;
        if (toned.notice) notes.push(toned.notice);
      }
      if (bass && using.bassTone.kind !== "clean") {
        setWork(BASS_TONE_TEXT);
        const toned = await applyPartTone(bass, using.bassTone, host.tones, renderPartChain, "bass");
        bass = toned.audio;
        renderedTone.bass = toned.tone;
        if (toned.notice) notes.push(toned.notice);
      }
      if (result.follow) notes.push(info(followStatus(result.follow)));
      const levels = levelStatus(result.levels);
      if (levels) notes.push(info(levels));
      // A part that is turned off loses its generated track in the same update as the parts that are applied.
      if (!active.current || useSong.getState().source !== current) return;
      if (requestedInputs.current !== null && requestedInputs.current !== startedInputs) return;
      const turnedOff = only ? [] : (["drums", "bass"] as const).filter((kind) => !using.parts[kind]);
      const applied = useSong.getState().applyGeneratedParts({ drums, bass }, { playing: playingNow.current, remove: turnedOff });
      if (applied.length === 0) {
        if (current.libraryId) await useSongLibrary.getState().saveBeforePlayback(true);
        if (!active.current || useSong.getState().source !== current || requestedInputs.current !== startedInputs) return;
        succeeded = true;
        appliedInputs.current = startedInputs;
        hydratedInputs.current = startedInputs;
        // A part that was just generated plays at once when it was on its original, so the user hears what they made. A part turned off
        // with its generated track gone goes back to its original.
        const patch: Partial<PartChoices> = {};
        for (const kind of turnedOff) patch[kind] = "original";
        const switched = (["drums", "bass"] as const).filter((kind) => using.parts[kind] && result[kind] && partChoices[kind] === "original");
        for (const kind of switched) patch[kind] = "generated";
        if (Object.keys(patch).length) onPartChoice(patch);
        if (switched.length) notes.push(info(`Now playing the generated ${switched.join(" and ")}. Switch back under What plays.`));
      }
      setNotices([...notes, ...applied]);
      setDone(applied.length === 0);
      // Each generated part's first note is kept, so a rendered file can be lined up with it. A part that was replaced or removed is no
      // longer rendered, unless the generation was refused.
      const latest = settingsRef.current;
      const firstNote = { ...latest.firstNote };
      const rendered = { ...latest.rendered };
      // What each generated part was rendered with, so the Sound tab can say when a part is clean because its tone files were missing.
      const toneNow: BandSettings["renderedTone"] = { ...latest.renderedTone };
      for (const part of ["drums", "bass"] as const) {
        if (!using.parts[part]) continue;
        toneNow[part] = renderedTone[part] ?? "clean";
      }
      for (const kind of RENDERED_KINDS) {
        const times = (result.notes[kind] ?? []).map((note) => note.time);
        if (using.parts[kind] && times.length) firstNote[kind] = Math.min(...times);
        else if (using.parts[kind]) delete firstNote[kind];
        if (applied.length === 0 && (using.parts[kind] || turnedOff.includes(kind))) delete rendered[kind];
      }
      commitBand({ ...latest, firstNote, rendered, ...(applied.length === 0 ? { renderedTone: toneNow } : {}) });
      if (applied.length === 0) {
        setOutOfDate(false);
        writeStoredBand(songKey, { bandOutOfDate: false, bandTempoChanged: false });

      }
    });
    return succeeded;
  };

  // Options can change in the song editor or an analysis while the Band dialog is closed.
  useEffect(() => {
    const latest = readStoredBand(songKey);
    if (JSON.stringify(latest.settings) !== JSON.stringify(settingsRef.current)) {
      settingsRef.current = latest.settings;
      setSettings(latest.settings);
    }
    if (JSON.stringify(latest.grid) !== JSON.stringify(grid)) setGrid(latest.grid);
    setOutOfDate(latest.outOfDate);
  }, [songKey, settingsVersion]);
  useEffect(() => {
    const previous = musicalTempo.current;
    musicalTempo.current = { bpm, firstBeat, beats };
    const tempoChanged = readOptions(songKey, { bandTempoChanged: false }).bandTempoChanged;
    const gridStart = grid?.steady?.firstBeat ?? grid?.beats[Math.round(grid.downbeat)];
    const staleTempo =
      (typedTempo || tempoChanged) &&
      grid &&
      (Math.abs(grid.bpm - bpm) > 0.1 || grid.beatsPerBar !== beats || (gridStart !== undefined && Math.abs(gridStart - firstBeat) > 0.01));
    if (previous.bpm === bpm && previous.firstBeat === firstBeat && previous.beats === beats && !staleTempo) return;
    if (source && grid && bpm > 0) applyGrid(fixedBeatGrid(bpm, firstBeat, beats, songEnd));
  }, [bpm, firstBeat, beats, source, songEnd, typedTempo]);
  const musicalInputs = generationInputs(settings);
  if (appliedInputs.current === null) appliedInputs.current = musicalInputs;
  requestedInputs.current = musicalInputs;
  const needsSnapshot = dialogOpen && settings.parts.drums && !settings.rendered.drums && lastNotes === null && hydratedInputs.current !== musicalInputs;
  const refreshNow = useRef<() => Promise<void>>(async () => {});
  refreshNow.current = async () => {
    if (automaticPromise.current) return automaticPromise.current;
    if (!source || !generated || (!outOfDate && appliedInputs.current === musicalInputs && !needsSnapshot)) return;
    if (playingNow.current) throw new Error("Generated parts are waiting to update when playback stops.");
    if (busy) throw new Error("The band parts are still updating. Wait for the update to finish.");
    const kinds = RENDERED_KINDS.filter((kind) => settings.parts[kind] && !settings.rendered[kind]);
    if (!kinds.length) {
      if (!settings.parts.drums && !settings.parts.bass) {
        const notices = useSong.getState().removeGeneratedParts({ playing: false });
        if (notices.length) throw new Error(notices.join(" "));
        onPartChoice(ORIGINAL_PARTS);
        appliedInputs.current = musicalInputs;
        setOutOfDate(false);
        writeStoredBand(songKey, { bandOutOfDate: false });
      }
      return; // Imported rendered parts belong to the performer and are never replaced automatically.
    }
    const run = (async () => {
      // An automatic update never swaps good audio for a clean part: with a tone file missing it stops and says so.
      const blocked = await automaticUpdateBlock(settings, host.tones);
      if (blocked) {
        // A missing tone must never stop playback: the parts already there are kept and play, and the notice says why they were not updated.
        // The automatic effect does not try again for these inputs.
        failedInputs.current = musicalInputs;
        setNotices([blocked]);
        return;
      }
      const protectsRendered = RENDERED_KINDS.some((kind) => settings.parts[kind] && settings.rendered[kind]);
      const ok = protectsRendered ? await generate(settings, kinds[0]) : await generate(settings);
      if (!ok) throw new Error("Automatic band update could not finish. Open Drums & bass for the reason; playback will wait.");
      // Let the source store's new buffers reach the performance session before its transport starts.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    })();
    automaticPromise.current = run;
    try {
      await run;
    } finally {
      automaticPromise.current = null;
    }
  };
  useEffect(() => registerBandRefresh(songKey, () => refreshNow.current()), [songKey]);
  useEffect(() => {
    if (
      audioPlaying ||
      busy ||
      !generated ||
      failedInputs.current === musicalInputs ||
      (!outOfDate && appliedInputs.current === musicalInputs && !needsSnapshot)
    )
      return;
    const timer = setTimeout(() => {
      void refreshNow.current().catch((error) => {
        failedInputs.current = musicalInputs;
        setNotices([String(error.message ?? error)]);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [musicalInputs, outOfDate, audioPlaying, busy, generated, needsSnapshot]);

  /** Generate replaces a part that is the performer's rendered audio, so it asks first. */
  const generateOrAsk = async (next: BandSettings) => {
    const replacing = RENDERED_KINDS.filter((kind) => next.parts[kind] && settingsRef.current.rendered[kind]);
    const go = () => {
      if (replacing.length) setConfirmReplace({ kinds: replacing, run: () => void generate(next) });
      else void generate(next);
    };
    // Only an explicit Generate may fall back to a clean part, and it asks first.
    if (next.bassTone.kind !== "chain" && next.drumTone.kind !== "chain") return go();
    const question = cleanFallbackQuestion(await missingToneFiles(next, host.tones));
    if (question) setConfirmClean({ question, run: go });
    else go();
  };

  /** Puts a rendered file in place of a part's generated audio, or offers the line-up first when the file's first hit is off the first note. */
  const applyRendered = (kind: RenderedKind, name: string, audio: PcmAudio, notices: BandNotice[]) => {
    const parts = kind === "drums" ? { drums: audio } : { bass: audio };
    const applied = useSong.getState().applyGeneratedParts(parts, { playing: playingNow.current });
    setPendingRendered(null);
    if (applied.length) return setNotices([...notices, ...applied]);
    const latest = settingsRef.current;
    commitBand({ ...latest, rendered: { ...latest.rendered, [kind]: { name, importedAt: new Date().toISOString() } } });
    const rendering = [...notices];
    // A part that was on its original plays its rendered audio at once, as a generated part does, so the performer hears what they brought in.
    if (partChoices[kind] === "original") {
      const patch: Partial<PartChoices> = kind === "drums" ? { drums: "generated" } : { bass: "generated" };
      onPartChoice(patch);
      rendering.push(info(`Now playing your rendered ${kind}. Switch back under What plays.`));
    }
    setNotices(rendering);
  };

  /** Reads a file the performer picked as the part's rendered audio: checks its length, then applies it or offers the line-up. */
  const importRendered = async (kind: RenderedKind, file: File) => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before using a rendered part."]);
    if (playingNow.current) return setNotices([PLAYING_TEXT]);
    setNotices([]);
    setWork(`Reading ${file.name}…`);
    try {
      const decoded = await decodeAudioFile(file, MAX_IMPORT_SECONDS);
      const frames = current.audio.channels[0].length;
      const check = checkRenderedLength(file.name, decoded.channels[0].length / decoded.sampleRate, frames / current.audio.sampleRate);
      if (!check.accepted) return setNotices([check.notice ?? `${file.name} was not used.`]);
      const notices: BandNotice[] = check.notice ? [asNotice(check.notice)] : [];
      const firstNote = settingsRef.current.firstNote[kind] ?? null;
      const line = lineUpOffer(firstOnsetSeconds(decoded), firstNote);
      if (line?.offer) {
        // The line-up row says what the gap is, so the notice list keeps only the length note.
        setPendingRendered({ kind, name: file.name, decoded, line, notices });
        return setNotices(notices);
      }
      if (line) notices.push(info(line.text));
      else notices.push(info("No generated part to line up with, so the file is used as it is."));
      applyRendered(kind, file.name, fitToLength(decoded, frames), notices);
    } catch (error) {
      setNotices([error instanceof Error ? error.message : String(error)]);
    } finally {
      setWork(null);
    }
  };

  /** Back to generated renders the part again with the current settings: the generated audio is not kept, so this is Generate for it alone. */
  const backToGenerated = (kind: RenderedKind) => void generate(settingsRef.current, kind);

  const tryAnother = () => {
    const next = { ...settings, seed: 1 + Math.floor(Math.random() * 0xfffffffe) };
    save(next);
    void generateOrAsk(next);
  };

  /**
   * Renders `bars` bars from `from` with the band `using`, which is the saved settings or a choice not saved yet, and plays them. Nothing is
   * saved by a preview.
   */
  const previewWith = async (from: number, bars: number, using: BandSettings, label: string) => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before previewing."]);
    if (!grid) return setNotices(["Find the beat first, so the preview has a grid to follow."]);
    if (!using.parts.drums && !using.parts.bass) return setNotices(["Turn on drums or bass to preview them."]);
    setNotices([]);
    setWork("Rendering the preview…");
    await attempt("Rendering the preview was cancelled.", async () => {
      const request = bandRequest({
        grid,
        cues,
        chords,
        sections,
        settings: using,
        songEnd,
        trimEnd: savedTrimEnd(),
        lengthFrames: current.audio.channels[0].length,
        sampleUrls: bandSampleUrls(),
        follow: followFor(using, selectWholeSongStems(useSong.getState()), current.audio),
        mix: current.audio,
        originals: levelStems(selectWholeSongStems(useSong.getState())),
        bassLine,
        hints: sectionHints,
      });
      const rendering: BandJob = renderPreview(request, from, bars);
      job.current = rendering;
      const result = await rendering.done;
      // The preview hears the bass tone too, so it matches what Generate would save.
      let bass = result.bass;
      let drums = result.drums;
      const toneNotices: string[] = [];
      if (drums && settings.drumTone.kind === "chain") {
        setWork(DRUM_TONE_TEXT);
        const toned = await applyPartTone(drums, settings.drumTone, host.tones, renderPartChain, "drums");
        drums = toned.audio;
        if (toned.notice) toneNotices.push(toned.notice);
      }
      if (bass && settings.bassTone.kind !== "clean") {
        setWork(BASS_TONE_TEXT);
        const toned = await applyPartTone(bass, settings.bassTone, host.tones, renderPartChain, "bass");
        bass = toned.audio;
        if (toned.notice) toneNotices.push(toned.notice);
      }
      if (toneNotices.length) setNotices(toneNotices);
      const mixed = previewMix(current.audio, from, { ...result, drums, bass });
      setWork(null);
      stopPreview.current = playOnce(mixed, () => {
        stopPreview.current = null;
        setPreviewing(null);
      });
      setPreviewing(label);
    });
  };

  // The rows as sections, so the preview length is measured the same way for a song without sections (its one row spans the song).
  const rowSections: Section[] = rows.map(({ plan, name }, index) => ({
    id: plan.sectionId ?? `row-${index}`,
    name,
    start: plan.start,
    end: plan.end,
    mode: "continue",
  }));
  const target = previewAt ?? String(selected ?? 0);
  const targetRow = target === PLAYHEAD ? null : (rows[Number(target)] ?? rows[0] ?? null);
  const preview = () => {
    const index = targetRow ? rows.indexOf(targetRow) : -1;
    const length: PreviewLength = previewLength === "whole" ? "whole" : previewLength === "4" ? 4 : 8;
    if (!grid) return;
    const bars = index >= 0 ? sectionPreviewBars(grid, rowSections, index, length, songEnd) : length === "whole" ? PLAYHEAD_BARS : length;
    const where = index >= 0 ? rows[index].name : "the playhead";
    return previewWith(index >= 0 ? rows[index].plan.start : getPosition(), bars, settings, `Previewing ${where} (${bars} ${bars === 1 ? "bar" : "bars"})…`);
  };
  /** Plays about two bars around a bass note being edited, with the choice in place. The choice is not saved. */
  const listen = (from: number, overrides: BassOverride[]) => previewWith(from, 2, { ...settings, bassOverrides: overrides }, "Previewing the bass notes…");

  /**
   * Saves the last Generate's notes as a standard MIDI file named after the song. Drums are on channel 10 and bass on channel 1, the
   * channels a sequencer or a drum machine expects.
   */
  const exportMidi = async () => {
    if (!lastNotes || !grid) return;
    const title = (source?.name ?? "").replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-") || "Song";
    const bytes = encodeSmf(
      [
        { name: GENERATED_PART_NAMES.drums, channel: 9, notes: lastNotes.drums },
        { name: GENERATED_PART_NAMES.bass, channel: 0, notes: lastNotes.bass },
      ],
      grid,
    );
    try {
      await host.song.saveFiles([{ name: `${title} - band.mid`, bytes }], "Export band MIDI");
    } catch (error) {
      setNotices([error instanceof Error ? error.message : String(error)]);
    }
  };

  const removeParts = () => {
    setConfirmRemove(false);
    try {
      const refused = useSong.getState().removeGeneratedParts({ playing: playingNow.current });
      setNotices(refused);
      if (refused.length === 0) {
        // The rendered audio went with the generated tracks.
        commitBand({ ...settingsRef.current, rendered: {} });
        onPartChoice(ORIGINAL_PARTS);
      }
    } catch (error) {
      setNotices([error instanceof Error ? error.message : String(error)]);
    }
  };

  const usesFixed = () => {
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before using a fixed tempo."]);
    setNotices([]);
    applyGrid(fixedBeatGrid(bpm, firstBeat, beats, songEnd));
  };

  const setTo = () => {
    if (!grid?.steady) return;
    const tempo = Math.round(grid.steady.bpm * 100) / 100;
    if (tempo < 30 || tempo > 300) return setNotices(["The tempo is outside the metronome's range of 30 to 300 BPM."]);
    onMetronome(tempo, Math.round(Math.max(0, grid.steady.firstBeat) * 1000) / 1000);
    setNotices([info("The metronome now runs at this tempo.")]);
  };

  // Play from the start is offered in Preview's place for five seconds after a Generate.
  const [offerPlay, setOfferPlay] = useState(false);
  useEffect(() => {
    if (!done) return setOfferPlay(false);
    setOfferPlay(true);
    const timer = setTimeout(() => setOfferPlay(false), PLAY_OFFER_MS);
    return () => clearTimeout(timer);
  }, [done]);
  const playFrom =
    offerPlay && onPlayFrom
      ? {
          label: selected !== null ? `Play from ${rows[selected].name}` : "Play from the start",
          run: () => {
            show(false);
            onPlayFrom(selected !== null ? rows[selected].plan.start : 0);
          },
        }
      : null;
  const cancelWork = () => {
    failedInputs.current = musicalInputs;
    job.current?.cancel();
  };
  const partLine = (kind: PartKind) => presenceLine(kind, missing?.[kind] ?? "unknown", missing?.absentSections[kind] ?? [], sections);

  return (
    <DialogContent
      className="flex h-[calc(100dvh-2rem)] w-[min(1200px,calc(100vw-2rem))] min-w-0 flex-col gap-1.5 overflow-hidden px-4 pb-2.5 pt-4 sm:max-w-none"
      onCloseAutoFocus={(event) => {
        // The panel is opened from the store, not from a trigger, so Radix has nothing to return focus to: give it back to the entry button.
        const entry = document.getElementById(BAND_ENTRY_ID);
        if (entry) {
          event.preventDefault();
          entry.focus();
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Band</DialogTitle>
        <DialogDescription>
          Generated parts update automatically after musical changes while playback is stopped. Generate also makes new parts on demand.
        </DialogDescription>
      </DialogHeader>
      <section aria-label="Band status" className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
        {ownParts(missing) && <p>{ownParts(missing)}</p>}
        {(["drums", "bass"] as const).map((kind) => missing?.[kind] !== "present" && <p key={kind}>{partLine(kind)}</p>)}
        <p className="text-silkscreen-3">{generated ? "Generated drum and bass tracks are in the mixer." : "No generated parts yet."}</p>
        {outOfDate && <p className="text-led-warn">Parts out of date. Updating automatically when playback stops.</p>}
      </section>
      <Tabs value={tab} onValueChange={(value) => isBandTab(value) && setTab(value)} className="min-h-0 flex-1 gap-2">
        <TabsList aria-label="Band sections">
          {BAND_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {BAND_TAB_LABELS[id]}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* Every tab stays mounted and is hidden with CSS, so nothing typed or chosen in one is lost when the performer switches. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto text-sm">
          <TabsContent forceMount value="parts" className="min-w-0 data-[state=inactive]:hidden">
            <BandTabParts
              rows={rows}
              disabled={blocked}
              selected={selected}
              onSelect={(index) => {
                setSelected(index);
                if (index !== null) setPreviewAt(null);
              }}
              onChange={changeRow}
              onCopyToSameKind={copyToSameKind}
              onReset={resetRow}
              beatsPerBar={grid?.beatsPerBar}
            />
          </TabsContent>
          <TabsContent forceMount value="feel" className="min-w-0 data-[state=inactive]:hidden">
            <BandTabFeel
              settings={settings}
              followSources={followSources}
              onChange={change}
              onStyle={changeStyle}
              beatsPerBar={grid?.beatsPerBar}
              sections={rows.flatMap((row) => (row.plan.sectionId === null ? [] : [{ id: row.plan.sectionId, name: row.name }]))}
            />
          </TabsContent>
          <TabsContent forceMount value="sound" className="min-w-0 data-[state=inactive]:hidden">
            <BandTabSound
              settings={settings}
              onChange={change}
              hasSong={source !== null}
              partChoices={partChoices}
              partKeys={partKeys}
              generatedNotes={{ drums: generatedLabel(settings, "drums"), bass: generatedLabel(settings, "bass") }}
              onPartChoice={onPartChoice}
              busy={busy}
              blocked={blocked}
              pendingLineUp={(kind) =>
                source && pendingLineUp(pendingRendered, kind, () => setPendingRendered(null), applyRendered, source.audio.channels[0].length)
              }
              onFile={(kind, file) => void importRendered(kind, file)}
              onBack={(kind) => void backToGenerated(kind)}
              songSeconds={songEnd}
            />
          </TabsContent>
          <TabsContent forceMount value="notes" className="min-w-0 data-[state=inactive]:hidden">
            <BandTabNotes
              grid={grid}
              harmony={harmony}
              blocked={blocked}
              busy={false}
              work={null}
              onGrid={applyGrid}
              onFind={() => void findBeat()}
              onCancel={cancelWork}
              onFixed={usesFixed}
              onSetTempo={setTo}
              bassNotes={{
                overrides: settings.bassOverrides,
                bassFrom: settings.bassFrom,
                bassLine,
                sections,
                songEnd,
                disabled: blocked,
                onChange: (next) => change({ bassOverrides: next }),
                onListen: (from, next) => void listen(from, next),
              }}
            />
          </TabsContent>
          <TabsContent forceMount value="timing" className="min-w-0 data-[state=inactive]:hidden">
            <BandTabTiming
              grid={grid}
              harmony={harmony}
              blocked={blocked}
              busy={busy && finding}
              work={finding ? work : null}
              onGrid={applyGrid}
              onFind={() => void findBeat()}
              onCancel={cancelWork}
              onFixed={usesFixed}
              onSetTempo={setTo}
              myTempo={typedTempo ? { bpm, use: useMyTempo, onUse: setUseMyTempo } : undefined}
            />
          </TabsContent>
        </div>
      </Tabs>

      <BandFooter
        noSong={source === null}
        playing={playing}
        work={work}
        finding={finding}
        previewing={previewing}
        done={done}
        playFrom={playFrom}
        notices={notices}
        blocked={blocked}
        hasGrid={grid !== null}
        hasGeneratedParts={generated}
        canExportMidi={lastNotes !== null}
        previewLength={previewLength}
        fromPlayhead={target === PLAYHEAD}
        onPreviewLength={setPreviewLength}
        onFromPlayhead={(on) => setPreviewAt(on ? PLAYHEAD : null)}
        onCancel={cancelWork}
        onGenerate={() => void generateOrAsk(settings)}
        onTryAnother={tryAnother}
        onPreview={() => void preview()}
        onStopPreview={() => stopPreview.current?.()}
        onRemove={() => setConfirmRemove(true)}
        onExportMidi={() => void exportMidi()}
      />



      <AlertDialog open={confirmClean !== null} onOpenChange={(open) => !open && setConfirmClean(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmClean?.question}</AlertDialogTitle>
            <AlertDialogDescription>
              A tone file is missing on this computer, so the part is rendered without its tone. Download the file or switch the tone to Clean to avoid this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep what I have</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const run = confirmClean?.run;
                setConfirmClean(null);
                run?.();
              }}
            >
              Generate clean
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReplace !== null} onOpenChange={(open) => !open && setConfirmReplace(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{replaceTitle(confirmReplace?.kinds ?? [])}</AlertDialogTitle>
            <AlertDialogDescription>The rendered audio in the song is replaced. Your file is not changed, and you can use it again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my rendered part</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const run = confirmReplace?.run;
                setConfirmReplace(null);
                run?.();
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the generated parts?</AlertDialogTitle>
            <AlertDialogDescription>The generated drum and bass tracks are removed from the song. Your own tracks are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={removeParts}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
}
