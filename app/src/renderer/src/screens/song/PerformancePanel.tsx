import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { partSplitNote, selectWholeSongStems, useSong } from "@/song/store";
import { defaultMix, formatTime, mergeMix, type Mix } from "@/song/stems/mix";
import type { TrackBuses } from "@/song/stems/player";
import { songCues } from "@/song/performance/song-cues";
import { midiFileFromOptions, type MidiFileOption } from "@/song/performance/smf";
import { chordDisplayTranspose, clampCapo, effectiveBpm, keySpelling } from "@/song/performance/speed";
import type { ChartMetadata } from "@/song/performance/import/import-result";
import { SpeedControls } from "./SpeedControls";
import { bassOf, harmonyNameOf, harmonyOf } from "@/song/analysis/analysis-audio";
import { PerformanceSession, carriedInto, leftPerformance, useSession, type Timing } from "@/song/performance/session";
import {
  ownClickSounds,
  readClickSoundDefaults,
  resolveClickSounds,
  saveClickSoundDefaults,
  type ClickSounds,
  type ClickSoundsOwn,
} from "@/song/performance/click-sound";
import { isMetronomeMode, recordTap, tapBpm, type MetronomeMode } from "@/song/performance/rhythm";
import { parseSections, saveLiveAsDefault, type Section } from "@/song/performance/sections";
import { ownLeadIn, readLeadInDefaults, resolveLeadIn, saveLeadInDefaults, type LeadIn, type LeadInKey, type LeadInOwn } from "@/song/performance/lead-in";
import { type StemName } from "@/song/types";
import { getSetting, performanceKey, readOptions, setSetting } from "@/song/performance/settings";
import { playerShapeFromOptions } from "@/song/performance/song-shape";
import { readTempoSource, type TempoSource } from "@/song/performance/tempo-source";
import { useSongAnalysis } from "./use-song-analysis";
import { generatedTrackKeysIn, parseAnalysis, songAudioId } from "@/song/analysis/song-analysis";
import type { DetectedSection } from "@/song/analysis/sections";
import type { BassLineBeat } from "@/song/analysis/bass-line";
import type { SilenceEnds } from "@/song/analysis/silence";
import { SongShapeControls } from "./SongShapeControls";
import { useSongLibrary } from "@/song/library";
import { setSongPlaying } from "@/song/performance/playing-state";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { useBluetooth } from "@/bluetooth/connection";
import { SongKey } from "./SongKey";
import { SoloScales } from "./SoloScales";
import { SongMapImport } from "./SongMapImport";
import { ChordVoicings } from "./ChordVoicings";
import { PerformanceTransport } from "./PerformanceTransport";
import { PerformanceMix } from "./PerformanceMix";
import { BandPanel, BandPanelButton } from "./BandPanel";
import { MissingPartsNotice } from "./MissingPartsNotice";
import { TrackImport } from "./TrackImport";
import { SongLoudnessControl } from "./SongLoudnessControl";
import { loudnessFromOptions, normalisingGain, type SongLoudness } from "@/song/audio/loudness";
import { busDefaults, mixDefaults, type TrackInfo } from "@/song/tracks";
import { applyPartChoices, defaultPartChoices, partKeysOf, readPartChoices, type PartChoices } from "@/song/band/part-choice";
import { PerformanceOutputs } from "./PerformanceOutputs";
import { PerformanceMidiSetup, SessionMidiHealth } from "./PerformanceMidiSetup";
import { PerformanceAnalysis, useChordAnalysis } from "./PerformanceAnalysis";
import { effectiveMute, noTrackNote, practiceSet, readCountsAs, usePracticeMute, type CountsAs, type PracticeTracks } from "@/song/performance/practice-mute";
import { PracticeMuteBanner, PracticeMuteMenu } from "./PracticeMute";
import { StageView } from "./StageView";
import { SectionStrip } from "./SectionStrip";
import { SectionEditor } from "./SectionEditor";
import type { ChartView } from "@shared/song-library";
import { RemoteControlSettings } from "./RemoteControlSettings";
import { SongTriggerField } from "./SongTriggerField";
import { SongTriggerSettings } from "./SongTriggerSettings";
import { buildViewHost } from "./remote-view";
import { AudienceSettings } from "./AudienceSettings";
import { useAudienceFeed } from "./use-audience-feed";
import { useBandSyncControl } from "./use-band-sync";
import { BandSyncSettings } from "./BandSyncSettings";
import { useChartUrl } from "./use-chart-url";
import { audienceModel, type AudienceSongInput } from "@/song/performance/audience";
import { useAudienceSettings } from "@/song/performance/audience-settings";
import { useChartPage } from "@/song/performance/pdf/current-page";
import { PerformanceViewSwitcher, readPerformanceView, savePerformanceView, type PerformanceView as ViewName } from "./PerformanceViews";

