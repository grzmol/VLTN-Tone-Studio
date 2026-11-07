import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Drum, LoaderCircle } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { bandHarmony, bandRequest, beatSources, chartChordTimes, followFor, followSourcesIn, levelStems, previewMix } from "@/song/band/request";
import type { BassLineBeat } from "@/song/analysis/bass-line";
import { applyPartTone } from "@/song/band/part-tone";
import { renderPartChain } from "@/song/band/bass-chain";
import { bassOf, harmonyOf } from "@/song/analysis/analysis-audio";
import { followStatus } from "@/song/band/feel";
import { levelStatus } from "@/song/band/level";
import { startChordDetection } from "@/song/band/chord-detect-client";
import { findStyle, type StyleId } from "@/song/band/styles";
import { sectionPreviewBars, type BandStage, type PreviewLength } from "@/song/band/band-job";
import type { PcmAudio } from "@/song/types";
import { parseChart, type Cue } from "@/song/performance/chart";
import type { Chord } from "@/song/performance/chords";
import type { Section } from "@/song/performance/sections";
import { readStoredBand, writeStoredBand } from "@/song/band/stored";
import { ORIGINAL_PARTS, partKeysOf, type PartChoices } from "@/song/band/part-choice";
import { bandEntryStatus, hasGeneratedParts, presenceLine, type PartKind } from "./band-status";
import { PartChoiceRows } from "./PartChoiceRows";
import { useBandPanel } from "./band-panel-state";
import { BandSections, type BandSectionRow } from "./BandSections";
import { BandGridSection } from "./BandGridSection";
import { BandSettingsForm } from "./BandSettingsForm";
import { RenderedPartRow, type PendingLineUp } from "./RenderedPartRow";
import { decodeAudioFile } from "@/song/decode";
import { MAX_IMPORT_SECONDS } from "@/song/import/import-tracks";
import { checkRenderedLength, firstOnsetSeconds, fitToLength, lineUpOffer, shiftAudio, type LineUp } from "@/song/band/rendered";

/** The Band panel's inputs from the Performance screen: the song's chart, chords, sections and metronome. */
export interface BandPanelProps {
  /** The song's performance key, where its band settings and grid are saved. */
  songKey: string;
  /** True while the song or a playlist plays. Every action is disabled then. */
  playing: boolean;
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

/** The preview target that is not a section: the song position now. */
const PLAYHEAD = "playhead";
/** The bars a preview from the playhead plays when the length is "Whole section", since the playhead is not in a section. */
const PLAYHEAD_BARS = 4;
/** A rendered file that is waiting for the performer's line-up choice (spec 84). */
interface PendingRendered {
  kind: RenderedKind;
  name: string;
  /** The decoded file, before it is fitted to the song, so a shift does not lose its end twice. */
  decoded: PcmAudio;
  line: LineUp;
  notices: string[];
}
/** The title of the prompt before Generate replaces rendered audio. */
function replaceTitle(kinds: readonly RenderedKind[]): string {
  if (kinds.length === 1) return `Replace your rendered ${kinds[0]} with new generated ${kinds[0]}?`;
  return "Replace your rendered drums and bass with new generated parts?";
}
/** The step the bass tone takes after the render, while it is read and rendered through the capture. */
const BASS_TONE_TEXT = "Bass tone…";
/** The step the drum tone takes after the render (spec 104), before the bass tone. */
const DRUM_TONE_TEXT = "Applying the drum tone…";
const PLAYING_TEXT = "Stop playback to generate parts.";
const NO_SONG_TEXT = "Open a song to generate parts.";

/** Plays a mixed buffer once through a short-lived AudioContext. Returns a function that stops it early. */
function playOnce(audio: PcmAudio, onDone: () => void): () => void {
  const context = new AudioContext();
  const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
  audio.channels.forEach((channel, i) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i));
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.connect(context.destination);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    void context.close();
    onDone();
  };
  node.onended = finish;
  node.start();
  return () => {
    try {
      node.stop();
    } catch {
      // Already stopped.
    }
    finish();
  };
}

