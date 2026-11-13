import { PreparePedalsButton } from "./PreparePedalsButton";
import { SongPreparationStatus } from "./SongPreparationStatus";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useSong } from "@/song/store";
import { useSongLibrary } from "@/song/library";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { isMetronomeMode, METRONOME_MODES, type MetronomeMode } from "@/song/performance/rhythm";
import { clampCrossfade } from "@/song/performance/transition";
import { readCrossfade, writeCrossfade } from "@/song/performance/crossfade";
import { CLICK_SOUNDS, isClickSound, isCountInSound, type ClickSounds, type ClickSoundsOwn } from "@/song/performance/click-sound";
import { LEAD_IN_LIMITS, type LeadIn, type LeadInKey, type LeadInOwn } from "@/song/performance/lead-in";
import { ClickSoundOptions } from "./ClickSoundOptions";
import { ClickSampleSettings, useClickSampleSync } from "./ClickSampleSettings";
import { MidiClickSettingsView, useMidiClick } from "./MidiClickSettings";
import { parseSeconds } from "./format";
import { ClockOverDuration, PositionSlider } from "./PlaybackDisplay";
import { BeatIndicator } from "./BeatIndicator";
import { HelpNote } from "@/components/ui/help-note";

const field = "rounded border border-seam bg-transparent p-2";

/** A typed value kept within the key's range. Count-in and pre-roll are whole beats or bars. */
const limit = (key: LeadInKey, text: string): number => {
  const { min, max } = LEAD_IN_LIMITS[key];
  const value = Number(text) || 0;
  return Math.min(max, Math.max(min, key === "startDelay" ? value : Math.round(value)));
};

const bars = (count: number): string => (count === 0 ? "off" : `${count} bar${count === 1 ? "" : "s"}`);

const inBpmRange = (value: number): boolean => value >= 30 && value <= 300;

/**
 * The song BPM as a text field. Typing keeps the text, so a half-typed value is not clamped:
 * a whole number in range is set at once, anything else is committed, clamped to 30–300, on blur or Enter.
 * Escape drops the typed text and shows the current BPM again.
 */
