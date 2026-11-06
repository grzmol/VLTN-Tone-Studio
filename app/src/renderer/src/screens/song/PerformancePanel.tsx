import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSong } from "@/song/store";
import { defaultMix, mergeMix, type Mix } from "@/song/stems/mix";
import type { TrackBuses } from "@/song/stems/player";
import { songCues } from "@/song/performance/song-cues";
import { midiFileFromOptions, type MidiFileOption } from "@/song/performance/smf";
import { chordDisplayTranspose, clampCapo, effectiveBpm } from "@/song/performance/speed";
import type { ChartMetadata } from "@/song/performance/import/import-result";
import { SpeedControls } from "./SpeedControls";
import { PerformanceSession, carriedInto, leftPerformance, useSession, type Timing } from "@/song/performance/session";
import { isMetronomeMode, recordTap, tapBpm, type MetronomeMode } from "@/song/performance/rhythm";
import { parseSections, saveLiveAsDefault, type Section } from "@/song/performance/sections";
import { ownLeadIn, readLeadInDefaults, resolveLeadIn, saveLeadInDefaults, type LeadIn, type LeadInKey, type LeadInOwn } from "@/song/performance/lead-in";
import { getSetting, performanceKey, readOptions, setSetting } from "@/song/performance/settings";
import { playerShape, shapeFromOptions } from "@/song/performance/song-shape";
import { readTempoSource, type TempoSource } from "@/song/performance/tempo-source";
import { SongShapeControls } from "./SongShapeControls";
import { useSongLibrary } from "@/song/library";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { useBluetooth } from "@/bluetooth/connection";
import { SongKey } from "./SongKey";
import { PerformanceTransport } from "./PerformanceTransport";
import { PerformanceMix } from "./PerformanceMix";
import { TrackImport } from "./TrackImport";
import { SongLoudnessControl } from "./SongLoudnessControl";
import { loudnessFromOptions, normalisingGain, type SongLoudness } from "@/song/audio/loudness";
import { busDefaults, mixDefaults, type TrackInfo } from "@/song/tracks";
import { PerformanceOutputs } from "./PerformanceOutputs";
import { PerformanceMidiSetup, SessionMidiHealth } from "./PerformanceMidiSetup";
import { LyricsAndChords } from "./LyricsAndChords";
import { StageView } from "./StageView";
import { SectionStrip } from "./SectionStrip";
import { SectionEditor } from "./SectionEditor";
import { RemoteControlSettings } from "./RemoteControlSettings";
import { SongTriggerField } from "./SongTriggerField";
import { SongTriggerSettings } from "./SongTriggerSettings";
import { buildViewHost } from "./remote-view";
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
    stems = useSong((s) => s.stems),
    tracks = useSong((s) => s.tracks) ?? NO_TRACKS,
    setTrackInfo = useSong((s) => s.setTrackInfo);
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
        metronomeMode: "",
        countInBars: "",
        preRollBeats: "",
        startDelay: "",
        sections: [] as unknown[],
        timecodeOffset: "",
      }),
    [key],
  );
  // Sections are part of the song; their live changes are not saved (see sections.ts).
  const [sectionList, setSectionList] = useState<Section[]>(() => parseSections(options.sections));
  // The lyrics text track saved with the song, shown when its chart has no lyrics of its own.
  const [lyrics] = useState(() => getSetting(key, ":lyrics"));
  const [chart, setChart] = useState(() => getSetting(key, ""));
  const [bpm, setBpm] = useState(() => readNumber(getSetting(key, ":bpm"), 120, 30, 300)),
    [tempoSource, setTempoSource] = useState<TempoSource | null>(() => readTempoSource(options)),
    [beats, setBeats] = useState(options.beats),
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
  const [shapeVersion, setShapeVersion] = useState(0);
  // An imported track starts on the bus, volume and pan it saved; a choice the song made since then wins.
  const [mix, setMix] = useState<Mix>(() => ({ ...mixDefaults(tracks), ...options.mix }));
  // The mix as last read or saved: the Stems tab saves into the same options, so only what changed here is written.
  const savedMix = useRef<Mix | null>(options.mix);
  const [trackBuses, setTrackBuses] = useState<TrackBuses>(() => ({ ...busDefaults(tracks), ...options.trackBuses }));
  useEffect(() => {
    setMix((current) => ({ ...mixDefaults(tracks), ...current }));
    setTrackBuses((current) => ({ ...busDefaults(tracks), ...current }));
  }, [tracks]);
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
  const clock = useSession(session, (s) => s.clock);
  const speed = useSession(session, (s) => s.speed);
  const inputReady = useSession(session, (s) => s.inputId !== "");
  // The chord names and shapes on screen: the chart transpose, plus the pitch when the chords follow it, less the capo.
  const shapeShift = shift + chordDisplayTranspose(speed.semitones, capo, speed.applyToChords);
  // The key the chord names are spelled by, from the SongKey panel (its choice, then the library key).
  const [spellingKey, setSpellingKey] = useState<string | undefined>();

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
  const changeBeats = (value: number) => {
    setBeats(value);
    try {
      setSetting(key, ":options", JSON.stringify({ ...readOptions(key, {}), beats: value }));
    } catch (e) {
      session.fail(e);
    }
  };
  // Every change to the tempo records where it came from.
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
    session.setView(buildViewHost({ stage, setStage, metronome, setMetronome, mix, setMix, tracks, tap }));
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

  const savedSong = library.index.songs.find((s) => s.id === source?.libraryId);

  const saveChart = (value: string) => {
    session.pause();
    setChart(value);
    try {
      setSetting(key, "", value);
    } catch (e) {
      session.fail(e);
    }
  };
  // Nothing is saved until the performer chooses a tempo. Writing on mount would save the 120 default as if it were chosen.
  useEffect(() => {
    if (!tempoSource) return;
    try {
      setSetting(key, ":bpm", String(bpm));
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, bpm, tempoSource]);
  useEffect(() => {
    setMix({ ...mixDefaults(tracks), ...options.mix });
  }, [player]);
  // A normalised song is raised or lowered as a whole: every track gets the same gain, so the balance stays as it was mixed.
  const [loudness, setLoudness] = useState<SongLoudness>(() => loudnessFromOptions(getSetting(key, ":options")));
  const songGain = loudness.normalise && loudness.lufs !== null ? normalisingGain(loudness.lufs, loudness.peakDb) : 1;
  useEffect(() => {
    player?.setMix(mix, songGain);
  }, [player, mix, songGain]);
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
          metronomeMode: metronome,
          countInBars: lead.countInBars,
          preRollBeats: lead.preRollBeats,
          startDelay: lead.startDelay,
          sections: sectionList,
        }),
      );
    } catch (e) {
      session.fail(e);
    }
  }, [session, key, firstBeat, beats, shift, capo, clock, volume, mix, trackBuses, metronome, lead, sectionList]);
  useEffect(() => {
    player?.setMetronome({ mode: metronome, bpm, beats, volume, firstBeat });
  }, [player, metronome, bpm, beats, volume, firstBeat]);
  // The song's trim, fades and end are read from its stored options, so a player always takes the song's own values.
  useEffect(() => {
    player?.setShape(playerShape(shapeFromOptions(getSetting(key, ":options"))));
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
        <PerformanceTransport
          session={session}
          stage={stage}
          bpm={bpm}
          onBpm={(value) => changeTempo(value, "manual")}
          metronome={{
            metronome,
            onMetronome: setMetronome,
            firstBeat,
            onFirstBeat: setFirstBeat,
            beats,
            onBeats: changeBeats,
            volume,
            onVolume: setVolume,
            lead,
            onLead: setLeadOwn,
            leadDefaults,
            onLeadDefault: setLeadDefault,
          }}
          onTap={tap}
        />
      </div>
      <div style={{ display: shownView("play") }}>
        <SectionStrip session={session} onSaveDefaults={saveSectionDefaults} />
        <PerformanceMix
          session={session}
          stems={stems}
          tracks={tracks}
          mix={mix}
          onMix={setMix}
          trackBuses={trackBuses}
          onTrackBus={(name, bus) => setTrackBuses((routes) => ({ ...routes, [name]: bus }))}
          onTrackInfo={setTrackInfo}
        />
      </div>
      <div style={{ display: shownView("song") }}>
        <p className="text-xs text-silkscreen-3">Saved with this song.</p>
        <SpeedControls session={session} bpm={bpm} />
        <SongShapeControls
          key={key}
          songKey={key}
          audio={source?.audio ?? null}
          onChange={() => setShapeVersion((v) => v + 1)}
        />
        <SongKey storageKey={key} shift={shift} libraryKey={savedSong?.key ?? undefined} onSpellingKey={setSpellingKey} />
        <TrackImport playing={playing || library.playlistPlaying} />
        <SongLoudnessControl audio={source?.audio ?? null} storageKey={key} value={loudness} onChange={setLoudness} />
        <SectionEditor
          sections={sectionList}
          onSections={setSectionList}
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
          shift={shapeShift}
          songKey={spellingKey}
          onSaveChart={saveChart}
          onImportMetadata={applyImportedMetadata}
          beat={{ bpm: effectiveBpm(bpm, speed.rate), beats, firstBeat }}
          speedNote={speedNote(speed)}
        />
      </div>
      <div style={{ display: shownView("midi") }}>
        <SessionMidiHealth session={session} />
        <PerformanceMidiSetup
          session={session}
          chart={chart}
          onSaveChart={saveChart}
          midiFile={midiFile}
          onMidiFile={saveMidiFile}
          timecodeOffset={timecodeOffset}
          onTimecodeOffset={saveTimecodeOffset}
        />
      </div>
      <div style={{ display: shownView("setup") }}>
        <p className="text-xs text-silkscreen-3">These settings apply to every song.</p>
        <PerformanceOutputs player={player} />
        <RemoteControlSettings inputReady={inputReady} />
        <SongTriggerSettings songs={library.index.songs} inputReady={inputReady} />
      </div>
      <div style={{ display: shownView("lyrics") }}>
        <LyricsAndChords
          session={session}
          chart={chart}
          onSaveChart={saveChart}
          shift={shift}
          onShift={setShift}
          songKey={spellingKey}
          capo={capo}
          onCapo={(value) => setCapo(clampCapo(value))}
        />
      </div>
    </section>
  );
}