function readNumber(raw: string, fallback: number, min: number, max: number): number {
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

let sessionId = 0;
/** What the stage view says when the song is not at its own speed or pitch. Null when it is. */
function speedNote(speed: { rate: number; semitones: number; cents: number }): string | null {
  if (speed.rate === 1 && speed.semitones === 0 && speed.cents === 0) return null;
  const signed = (value: number) => (value > 0 ? "+" : "") + value;
  const parts = [`Speed ${Math.round(speed.rate * 100)}%`];
  if (speed.semitones || speed.cents) parts.push(`Pitch ${signed(speed.semitones)} st${speed.cents ? ` ${signed(speed.cents)} ct` : ""}`);
  return parts.join(" · ");
}
/** The metronome mode a song starts with when it has none of its own. Earlier builds stored the on/off toggle as "true" or "false". */
function readGlobalMetronome(): MetronomeMode {
  try {
    const stored = localStorage.getItem("vltn.performance.metronome");
    if (stored === "true") return "playing";
    return isMetronomeMode(stored) ? stored : "off";
  } catch {
    return "off";
  }
}

const NO_TRACKS: Record<string, TrackInfo> = {};

/** `shown` is false while another Song tab is up: the session keeps playing, but its view keys do nothing (see `PerformanceSession.shown`). */
export function PerformancePanel({ shown = true }: { shown?: boolean }) {
  const source = useSong((s) => s.source);
  const generation = useMemo(() => ++sessionId, [source]);
  const [stage, setStage] = useState(false);
  // A song handed over to the next song's session is held by the library until that session takes it up. Leaving Performance
  // before then pauses the set, which stops the held song. Checked later, so a StrictMode re-run does not pause it.
  useEffect(
    () => () => {
      setTimeout(() => {
        if (leftPerformance() && useSongLibrary.getState().handover) useSongLibrary.getState().pausePlaylist();
      }, 0);
    },
    [],
  );
  return <PerformanceView key={generation} stage={stage} setStage={setStage} shown={shown} />;
}

/** Composes the performance screen. The MIDI session, scheduler and transport live in `PerformanceSession`. */
function PerformanceView({ stage, setStage, shown }: { stage: boolean; setStage: (value: boolean) => void; shown: boolean }) {
  const bluetooth = useBluetooth((s) => s.connection);
  const midiConfig = useMidiConfiguration();
  const source = useSong((s) => s.source),
    stems = useSong(selectWholeSongStems),
    tracks = useSong((s) => s.tracks) ?? NO_TRACKS,
    setTrackInfo = useSong((s) => s.setTrackInfo),
    missingParts = useSong((s) => s.missingParts);
  // A split of only part of the song is for Tone Match; Performance plays the whole song and says why the stems are missing.
  const partNote = partSplitNote(useSong((s) => s.lastSplit), formatTime);
  const key = performanceKey(source);
  const library = useSongLibrary();
  const queued = !!source?.libraryId && library.queue[library.position] === source.libraryId;
  const options = useMemo(
    () =>
      readOptions(key, {
        firstBeat: 0,
        beats: 4,
        shift: 0,
        capo: 0,
        clock: false,
        volume: 0.25,
        mix: defaultMix(),
        trackBuses: {} as TrackBuses,
        chordChoice: "" as StemName | "",
        lyricsLanguage: "auto",
        metronomeMode: "",
        countInBars: "",
        metronomeSound: "",
        countInSound: "",
        preRollBeats: "",
        startDelay: "",
        sections: [] as unknown[],
        timecodeOffset: "",
        beatsSource: "" as "" | "detected" | "manual",
        partChoice: undefined as PartChoices | undefined,
      }),
    [key],
  );
  // Sections are part of the song; their live changes are not saved (see sections.ts).
  const [sectionList, setSectionList] = useState<Section[]>(() => parseSections(options.sections));
  // The sections the song analysis suggested most recently. They are applied only to a song with no sections; otherwise the editor offers them.
  const [suggested, setSuggested] = useState<DetectedSection[]>(() => parseAnalysis(readOptions<Record<string, unknown>>(key, {}).analysis)?.sections ?? []);
  // The bass note the bass stem plays on each beat. The Band panel takes its bass notes from it when the setting says Original bass.
  const [bassLine, setBassLine] = useState<BassLineBeat[] | null>(null);
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState("");
  const [chart, setChart] = useState(() => getSetting(key, ""));
  // A saved song with a PDF shows the PDF unless the performer chose the text chart for it.
  const [chartView, setChartView] = useState<ChartView>(() => (getSetting(key, ":chart") === "text" ? "text" : "pdf"));
  const [bpm, setBpm] = useState(() => readNumber(getSetting(key, ":bpm"), 120, 30, 300)),
    [tempoSource, setTempoSource] = useState<TempoSource | null>(() => readTempoSource(options)),
    [beats, setBeats] = useState(options.beats),
    [, setBeatsManual] = useState(() => options.beatsSource === "manual"),
    [shift, setShift] = useState(options.shift),
    [capo, setCapo] = useState(() => clampCapo(options.capo));

  const [volume, setVolume] = useState(options.volume);
  const [firstBeat, setFirstBeat] = useState(() =>
    typeof options.firstBeat === "number" && Number.isFinite(options.firstBeat) && options.firstBeat >= 0 ? options.firstBeat : 0,
  );
  const [metronome, setMetronome] = useState<MetronomeMode>(() => (isMetronomeMode(options.metronomeMode) ? options.metronomeMode : readGlobalMetronome()));
  // A song's own lead-in values; "" means the global default.
  const [lead, setLead] = useState<LeadInOwn>(() => ({
    countInBars: ownLeadIn("countInBars", options.countInBars),
    preRollBeats: ownLeadIn("preRollBeats", options.preRollBeats),
    startDelay: ownLeadIn("startDelay", options.startDelay),
  }));
  const [leadDefaults, setLeadDefaults] = useState<LeadIn>(readLeadInDefaults);
  const leadIn = useMemo(() => resolveLeadIn(lead, leadDefaults), [lead, leadDefaults]);
  const setLeadOwn = (key: LeadInKey, value: number | "") => setLead((current) => ({ ...current, [key]: value }));
  const setLeadDefault = (key: LeadInKey, value: number) => {
    const next = { ...leadDefaults, [key]: value };
    setLeadDefaults(next);
    try {
      saveLeadInDefaults(next);
    } catch (e) {
      session.fail(e);
    }
  };
  // The metronome's and the count-in's sounds, the same way: a song's own value ("" uses the default) over a global default.
  const [soundOwn, setSoundOwn] = useState<ClickSoundsOwn>(() => ownClickSounds(options));
  const [soundDefaults, setSoundDefaults] = useState<ClickSounds>(readClickSoundDefaults);
  const sounds = useMemo(() => resolveClickSounds(soundOwn, soundDefaults), [soundOwn, soundDefaults]);
  const setSoundDefault = (next: ClickSounds) => {
    setSoundDefaults(next);
    try {
      saveClickSoundDefaults(next);
    } catch (e) {
      session.fail(e);
    }
  };
  const [shapeVersion, setShapeVersion] = useState(0);
  // The drums and bass choice: the original, the generated track or both. A song that saved none starts from the default for its parts,
  // and its mix is set to match. A saved choice is already in the saved mix.
  const [partChoice, setPartChoice] = useState<PartChoices>(() =>
    readPartChoices(options.partChoice, defaultPartChoices(missingParts, partKeysOf(tracks, stems))),
  );
  const partChoiceNow = useRef(partChoice);
  const withPartChoice = (base: Mix): Mix =>
    options.partChoice === undefined ? applyPartChoices(base, partChoiceNow.current, partKeysOf(tracks, stems)) : base;
  /** Changes the drums or bass choice and sets the mix to match. Only mute levels change, so this also works during playback. */
  const choosePart = (patch: Partial<PartChoices>) => {
    const next = { ...partChoiceNow.current, ...patch };
    partChoiceNow.current = next;
    setPartChoice(next);
    const now = useSong.getState();
    setMix((current) => applyPartChoices(current, next, partKeysOf(now.tracks ?? {}, selectWholeSongStems(now))));
  };
  // An imported track starts on the bus, volume and pan it saved; a choice the song made since then wins.
  const [mix, setMix] = useState<Mix>(() => withPartChoice({ ...mixDefaults(tracks), ...options.mix }));
  // The mix as last read or saved: the Stems tab saves into the same options, so only what changed here is written.
  const savedMix = useRef<Mix | null>(options.mix);
  // What each imported track counts as for the practice mute. It is saved with the song, since only that song's tracks have these names.
  const [countsAs, setCountsAs] = useState<Record<string, CountsAs>>(() => readCountsAs(options));
  const practiceKinds = usePracticeMute((s) => s.kinds);
  const [trackBuses, setTrackBuses] = useState<TrackBuses>(() => ({ ...busDefaults(tracks), ...options.trackBuses }));
  useEffect(() => {
    setMix((current) => ({ ...mixDefaults(tracks), ...current }));
    setTrackBuses((current) => ({ ...busDefaults(tracks), ...current }));
  }, [tracks]);
  const [chordChoice, setChordChoice] = useState<StemName | "">(options.chordChoice);
  // The audio the chords are read from, and the bass, as the song analysis reads them, so the screen shows what a run would find.
  const harmony = useMemo(() => (source ? harmonyOf(stems, source.audio, chordChoice) : null), [source, stems, chordChoice]);
  const automaticSource = useMemo(() => (source ? harmonyNameOf(stems) : ""), [source, stems]);
  const bass = useMemo(() => bassOf(stems), [stems]);
  // The song's MIDI file is saved with its options, so it is read back here when the song is shown.
  const [midiFile, setMidiFile] = useState<MidiFileOption | null>(() => midiFileFromOptions(options));
  const parsed = useMemo(() => {
    const cued = songCues(chart, midiConfig.macros, midiFile);
    return { cues: cued.cues, error: cued.error };
  }, [chart, midiConfig.macros, midiFile]);
  // The song's MIDI timecode offset, saved with its options. Empty means 00:00:00:00.
  const [timecodeOffset, setTimecodeOffset] = useState(options.timecodeOffset);
  const saveTimecodeOffset = (value: string) => {
    setTimecodeOffset(value);
    try {
      setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), timecodeOffset: value || undefined }));
    } catch (e) {
      session.fail(e);
    }
  };
  // Memoised: the session compares its inputs by identity, so a new object each render would re-run the scheduler each render.
  const timecode = useMemo(
    () => ({ enabled: midiConfig.timecode.enabled, fps: midiConfig.timecode.fps, offset: timecodeOffset }),
    [midiConfig.timecode.enabled, midiConfig.timecode.fps, timecodeOffset],
  );
  const saveMidiFile = (file: MidiFileOption | null) => {
    setMidiFile(file);
    try {
      setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), midiFile: file ?? undefined }));
    } catch (e) {
      session.fail(e);
    }
  };

  const [session] = useState(
    () =>
      new PerformanceSession({
        initialClock: !midiConfig.tempoOnStart && options.clock === true,
        carried: carriedInto(library.midiSession, { queued, playlistPlaying: !!library.playlistPlaying }),
        initial: {
          bluetooth,
          tempoOnStart: midiConfig.tempoOnStart,
          tempoChannel: midiConfig.tempoChannel,
          savedOutput: midiConfig.output,
          savedInput: midiConfig.input,
          queued,
          playlistPlaying: !!library.playlistPlaying,
          busy: !!library.busy,
          cues: parsed.cues,
          parseError: parsed.error,
          bpm,
          sections: sectionList,
          bindings: midiConfig.bindings,
          timecode,
        },
      }),
  );
  const player = useSession(session, (s) => s.player);
  const playing = useSession(session, (s) => s.playing);
  // The Library's batch analysis waits while a song plays, so it is told when this panel's session starts or stops.
  useEffect(() => {
    setSongPlaying(playing);
  }, [playing]);
  useEffect(() => () => setSongPlaying(false), []);
  const clock = useSession(session, (s) => s.clock);
  const speed = useSession(session, (s) => s.speed);
  const inputReady = useSession(session, (s) => s.inputId !== "");
  // The chord names and shapes on screen: the chart transpose, plus the pitch when the chords follow it, less the capo.
  const shapeShift = shift + chordDisplayTranspose(speed.semitones, capo, speed.applyToChords);
  // The key the chord names are spelled by, from the SongKey readout (its override, then the library key, then a strong estimate).
  const [spellingKey, setSpellingKey] = useState<string | undefined>();
  // Bumped when the reader's Solo scale dialog saves, so the This song section reads the choice again.
  const [soloVersion, setSoloVersion] = useState(0);
  // Generated parts do not change the audio the chords were analysed under (see songAudioId), so the saved chords stay after Generate.
  const audioId = useMemo(
    () => (source ? songAudioId(source.audio, stems, generatedTrackKeysIn(readOptions<Record<string, unknown>>(key, {}))) : ""),
    [source, stems, tracks, key],
  );
  const { chords, analysing } = useChordAnalysis(session, harmony, bass, { songKey: key, audioId }, !!stems);

  useEffect(() => session.loadSong(source, stems), [session, source, stems]);
  useEffect(() => {
    session.locked = stage;
  }, [session, stage]);
  useEffect(() => {
    session.shown = shown;
  }, [session, shown]);
  useEffect(() => {
    session.bind();
    return () => session.dispose();
  }, [session]);
  // Lead-in before a start. Memoised: the session compares inputs by identity, so a new object every render would re-run it every render.
  const timing = useMemo<Timing>(
    () => ({ countInBars: leadIn.countInBars, beatsPerBar: beats, preRollBeats: leadIn.preRollBeats, startDelay: leadIn.startDelay }),
    [leadIn, beats],
  );
  // Tap tempo sets the song BPM only while stopped. The taps live in a ref so the key handler always sees the latest sequence.
  const tapsRef = useRef<number[]>([]);
  const tap = () => {
    tapsRef.current = recordTap(tapsRef.current, performance.now());
    const value = tapBpm(tapsRef.current);
    if (value && !session.state.playing) changeTempo(value, "tap");
  };
  // A meter the performer picked is kept; only a meter that was never chosen is changed by the analysis.
  // A meter the performer picked is manual. The analysis's own choice is recorded as detected, so it can still be changed by it later.
  const changeBeats = (value: number, source: "manual" | "detected" = "manual") => {
    setBeats(value);
    setBeatsManual(source === "manual");
    try {
      setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), beatsSource: source }));
    } catch (e) {
      session.fail(e);
    }
  };
  // Changes the meter. A grid the analysis laid out for the old meter is laid out again, so its downbeat matches; a performer's grid is kept.
  // Every change to the tempo records where it came from. The saved source is what stops the analysis overwriting a tempo the performer chose.
  const changeTempo = (value: number, source: TempoSource) => {
    setBpm(value);
    setTempoSource(source);
    try {
      setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), tempoSource: source }));
    } catch (e) {
      session.fail(e);
    }
  };
  // Key presses run their bindings (the T key taps the tempo by default). Typing in a field never does: the session checks that.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void session.keyDown(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);
  // Values owned by other stores; the session re-runs only the effects whose inputs changed.
  useEffect(() => {
    session.update({
      bluetooth,
      tempoOnStart: midiConfig.tempoOnStart,
      tempoChannel: midiConfig.tempoChannel,
      savedOutput: midiConfig.output,
      savedInput: midiConfig.input,
      queued,
      playlistPlaying: !!library.playlistPlaying,
      busy: !!library.busy,
      cues: parsed.cues,
      parseError: parsed.error,
      bpm,
      timing,
      sections: sectionList,
      bindings: midiConfig.bindings,
      timecode,
    });
  });

  // The view actions of the remote bindings. The session is handed them again whenever the screen changes.
  useEffect(() => {
    session.setView(buildViewHost({ stage, setStage, metronome, setMetronome, mix, setMix, tracks, partChoices: partChoice, choosePart, tap }));
  });

  /** Writes the live loop and release choices into the sections' stored modes, which are saved with the song. */
  const saveSectionDefaults = () => setSectionList(saveLiveAsDefault(sectionList, session.state.sectionLive));

  /**
   * Song details read by an import: the tempo and capo become the song's own, and the key and year are saved to its library entry. A
   * title or artist is not changed, since the library does not hold them. The import is refused during playback, so this runs when stopped.
   */
  const applyImportedMetadata = (metadata: ChartMetadata) => {
    if (metadata.tempo !== undefined) changeTempo(metadata.tempo, "chart");
    if (metadata.capo !== undefined) setCapo(clampCapo(metadata.capo));
    const id = source?.libraryId;
    const patch = { ...(metadata.key ? { key: metadata.key } : {}), ...(metadata.year !== undefined ? { year: metadata.year } : {}) };
    if (id && Object.keys(patch).length) void useSongLibrary.getState().organiseSongs([id], patch);
  };

  const saveChartView = (view: ChartView) => {
    setChartView(view);
    try {
      setSetting(key, ":chart", view);
    } catch (e) {
      session.fail(e);
    }
  };

  const savedSong = library.index.songs.find((s) => s.id === source?.libraryId);
  const pdfState = source?.libraryId
    ? { songId: source.libraryId, chart: !!savedSong?.chart, revision: savedSong?.chart?.sha256 ?? "", view: chartView, onView: saveChartView }
    : undefined;

  // The audience display (spec 43) shows what this screen shows: the song's lyrics and chords, or its PDF page, with the performer's settings.
  const audienceSettings = useAudienceSettings();
  const pdfUrl = useChartUrl(source?.libraryId, pdfState?.chart ? pdfState.revision : "");
  const audiencePage = useChartPage((s) => (s.songId === source?.libraryId ? s.page : 1));
  const nextAudienceTitle = queued ? (library.index.songs.find((s) => s.id === library.queue[library.position + 1])?.title ?? null) : null;
  const audienceSong = useMemo<AudienceSongInput | null>(
    () =>
      source
        ? {
            songKey: key,
            title: source.name,
            nextTitle: nextAudienceTitle,
            chart,
            lyrics,
            chords,
            macros: midiConfig.macros,
            shift: shapeShift,
            flats: keySpelling(spellingKey, shapeShift),
            pdf: pdfUrl && source.libraryId && pdfState?.chart && chartView === "pdf" ? { url: pdfUrl, page: audiencePage } : null,
          }
        : null,
    // The song's chart and chords are the inputs; the rest is read when they change.
    [key, source, nextAudienceTitle, chart, lyrics, chords, midiConfig.macros, shapeShift, spellingKey, pdfUrl, pdfState?.chart, chartView, audiencePage],
  );
  const audienceModelValue = useMemo(
    () =>
      audienceModel(audienceSong, {
        showChords: audienceSettings.showChords,
        fontScale: audienceSettings.fontScale,
        rotation: audienceSettings.rotation,
        blackout: audienceSettings.blackout,
        blackBetweenSongs: audienceSettings.blackBetweenSongs,
      }),
    [
      audienceSong,
      audienceSettings.showChords,
      audienceSettings.fontScale,
      audienceSettings.rotation,
      audienceSettings.blackout,
      audienceSettings.blackBetweenSongs,
    ],
  );
  useAudienceFeed(session, key, audienceModelValue);
  useBandSyncControl(session);
  // The song analysis fills in what the performer has not set: the tempo here, and the rest as its steps are added. Nothing it finds
  // replaces a value that was chosen, which is why a tempo is applied only when no source is recorded for it.
  const [silence, setSilence] = useState<{ songKey: string; ends: SilenceEnds } | null>(null);
  const analysis = useSongAnalysis();
  // The song runner writes the analysis into the song's settings, outside this screen. The values shown here are read again after each write.
  useEffect(() => {
    const options = readOptions<Record<string, unknown>>(key, {});
    const saved = parseAnalysis(options.analysis);
    setBpm(readNumber(getSetting(key, ":bpm"), 120, 30, 300));
    setTempoSource(readTempoSource(options));
    setFirstBeat(typeof options.firstBeat === "number" && Number.isFinite(options.firstBeat) && options.firstBeat >= 0 ? options.firstBeat : 0);
    setBeats(readOptions(key, { beats: 4 }).beats);
    setBeatsManual(options.beatsSource === "manual");
    setSectionList(parseSections(options.sections));
    setSuggested(saved?.sections ?? []);
    setBassLine(saved?.bassLine?.beats ?? null);
    setLoudness(loudnessFromOptions(getSetting(key, ":options")));
    setSilence(saved?.silence ? { songKey: key, ends: saved.silence } : null);
  }, [analysis.revision, key]);
  const detectTempo = (analyseAgain: boolean) => {
    if (analyseAgain) analysis.analyseAgain();
    else analysis.detect();
  };
  // Finds the beat again from the typed tempo. The run keeps the typed tempo as the performer's own, and Undo is one of its notices.
  const findBeat = (lock: boolean) => analysis.findBeat({ tempoHint: bpm, lockTempo: lock });
  // A tempo the performer set, by hand, by tapping or from the chart: the beat can be found again from it.
  const typedTempo = tempoSource === "manual" || tempoSource === "tap" || tempoSource === "chart";

  const saveChart = (value: string) => {
    session.pause();
    setChart(value);
    try {
      setSetting(key, "", value);
    } catch (e) {
      session.fail(e);
    }
  };
  // Nothing is saved until the performer or an analysis chooses a tempo. Writing on mount would save the 120 default as if it were chosen.
  useEffect(() => {
    if (!tempoSource) return;
    try {
      setSetting(key, ":bpm", String(bpm));
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, bpm, tempoSource]);
  useEffect(() => {
    setMix(withPartChoice({ ...mixDefaults(tracks), ...options.mix }));
    setCountsAs(readCountsAs(options));
  }, [player]);
  // A normalised song is raised or lowered as a whole: every track gets the same gain, so the balance stays as it was mixed.
  const [loudness, setLoudness] = useState<SongLoudness>(() => loudnessFromOptions(getSetting(key, ":options")));
  const songGain = loudness.normalise && loudness.lufs !== null ? normalisingGain(loudness.lufs, loudness.peakDb) : 1;
  // The player plays the song's mix with the practice mute on top. The practice mute is never written into `mix`, which is what is saved.
  const practiceTracks = useMemo<PracticeTracks>(
    () => ({ keys: player?.names ?? [], info: tracks, split: !!stems && Object.keys(stems).length > 0, countsAs }),
    [player, tracks, stems, countsAs],
  );
  const playedMix = useMemo(() => effectiveMute(mix, practiceSet(practiceKinds), practiceTracks), [mix, practiceKinds, practiceTracks]);
  useEffect(() => {
    player?.setMix(playedMix, songGain);
  }, [player, playedMix, songGain]);
  useEffect(() => {
    player?.setTrackBuses(trackBuses);
  }, [player, trackBuses]);
  useEffect(() => {
    try {
      const saved = readOptions<{ mix?: Mix }>(key, {});
      const mergedMix = mergeMix(saved.mix, savedMix.current, mix);
      savedMix.current = mix;
      setSetting(
        key,
        ":options",
        JSON.stringify({
          ...saved,
          firstBeat,
          beats,
          shift,
          capo,
          clock,
          volume,
          mix: mergedMix,
          trackBuses,
          practiceKinds: countsAs,
          partChoice,
          chordChoice,
          lyricsLanguage: readOptions(key, { lyricsLanguage: "auto" }).lyricsLanguage,
          metronomeMode: metronome,
          countInBars: lead.countInBars,
          metronomeSound: soundOwn.sound,
          countInSound: soundOwn.countInSound,
          preRollBeats: lead.preRollBeats,
          startDelay: lead.startDelay,
          sections: sectionList,
        }),
      );
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, firstBeat, beats, shift, capo, clock, volume, mix, trackBuses, countsAs, partChoice, chordChoice, metronome, lead, soundOwn, sectionList]);
  useEffect(() => {
    player?.setMetronome({ mode: metronome, bpm, beats, volume, firstBeat, sound: sounds.sound, countInSound: sounds.countInSound });
  }, [player, metronome, bpm, beats, volume, firstBeat, sounds]);
  // The song's trim, fades and end are read from its stored options, so a player always takes the song's own values.
  useEffect(() => {
    player?.setShape(playerShapeFromOptions(getSetting(key, ":options")));
  }, [player, key, shapeVersion]);
  useEffect(() => {
    try {
      localStorage.setItem("vltn.performance.metronome", String(metronome));
    } catch (e) {
      session.fail(e);
    }
  }, [session, metronome]);

  const [view, setView] = useState<ViewName>(readPerformanceView);
  const chooseView = (next: ViewName) => {
    setView(next);
    savePerformanceView(next);
  };
  /** A view's wrapper shows only when it is selected and stage mode is off. Stage mode hides every view except the reader. */
  const shownView = (name: ViewName) => (!stage && view === name ? "contents" : "none");

  return (
    <section className="glass flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl p-5" aria-label="Performance">
      <div style={{ display: stage ? "none" : "contents" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PerformanceViewSwitcher view={view} onView={chooseView} />
          <Button variant="outline" onClick={() => setStage(true)}>
            Enter stage mode
          </Button>
        </div>
        <PracticeMuteBanner note={noTrackNote(practiceSet(practiceKinds), practiceTracks)} />
        <MissingPartsNotice songKey={key} sections={sectionList} playing={playing || library.playlistPlaying} />
        {partNote && (
          <p className="text-xs text-silkscreen-2" role="status">
            {partNote}
          </p>
        )}
        {analysis.notices.map((notice) => (
          <p key={notice.text} className="flex flex-wrap items-center gap-2 text-xs" role="status">
            <span>{notice.text}</span>
            {notice.actions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                size="sm"
                disabled={playing || library.playlistPlaying || analysis.step !== null}
                onClick={() => analysis.press(action)}
              >
                {action.label}
              </Button>
            ))}
          </p>
        ))}
        {source || analysis.step || analysis.detecting || analysis.message ? (
          <p className="flex flex-wrap items-center gap-2 text-xs" role="status">
            <span>{analysis.detecting ? "Detecting…" : analysis.step ? `Analysing the song: ${analysis.step}…` : analysis.message}</span>
            {analysis.step || analysis.detecting ? (
              <Button variant="outline" size="sm" onClick={analysis.cancel}>
                Cancel
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={!source || playing || library.playlistPlaying || !!library.busy} onClick={() => detectTempo(true)}>
                Analyse again
              </Button>
            )}
          </p>
        ) : null}
        <PerformanceTransport
          session={session}
          stage={stage}
          bpm={bpm}
          onBpm={(value) => changeTempo(value, "manual")}
          onDetect={() => detectTempo(false)}
          detectDisabled={!source || playing || library.playlistPlaying || !!library.busy || analysis.step !== null}
          detecting={analysis.detecting}
          beatHint={typedTempo ? { bpm, onFind: findBeat } : undefined}
          metronome={{
            metronome,
            onMetronome: setMetronome,
            firstBeat,
            onFirstBeat: setFirstBeat,
            beats,
            onBeats: (value) => changeBeats(value),
            volume,
            onVolume: setVolume,
            lead,
            onLead: setLeadOwn,
            leadDefaults,
            onLeadDefault: setLeadDefault,
            soundOwn,
            onSoundOwn: setSoundOwn,
            soundDefaults,
            onSoundDefaults: setSoundDefault,
          }}
          onTap={tap}
        />
      </div>
      <div style={{ display: shownView("play") }}>
        <SectionStrip session={session} onSaveDefaults={saveSectionDefaults} />
        <div className="flex justify-end">
          <PracticeMuteMenu />
        </div>
        <PerformanceMix
          session={session}
          stems={stems}
          tracks={tracks}
          mix={mix}
          onMix={setMix}
          trackBuses={trackBuses}
          onTrackBus={(name, bus) => setTrackBuses((routes) => ({ ...routes, [name]: bus }))}
          onTrackInfo={setTrackInfo}
          partChoices={partChoice}
          countsAs={countsAs}
          onCountsAs={(trackKey, value) =>
            setCountsAs((current) => {
              const { [trackKey]: _dropped, ...rest } = current;
              return value === undefined ? rest : { ...rest, [trackKey]: value };
            })
          }
        />
      </div>
      <div style={{ display: shownView("song") }}>
        <p className="text-xs text-silkscreen-3">Saved with this song.</p>
        <SpeedControls session={session} bpm={bpm} />
        <SongShapeControls
          key={key}
          songKey={key}
          audio={source?.audio ?? null}
          silence={silence?.songKey === key ? silence.ends : null}
          onChange={() => setShapeVersion((v) => v + 1)}
        />
        <SongKey
          stems={stems}
          original={source?.audio}
          storageKey={key}
          shift={shift}
          libraryKey={savedSong?.key ?? undefined}
          onSpellingKey={setSpellingKey}
        />
        <h3 className="text-sm font-semibold">Solo scale</h3>
        <SoloScales key={`${key}:${soloVersion}`} songKey={spellingKey} shift={shapeShift} capo={capo} storageKey={key} />
        <SongMapImport
          songKey={key}
          libraryId={source?.libraryId}
          playing={playing || library.playlistPlaying}
          title={savedSong?.title || source?.name || ""}
          durationSeconds={source ? source.audio.channels[0].length / source.audio.sampleRate : 0}
        />
        <TrackImport playing={playing || library.playlistPlaying} />
        <SongLoudnessControl audio={source?.audio ?? null} storageKey={key} value={loudness} onChange={setLoudness} />
        <BandPanelButton sections={sectionList} partChoices={partChoice} />
        <BandPanel
          songKey={key}
          playing={playing || library.playlistPlaying}
          chart={chart}
          chords={chords}
          sections={sectionList}
          beats={beats}
          bpm={bpm}
          firstBeat={firstBeat}
          typedTempo={typedTempo}
          onMetronome={(tempo, first) => {
            changeTempo(tempo, "detected");
            setFirstBeat(first);
          }}
          getPosition={() => session.position}
          onPlayFrom={(seconds) => void session.seek(seconds).then(() => session.startPlayback())}
          partChoices={partChoice}
          onPartChoice={choosePart}
          bassLine={bassLine}
          sectionHints={suggested}
        />
        <SectionEditor
          sections={sectionList}
          onSections={setSectionList}
          suggested={suggested}
          duration={player?.duration ?? 0}
          bpm={bpm}
          firstBeat={firstBeat}
          channels={source?.audio.channels ?? null}
        />
        <SongTriggerField songId={source?.libraryId} songs={library.index.songs} inputReady={inputReady} />
      </div>
      <div style={{ display: stage || view === "play" ? "contents" : "none" }}>
        <StageView
          session={session}
          stage={stage}
          onExitStage={() => setStage(false)}
          chart={chart}
          lyrics={lyrics}
          chords={chords}
          shift={shapeShift}
          songKey={spellingKey}
          onSaveChart={saveChart}
          onImportMetadata={applyImportedMetadata}
          beat={{ bpm: effectiveBpm(bpm, speed.rate), beats, firstBeat }}
          speedNote={speedNote(speed)}
          pdf={pdfState}
          soloScale={{ storageKey: key, capo, onChange: () => setSoloVersion((v) => v + 1) }}
        />
      </div>
      <div style={{ display: shownView("midi") }}>
        <SessionMidiHealth session={session} />
        <PerformanceMidiSetup
          session={session}
          chart={chart}
          onSaveChart={saveChart}
          onShowChart={() => chooseView("lyrics")}
          midiFile={midiFile}
          onMidiFile={saveMidiFile}
          timecodeOffset={timecodeOffset}
          onTimecodeOffset={saveTimecodeOffset}
        />
      </div>
      <div style={{ display: shownView("setup") }}>
        <p className="text-xs text-silkscreen-3">These settings apply to every song.</p>
        <PerformanceOutputs player={player} />
        <AudienceSettings />
        <BandSyncSettings />
        <RemoteControlSettings inputReady={inputReady} />
        <SongTriggerSettings songs={library.index.songs} inputReady={inputReady} />
      </div>
      <div style={{ display: shownView("lyrics") }}>
        <PerformanceAnalysis
          session={session}
          stems={stems}
          storageKey={key}
          chart={chart}
          onSaveChart={saveChart}
          shift={shift}
          onShift={setShift}
          songKey={spellingKey}
          capo={capo}
          onCapo={(value) => setCapo(clampCapo(value))}
          onLyrics={setLyrics}
          chords={chords}
          analysing={analysing}
          chordChoice={chordChoice}
          onChordChoice={setChordChoice}
          automaticSource={automaticSource}
          chordSource={harmony?.name ?? ""}
          onSelectChord={setSelectedChord}
        />
      </div>
      <div style={{ display: stage ? "none" : "contents" }}>
        <ChordVoicings chord={selectedChord} onClose={() => setSelectedChord(null)} />
      </div>
    </section>
  );
}