export function BpmField({ bpm, disabled, onBpm }: { bpm: number; disabled: boolean; onBpm: (value: number) => void }) {
  // The typed text while editing; null shows the BPM itself, so a change from outside shows while not editing.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const typed = parseSeconds(text);
    if (typed !== null) onBpm(Math.max(30, Math.min(300, typed)));
    setDraft(null);
  };
  return (
    <input
      className={field + " w-20"}
      aria-label="BPM"
      title="Set the recording’s BPM while stopped. Audio speed and cue timestamps stay unchanged."
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? String(Math.round(bpm * 10) / 10)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (/^\d+$/.test(text) && inBpmRange(Number(text))) onBpm(Number(text));
      }}
      onBlur={() => {
        if (draft !== null) commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

export interface MetronomeSettings {
  metronome: MetronomeMode;
  onMetronome: (value: MetronomeMode) => void;
  firstBeat: number;
  onFirstBeat: (value: number) => void;
  beats: number;
  onBeats: (value: number) => void;
  volume: number;
  onVolume: (value: number) => void;
  /** A song's own count-in, pre-roll and start delay; "" uses the global default */
  lead: LeadInOwn;
  onLead: (key: LeadInKey, value: number | "") => void;
  /** The global defaults, which a song without its own value uses */
  leadDefaults: LeadIn;
  onLeadDefault: (key: LeadInKey, value: number) => void;
  /** A song's own metronome and count-in sounds; "" uses the global default */
  soundOwn: ClickSoundsOwn;
  onSoundOwn: (value: ClickSoundsOwn) => void;
  /** The global default sounds */
  soundDefaults: ClickSounds;
  onSoundDefaults: (value: ClickSounds) => void;
}

const soundLabel = (id: string): string => CLICK_SOUNDS.find((sound) => sound.id === id)?.label ?? id;

/** Playlist controls, library messages, play/seek and the tempo and metronome settings. */
export function PerformanceTransport({
  session,
  stage,
  bpm,
  onBpm,
  onDetect,
  detectDisabled = false,
  detecting = false,
  beatHint,
  onTap,
  metronome,
}: {
  session: PerformanceSession;
  stage: boolean;
  bpm: number;
  onBpm: (value: number) => void;
  /** Detects the tempo again from the audio. Not shown when not given. */
  onDetect?: () => void;
  detectDisabled?: boolean;
  detecting?: boolean;
  /** Finds the beat again from the typed tempo. `lock` keeps that tempo exactly. Not shown when not given. */
  beatHint?: { bpm: number; onFind(lock: boolean): void };
  onTap: () => void;
  metronome: MetronomeSettings;
}) {
  const library = useSongLibrary();
  const [keepExact, setKeepExact] = useState(false);
  const [crossfade, setCrossfade] = useState(readCrossfade);
  const source = useSong((s) => s.source);
  const player = useSession(session, (s) => s.player);
  useClickSampleSync(player);
  const midiClick = useMidiClick(session, player);
  const timecodeOn = useSession(session, (s) => s.timecode.enabled);
  const playing = useSession(session, (s) => s.playing);
  const starting = useSession(session, (s) => s.starting);
  const rhythmRestart = useSession(session, (s) => s.rhythmRestart);
  const queued = useSession(session, (s) => s.queued);
  const parseError = useSession(session, (s) => s.parseError);
  const tempoOnStart = useSession(session, (s) => s.tempoOnStart);
  const clock = useSession(session, (s) => s.clock);
  const duration = player?.duration ?? 0;
  const { firstBeat, onFirstBeat } = metronome;
  // The set is playing, but this song's entry asks to wait for Play, so nothing has started it yet.
  const waitingForPlay = library.playlistPlaying && !playing && library.queueOverrides[library.position]?.autoplay === false;
  return (
    <>
      {queued && (
        <div aria-label="Playlist transport" className="flex flex-wrap items-center gap-3 rounded border border-seam p-3">
          <strong>{library.index.songs.find((s) => s.id === source?.libraryId)?.title}</strong>
          <span>
            {library.position + 1} / {library.queue.length}
          </span>
          <Button variant="outline" disabled={library.busy || library.position <= 0} onClick={() => session.skip(-1)}>
            Previous song
          </Button>
          <Button variant="outline" disabled={library.busy || library.position + 1 >= library.queue.length} onClick={() => session.skip(1)}>
            Next song
          </Button>
          <label className="flex items-center gap-2">
            Crossfade (s)
            <input
              type="number"
              min={0}
              max={10}
              step={0.5}
              className={field}
              value={crossfade}
              onChange={(e) => {
                const value = clampCrossfade(Number(e.target.value));
                setCrossfade(value);
                writeCrossfade(value);
              }}
            />
          </label>
          <Button
            variant="outline"
            disabled={!playing || !library.preparedNext()}
            title="Starts the next song now and fades this one out over the crossfade length. Needs the next song loaded."
            onClick={() => session.crossfadeNext()}
          >
            Crossfade to next
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              session.pause();
              library.pausePlaylist();
            }}
          >
            Stop playlist
          </Button>
          <span>
            {library.busy
              ? "Loading next song..."
              : !library.playlistPlaying
                ? "Playlist paused"
                : waitingForPlay
                  ? "Playlist waiting for Play"
                  : "Playlist playing"}{" "}
            · Next: {library.index.songs.find((s) => s.id === library.queue[library.position + 1])?.title ?? "End of set"}
          </span>
          <div className="w-full">
            <HelpNote>
              <p>Songs advance automatically while the playlist is playing. MIDI output stays armed for this set while the same device remains connected.</p>
            </HelpNote>
          </div>
        </div>
      )}
      {library.error && (
        <p role="alert" className="text-red-400">
          {library.error}
        </p>
      )}
      {queued && library.notice === "Playlist finished." && <p role="status">Playlist finished.</p>}
      <SongPreparationStatus session={session} />
      {rhythmRestart && <p role="status">RC-10R needs a restart to align its drums. Play from beginning.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <PreparePedalsButton session={session} />
        {rhythmRestart && (
          <Button disabled={!player || library.busy || starting || stage} onClick={() => void session.playFromBeginning()}>
            Play from beginning
          </Button>
        )}
        <Button
          disabled={!player || !!parseError || library.busy}
          onClick={() => (playing ? session.pause() : starting ? session.cancelStart() : session.startPlayback())}
        >
          {playing ? "Pause" : starting ? "Cancel start" : queued && (library.queue.length > 1 || !!library.playingSet) ? "Play playlist" : "Play song"}
        </Button>
        <Button variant="outline" disabled={!player || stage} onClick={() => void session.seek(0)}>
          Rewind
        </Button>
        <ClockOverDuration plain duration={duration} />
        <PositionSlider label="Song position" duration={duration} onSeek={(value) => void session.seek(value)} />
        {!source && <span>Open a song in Stems to perform.</span>}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
          <label>
            Song BPM <BpmField bpm={bpm} disabled={playing} onBpm={onBpm} />
          </label>
          {onDetect && (
            <Button variant="outline" disabled={detectDisabled} title="Detect the tempo from the audio" onClick={onDetect}>
              {detecting ? "Detecting…" : "Detect"}
            </Button>
          )}
          {beatHint && (
            <>
              <Button
                variant="outline"
                disabled={detectDisabled || playing}
                title={`Find the beat again from ${beatHint.bpm} BPM, so the click lines up with the recording`}
                onClick={() => beatHint.onFind(keepExact)}
              >
                Find the beat at {beatHint.bpm} BPM
              </Button>
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={keepExact} onCheckedChange={(value) => setKeepExact(value === true)} />
                Keep exactly {beatHint.bpm}
              </label>
            </>
          )}
          <Button variant="outline" disabled={playing} title="Tap the tempo (T). Sets the song BPM while stopped." onClick={onTap}>
            Tap tempo
          </Button>
          <BeatIndicator bpm={bpm} beats={metronome.beats} firstBeat={metronome.firstBeat} />
          <label>
            Metronome{" "}
            <select
              aria-label="Metronome mode"
              className={field}
              value={metronome.metronome}
              onChange={(e) => {
                if (isMetronomeMode(e.target.value)) metronome.onMetronome(e.target.value);
              }}
            >
              {METRONOME_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sound{" "}
            <select
              aria-label="Metronome sound"
              className={field}
              value={metronome.soundOwn.sound}
              onChange={(e) => {
                if (e.target.value === "" || isClickSound(e.target.value)) metronome.onSoundOwn({ ...metronome.soundOwn, sound: e.target.value });
              }}
            >
              <option value="">Default ({soundLabel(metronome.soundDefaults.sound)})</option>
              <ClickSoundOptions />
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Listen to the metronome sound"
            disabled={playing || !player}
            onClick={() => void player?.previewClicks("metronome")}
          >
            Listen
          </Button>
          <span>
            Count-in{" "}
            <select
              aria-label="Count-in bars"
              className={field}
              disabled={playing}
              value={metronome.lead.countInBars}
              onChange={(e) => metronome.onLead("countInBars", e.target.value === "" ? "" : limit("countInBars", e.target.value))}
            >
              <option value="">Default ({bars(metronome.leadDefaults.countInBars)})</option>
              <option value={0}>Off</option>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
          </span>
          <label>
            <span className="sr-only">Count-in sound</span>
            <select
              aria-label="Count-in sound"
              className={field}
              value={metronome.soundOwn.countInSound}
              onChange={(e) => {
                if (e.target.value === "" || isCountInSound(e.target.value)) metronome.onSoundOwn({ ...metronome.soundOwn, countInSound: e.target.value });
              }}
            >
              <option value="">
                Default ({metronome.soundDefaults.countInSound === "same" ? "same as metronome" : soundLabel(metronome.soundDefaults.countInSound)})
              </option>
              <option value="same">Same as metronome</option>
              <ClickSoundOptions />
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Listen to the count-in sound"
            disabled={playing || !player}
            onClick={() => void player?.previewClicks("countIn")}
          >
            Listen
          </Button>
          <details className="relative">
            <summary className="cursor-pointer">Metronome settings</summary>
            <div className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-xl border border-seam bg-background p-4 shadow-xl">
              <p>Follows song playback. The count-in, pre-roll and start delay are saved for each song.</p>
              <label className="block">
                First beat (seconds){" "}
                <input
                  aria-label="First beat (seconds)"
                  className={field + " w-24"}
                  type="number"
                  min="0"
                  step="0.001"
                  disabled={playing}
                  value={firstBeat}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) onFirstBeat(n);
                  }}
                />
              </label>
              <Button variant="outline" disabled={!player || playing} onClick={() => onFirstBeat(Math.round(Math.max(0, player?.position ?? 0) * 1000) / 1000)}>
                Set first beat here
              </Button>
              <Button variant="outline" disabled={playing || firstBeat === 0} onClick={() => onFirstBeat(0)}>
                Reset first beat
              </Button>
              <HelpNote>
                <p>While stopped, seek to the first downbeat and set it here. Clicks begin there; song audio and MIDI cue timestamps stay unchanged.</p>
              </HelpNote>
              <label className="block">
                Beats{" "}
                <select aria-label="Beats" className={field} value={metronome.beats} onChange={(e) => metronome.onBeats(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="space-y-2 rounded border border-seam p-2">
                <p className="font-semibold">This song (empty uses the default)</p>
                <label className="block">
                  Count-in{" "}
                  <select
                    aria-label="Count-in"
                    className={field}
                    disabled={playing}
                    value={metronome.lead.countInBars}
                    onChange={(e) => metronome.onLead("countInBars", e.target.value === "" ? "" : limit("countInBars", e.target.value))}
                  >
                    <option value="">Default ({bars(metronome.leadDefaults.countInBars)})</option>
                    <option value={0}>Off</option>
                    <option value={1}>1 bar</option>
                    <option value={2}>2 bars</option>
                  </select>
                </label>
                <label className="block">
                  Pre-roll (beats){" "}
                  <input
                    aria-label="Pre-roll (beats)"
                    className={field + " w-20"}
                    type="number"
                    min="0"
                    max="16"
                    step="1"
                    disabled={playing}
                    placeholder={String(metronome.leadDefaults.preRollBeats)}
                    value={metronome.lead.preRollBeats}
                    onChange={(e) => metronome.onLead("preRollBeats", e.target.value === "" ? "" : limit("preRollBeats", e.target.value))}
                  />
                </label>
                <label className="block">
                  Start delay (seconds){" "}
                  <input
                    aria-label="Start delay (seconds)"
                    className={field + " w-20"}
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    placeholder={String(metronome.leadDefaults.startDelay)}
                    value={metronome.lead.startDelay}
                    onChange={(e) => metronome.onLead("startDelay", e.target.value === "" ? "" : limit("startDelay", e.target.value))}
                  />
                </label>
              </div>
              <div className="space-y-2 rounded border border-seam p-2">
                <p className="font-semibold">Defaults for songs without their own</p>
                <label className="block">
                  Default count-in{" "}
                  <select
                    aria-label="Default count-in"
                    className={field}
                    value={metronome.leadDefaults.countInBars}
                    onChange={(e) => metronome.onLeadDefault("countInBars", limit("countInBars", e.target.value))}
                  >
                    <option value={0}>Off</option>
                    <option value={1}>1 bar</option>
                    <option value={2}>2 bars</option>
                  </select>
                </label>
                <ClickSampleSettings />
                <MidiClickSettingsView midi={midiClick} />
                <label className="block">
                  Default sound{" "}
                  <select
                    aria-label="Default metronome sound"
                    className={field}
                    value={metronome.soundDefaults.sound}
                    onChange={(e) => {
                      if (isClickSound(e.target.value)) metronome.onSoundDefaults({ ...metronome.soundDefaults, sound: e.target.value });
                    }}
                  >
                    <ClickSoundOptions />
                  </select>
                </label>
                <label className="block">
                  Default count-in sound{" "}
                  <select
                    aria-label="Default count-in sound"
                    className={field}
                    value={metronome.soundDefaults.countInSound}
                    onChange={(e) => {
                      if (isCountInSound(e.target.value)) metronome.onSoundDefaults({ ...metronome.soundDefaults, countInSound: e.target.value });
                    }}
                  >
                    <option value="same">Same as metronome</option>
                    <ClickSoundOptions />
                  </select>
                </label>
                <label className="block">
                  Default pre-roll (beats){" "}
                  <input
                    aria-label="Default pre-roll (beats)"
                    className={field + " w-20"}
                    type="number"
                    min="0"
                    max="16"
                    step="1"
                    value={metronome.leadDefaults.preRollBeats}
                    onChange={(e) => metronome.onLeadDefault("preRollBeats", limit("preRollBeats", e.target.value))}
                  />
                </label>
                <label className="block">
                  Default start delay (seconds){" "}
                  <input
                    aria-label="Default start delay (seconds)"
                    className={field + " w-20"}
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={metronome.leadDefaults.startDelay}
                    onChange={(e) => metronome.onLeadDefault("startDelay", limit("startDelay", e.target.value))}
                  />
                </label>
              </div>
              <label className="block">
                Metronome volume{" "}
                <input
                  aria-label="Metronome volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={metronome.volume}
                  onChange={(e) => metronome.onVolume(Number(e.target.value))}
                />
              </label>
              <HelpNote>
                <p>Set BPM to match the recording. Beat one is at the start of the audio; this does not detect tempo or stretch audio.</p>
              </HelpNote>
            </div>
          </details>
          <label>
            <input
              type="checkbox"
              aria-label="MIDI Clock (24 PPQN)"
              disabled={tempoOnStart || timecodeOn}
              checked={clock}
              onChange={(e) => session.setClock(e.target.checked)}
            />{" "}
            Send MIDI Clock
          </label>
        </div>
      </div>
    </>
  );
}