export interface BandPanelButtonProps {
  /** The song's sections, which name the section a partly found part is missing from. */
  sections: Section[];
  /** Which drums and bass play, so the entry point can say what is playing. */
  partChoices: PartChoices;
}

/**
 * The Band entry point, above the mixer: a card that opens the panel. Its label and status follow the song's generated parts, and a
 * part the split missed is named here too.
 */
export function BandPanelButton({ sections, partChoices }: BandPanelButtonProps) {
  const show = useBandPanel((s) => s.show);
  const stems = useSong(selectWholeSongStems);
  const tracks = useSong((s) => s.tracks);
  const missing = useSong((s) => s.missingParts);
  const generated = hasGeneratedParts(tracks);
  const status = bandEntryStatus(partKeysOf(tracks ?? {}, stems), partChoices, missing, sections);
  return (
    <section aria-label="Band parts" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
      <Drum className="size-5 shrink-0 text-silkscreen-3" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-muted-foreground">Make drum and bass parts that follow this song, and choose what plays.</p>
        {status && <p>{status}.</p>}
      </div>
      <Button variant="secondary" size="sm" onClick={() => show(true)}>
        {generated ? "Drums & bass…" : "Generate drums & bass…"}
      </Button>
    </section>
  );
}

/** The Band panel: the song's beat grid, its band settings and sections, and the actions that generate, preview and remove the parts. */
export function BandPanel(props: BandPanelProps) {
  const open = useBandPanel((s) => s.open);
  const show = useBandPanel((s) => s.show);
  return (
    <Dialog open={open} onOpenChange={show}>
      <DialogContent className="flex max-h-[90vh] min-w-0 flex-col gap-4 overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Band</DialogTitle>
          <DialogDescription>
            Generate drum and bass parts that follow the song, then choose what plays for each part. Changing a setting does not regenerate anything until
            Generate.
          </DialogDescription>
        </DialogHeader>
        {open && <BandBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function BandBody({
  songKey,
  playing,
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
  const [confirmReplace, setConfirmReplace] = useState<{ kinds: RenderedKind[]; run(): void } | null>(null);
  const [grid, setGrid] = useState<BeatGrid | null>(stored.grid);
  const [outOfDate, setOutOfDate] = useState(stored.outOfDate);
  const [notices, setNotices] = useState<string[]>([]);
  const [work, setWork] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // What the running preview is, for the footer ("Previewing Chorus (8 bars)…"), or null when none plays.
  const [previewing, setPreviewing] = useState<string | null>(null);
  // The section menu's choice: a row index as text, "playhead", or null for the selected row (the first when none is selected).
  const [previewAt, setPreviewAt] = useState<string | null>(null);
  const [previewLength, setPreviewLength] = useState<"whole" | "4" | "8">("whole");
  // True after a Generate that went through, until the next action. The footer then offers Close and Play from.
  const [done, setDone] = useState(false);
  // True while Find the beat runs, so its progress stays in the beat grid section and the footer shows the rest.
  const [finding, setFinding] = useState(false);
  const show = useBandPanel((s) => s.show);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The notes of the last Generate, kept so they can be exported as a MIDI file.
  const [lastNotes, setLastNotes] = useState<{ drums: NoteEvent[]; bass: NoteEvent[] } | null>(null);
  const job = useRef<{ cancel(): void } | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  const playingNow = useRef(playing);
  useEffect(() => {
    playingNow.current = playing;
  }, [playing]);
  useEffect(() => {
    useSong.getState().checkMissingParts();
    return () => {
      job.current?.cancel();
      stopPreview.current?.();
    };
  }, []);

  const source = useSong((s) => s.source);
  const stems = useSong(selectWholeSongStems);
  const tracks = useSong((s) => s.tracks);
  const missing = useSong((s) => s.missingParts);
  const cues = useMemo<Cue[]>(() => parseChart(chart), [chart]);
  const songEnd = source ? source.audio.channels[0].length / source.audio.sampleRate : 0;
  const plans = useMemo(() => planSections(sections, songEnd, settings, sectionHints), [sections, songEnd, settings, sectionHints]);
  const harmony = useMemo<ChordAtBeat[]>(
    () => (grid ? bandHarmony({ grid, cues, chords, songEnd, settings, bassLine }) : []),
    [grid, cues, chords, songEnd, settings, bassLine],
  );
  const busy = work !== null;
  // With no song there is nothing to find a beat in or to render, so every action waits for one.
  const blocked = busy || playing || source === null;
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

  const rows: BandSectionRow[] = plans.map((plan) => ({
    plan,
    name: plan.sectionId === null ? "Whole song" : (sections.find((section) => section.id === plan.sectionId)?.name ?? "Section"),
    choice: settings.sections[plan.sectionId ?? WHOLE_SONG_ID]?.bassPart ?? "auto",
  }));

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
  const generate = async (requested: BandSettings, only?: RenderedKind) => {
    const using: BandSettings = only ? { ...requested, parts: { drums: only === "drums", bass: only === "bass" } } : requested;
    const current = useSong.getState().source;
    if (!current) return setNotices(["Load a song before generating parts."]);
    if (!grid) return setNotices(["Find the beat first, so the parts have a grid to follow."]);
    if (!using.parts.drums && !using.parts.bass) return setNotices(["Turn on drums or bass first."]);
    await attempt("Generating the parts was cancelled. The tracks were not changed.", async () => {
      const input = {
        grid,
        cues,
        chords,
        sections,
        settings: using,
        songEnd,
        lengthFrames: current.audio.channels[0].length,
        sampleUrls: bandSampleUrls(),
        follow: followFor(using, selectWholeSongStems(useSong.getState()), current.audio),
        mix: current.audio,
        originals: levelStems(selectWholeSongStems(useSong.getState())),
        bassLine,
        hints: sectionHints,
      };
      let request = bandRequest(input);
      const notes: string[] = [];
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
      setLastNotes(result.notes);
      // The bass tone is applied before the bass is saved, so the saved bass is the one Generate made. A tone that can't be used
      // leaves the clean bass and a notice.
      let bass = result.bass;
      let drums = result.drums;
      if (drums && using.drumTone.kind === "chain") {
        setWork(DRUM_TONE_TEXT);
        const toned = await applyPartTone(drums, using.drumTone, host.tones, renderPartChain, "drums");
        drums = toned.audio;
        if (toned.notice) notes.push(toned.notice);
      }
      if (bass && using.bassTone.kind === "chain") {
        setWork(BASS_TONE_TEXT);
        const toned = await applyPartTone(bass, using.bassTone, host.tones, renderPartChain, "bass");
        bass = toned.audio;
        if (toned.notice) notes.push(toned.notice);
      }
      if (result.follow) notes.push(followStatus(result.follow));
      const levels = levelStatus(result.levels);
      if (levels) notes.push(levels);
      // A part that is turned off loses its generated track in the same update as the parts that are applied.
      const turnedOff = only ? [] : (["drums", "bass"] as const).filter((kind) => !using.parts[kind]);
      const applied = useSong.getState().applyGeneratedParts({ drums, bass }, { playing: playingNow.current, remove: turnedOff });
      if (applied.length === 0) {
        // A part that was just generated plays at once when it was on its original, so the user hears what they made. A part turned off
        // with its generated track gone goes back to its original.
        const patch: Partial<PartChoices> = {};
        for (const kind of turnedOff) patch[kind] = "original";
        const switched = (["drums", "bass"] as const).filter((kind) => using.parts[kind] && result[kind] && partChoices[kind] === "original");
        for (const kind of switched) patch[kind] = "generated";
        if (Object.keys(patch).length) onPartChoice(patch);
        if (switched.length) notes.push(`Now playing the generated ${switched.join(" and ")}. Switch back under What plays.`);
      }
      setNotices([...notes, ...applied]);
      setDone(applied.length === 0);
      // Each generated part's first note is kept, so a rendered file can be lined up with it. A part that was replaced or removed is no
      // longer rendered, unless the generation was refused.
      const latest = settingsRef.current;
      const firstNote = { ...latest.firstNote };
      const rendered = { ...latest.rendered };
      for (const kind of RENDERED_KINDS) {
        const times = (result.notes[kind] ?? []).map((note) => note.time);
        if (using.parts[kind] && times.length) firstNote[kind] = Math.min(...times);
        else if (using.parts[kind]) delete firstNote[kind];
        if (applied.length === 0 && (using.parts[kind] || turnedOff.includes(kind))) delete rendered[kind];
      }
      commitBand({ ...latest, firstNote, rendered });
      if (applied.length === 0) {
        setOutOfDate(false);
        writeStoredBand(songKey, { bandOutOfDate: false });
      }
    });
  };

  /** Generate replaces a part that is the performer's rendered audio, so it asks first. */
  const generateOrAsk = (next: BandSettings) => {
    const replacing = RENDERED_KINDS.filter((kind) => next.parts[kind] && settingsRef.current.rendered[kind]);
    if (replacing.length) setConfirmReplace({ kinds: replacing, run: () => void generate(next) });
    else void generate(next);
  };

  /** Puts a rendered file in place of a part's generated audio, or offers the line-up first when the file's first hit is off the first note. */
  const applyRendered = (kind: RenderedKind, name: string, audio: PcmAudio, notices: string[]) => {
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
      rendering.push(`Now playing your rendered ${kind}. Switch back under What plays.`);
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
      const notices = check.notice ? [check.notice] : [];
      const firstNote = settingsRef.current.firstNote[kind] ?? null;
      const line = lineUpOffer(firstOnsetSeconds(decoded), firstNote);
      if (line?.offer) {
        // The line-up row says what the gap is, so the notice list keeps only the length note.
        setPendingRendered({ kind, name: file.name, decoded, line, notices });
        return setNotices(notices);
      }
      if (line) notices.push(line.text);
      else notices.push("No generated part to line up with, so the file is used as it is.");
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
    generateOrAsk(next);
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
      if (bass && settings.bassTone.kind === "chain") {
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
    setNotices(["The metronome now runs at this tempo."]);
  };

  const partLine = (kind: PartKind) => presenceLine(kind, missing?.[kind] ?? "unknown", missing?.absentSections[kind] ?? [], sections);

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-y-auto text-sm">
        <section aria-label="Band status" className="flex flex-col gap-1 rounded-lg border border-seam px-3 py-2">
          <p>{partLine("drums")}</p>
          <p>{partLine("bass")}</p>
          {(missing?.drums === "present" || missing?.bass === "present") && <p>You can still generate your own and switch between them under What plays.</p>}
          <p>{generated ? "Generated drum and bass tracks are in the mixer." : "No generated parts yet."}</p>
          {outOfDate && <p className="text-led-warn">Parts out of date. Press Generate to apply the changes.</p>}
        </section>

        {source !== null && <PartChoiceRows choices={partChoices} keys={partKeys} disabled={busy} onChange={onPartChoice} />}

        {source !== null && (
          <section aria-label="Rendered parts" className="flex flex-col gap-3">
            {RENDERED_KINDS.map((kind) => (
              <RenderedPartRow
                key={kind}
                kind={kind}
                rendered={settings.rendered[kind]}
                disabled={blocked}
                pending={pendingLineUp(pendingRendered, kind, () => setPendingRendered(null), applyRendered, source.audio.channels[0].length)}
                onFile={(file) => void importRendered(kind, file)}
                onBack={() => void backToGenerated(kind)}
              />
            ))}
          </section>
        )}

        <BandGridSection
          grid={grid}
          harmony={harmony}
          blocked={blocked}
          busy={busy && finding}
          work={finding ? work : null}
          onGrid={applyGrid}
          onFind={() => void findBeat()}
          onCancel={() => job.current?.cancel()}
          onFixed={usesFixed}
          onSetTempo={setTo}
          myTempo={typedTempo ? { bpm, use: useMyTempo, onUse: setUseMyTempo } : undefined}
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

        <BandSettingsForm settings={settings} followSources={followSources} onChange={change} onStyle={changeStyle} songSeconds={songEnd} />

        <section aria-label="Sections" className="flex flex-col gap-2">
          <h3 className="font-semibold">Sections</h3>
          <BandSections
            rows={rows}
            disabled={blocked}
            selected={selected}
            onSelect={(index) => {
              setSelected(index);
              if (index !== null) setPreviewAt(null);
            }}
            onChange={changeRow}
          />
        </section>

        <p className="text-silkscreen-3">Render it with your own instruments, then use it here.</p>
      </div>

      <footer aria-label="Band actions" className="flex shrink-0 flex-col gap-2 border-t border-seam pt-3 text-sm">
        {source === null && (
          <p role="note" className="text-led-warn">
            {NO_SONG_TEXT}
          </p>
        )}
        {playing && (
          <p role="note" className="text-led-warn">
            {PLAYING_TEXT}
          </p>
        )}
        {work && !finding && (
          <div className="flex items-center gap-2" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            <span>{work}</span>
            <Button size="sm" variant="ghost" onClick={() => job.current?.cancel()}>
              Cancel
            </Button>
          </div>
        )}
        {previewing && !work && <p role="status">{previewing}</p>}
        {done && !work && (
          <div className="flex flex-wrap items-center gap-2" role="status">
            <span>Done. Drums and bass are in the mixer.</span>
            <Button size="sm" variant="outline" onClick={() => show(false)}>
              Close
            </Button>
            {onPlayFrom && (
              <Button
                size="sm"
                onClick={() => {
                  show(false);
                  onPlayFrom(selected !== null ? rows[selected].plan.start : 0);
                }}
              >
                {selected !== null ? `Play from ${rows[selected].name}` : "Play from the start"}
              </Button>
            )}
          </div>
        )}
        {notices.length > 0 && (
          <ul role="status" className="flex list-disc flex-col gap-1 pl-5 text-led-warn">
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={blocked || !grid} onClick={() => generateOrAsk(settings)}>
            Generate
          </Button>
          <Button variant="outline" disabled={blocked || !grid} onClick={tryAnother}>
            Try another
          </Button>
          <Button variant="outline" disabled={blocked || !grid} onClick={() => (previewing ? stopPreview.current?.() : void preview())}>
            {previewing ? "Stop preview" : "Preview"}
          </Button>
          <Select value={target} onValueChange={setPreviewAt} disabled={blocked || previewing !== null}>
            <SelectTrigger aria-label="Preview section" className="h-9 w-auto min-w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rows.map(({ name }, index) => (
                <SelectItem key={index} value={String(index)}>
                  {name}
                </SelectItem>
              ))}
              <SelectItem value={PLAYHEAD}>From the playhead</SelectItem>
            </SelectContent>
          </Select>
          <Select value={previewLength} onValueChange={(value) => setPreviewLength(value as "whole" | "4" | "8")} disabled={blocked || previewing !== null}>
            <SelectTrigger aria-label="Preview length" className="h-9 w-auto min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="whole">Whole section</SelectItem>
              <SelectItem value="4">4 bars</SelectItem>
              <SelectItem value="8">8 bars</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={blocked || !generated} onClick={() => setConfirmRemove(true)}>
            Remove generated parts
          </Button>
          <Button variant="outline" disabled={playing || lastNotes === null} onClick={() => void exportMidi()}>
            Export MIDI…
          </Button>
        </div>
      </footer>

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
    </>
  );
}

/** The line-up offer of a rendered file for one part, or null when the pending file is for the other part. */
function pendingLineUp(
  pending: PendingRendered | null,
  kind: RenderedKind,
  dismiss: () => void,
  apply: (kind: RenderedKind, name: string, audio: PcmAudio, notices: string[]) => void,
  frames: number,
): PendingLineUp | null {
  if (!pending || pending.kind !== kind) return null;
  return {
    text: pending.line.text,
    shiftSeconds: pending.line.shiftSeconds,
    onLineUp: () => apply(kind, pending.name, shiftAudio(pending.decoded, pending.line.shiftSeconds, frames), pending.notices),
    onUseAsIs: () => {
      apply(kind, pending.name, fitToLength(pending.decoded, frames), pending.notices);
      dismiss();
    },
  };
}

function stageText(stage: BandStage): string {
  if (stage === "loading") return "Loading the drum and bass samples…";
  if (stage === "generating") return "Writing the notes…";
  return "Rendering the parts…";
}
