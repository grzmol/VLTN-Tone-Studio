import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Guitar, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Toggle } from "@/components/ui/toggle";
import { host } from "@/host";
import { notifyError, notifySuccess } from "@/app/notify";
import { cn } from "@/lib/utils";
import { useNav } from "@/state/nav";
import { useStatusHints } from "@/state/ui";
import { useSong } from "@/song/store";
import { defaultMix, formatTime, peaks, type Mix, type StemMix } from "@/song/stems/mix";
import { findQuality } from "@/song/stems/options";
import { StemPlayer } from "@/song/stems/player";
import { encodeWav } from "@/song/wav";
import { STEM_NAMES, type StemName, type Stems, type SplitInfo } from "@/song/types";
import { findModel } from "@shared/host/song";
import { performanceKey, readOptions } from "@/song/performance/settings";
import { SplitOptions } from "./SplitOptions";

const PANEL = "glass rounded-xl min-w-0 min-h-0";
const WAVE_BUCKETS = 800;
const HINTS = [{ keys: ["Space"], label: "play" }];
const STEM_LABEL: Record<StemName, string> = { drums: "Drums", bass: "Bass", other: "Other", vocals: "Vocals", guitar: "Guitar", piano: "Piano" };
const STEM_COLOR: Record<StemName, string> = {
  drums: "var(--block-dst)",
  bass: "var(--block-mod)",
  other: "var(--block-nr)",
  vocals: "var(--block-ns)",
  guitar: "var(--block-amp)",
  piano: "var(--block-dly)",
};
const BACKEND_LABEL = { webgpu: "on the graphics card (WebGPU)", wasm: "on the processor (WebAssembly)" } as const;
const COUNT_WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six"];

const isEditable = (el: Element | null) =>
  !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

/** File name without its extension, for "<song> - guitar.wav". */
const baseName = (name: string) => name.replace(/\.[^.]+$/, "") || "Song";

async function exportStems(songName: string, stems: Stems, names: StemName[], bits: 16 | 24) {
  try {
    const files = names.map((n) => ({ name: `${baseName(songName)} - ${n}.wav`, bytes: encodeWav(stems[n]!, bits) }));
    const where = await host.song.saveFiles(files, "Export stems");
    if (where) notifySuccess("Stems exported", where);
  } catch (e) {
    notifyError("Couldn't export the stems", e);
  }
}

/** "Split with Best, Balanced in 312.4 s on the processor (WebAssembly)." */
function splitSummary({ model, quality, seconds, backends }: SplitInfo): string {
  const where = backends.length === 1 ? BACKEND_LABEL[backends[0]] : "on the graphics card and the processor";
  return `Split with ${findModel(model)?.label ?? model}, ${findQuality(quality)?.label ?? quality} in ${seconds.toFixed(1)} s ${where}.`;
}

/** Transport, one row per stem (mute, solo, volume, waveform, level), the export and splitting again. */
export function StemMixer({ stems, songName }: { stems: Stems; songName: string }) {
  const lastSplit = useSong((s) => s.lastSplit);
  const settingsKey = performanceKey(useSong(s => s.source));
  // Created in an effect so StrictMode's mount/unmount/mount gets a live AudioContext.
  const [player, setPlayer] = useState<StemPlayer | null>(null);
  const names = useMemo(() => STEM_NAMES.filter((n) => stems[n]), [stems]);
  const first = stems[names[0]]!;
  const duration = first.channels[0].length / first.sampleRate;
  const [mix, setMix] = useState<Mix>(() => readOptions(settingsKey, { mix: defaultMix() }).mix);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [levels, setLevels] = useState<Partial<Record<StemName, number>> | null>(null);
  const waves = useMemo(() => Object.fromEntries(names.map((n) => [n, peaks(stems[n]!.channels, WAVE_BUCKETS)])) as Partial<Record<StemName, Float32Array>>, [stems, names]);
  useStatusHints(HINTS);

  useEffect(() => {
    const p = new StemPlayer(stems);
    p.onEnded = () => {
      setPlaying(false);
      setTime(p.duration);
    };
    setPlayer(p);
    return () => {
      setPlayer(null);
      setPlaying(false);
      void p.dispose();
    };
  }, [stems]);

  useEffect(() => player?.setMix(mix), [player, mix]);
  useEffect(() => {
    try { localStorage.setItem(settingsKey + ':options', JSON.stringify({ ...readOptions(settingsKey, {}), mix })); }
    catch (e) { notifyError('Could not save mixer settings', e); }
  }, [settingsKey, mix]);

  // Position and meters follow the audio clock while playing.
  useEffect(() => {
    if (!playing || !player) {
      setLevels(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      setTime(player.position);
      setLevels(player.levels());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [player, playing]);

  const toggle = useCallback(async () => {
    if (!player) return;
    if (player.isPlaying) {
      player.pause();
      setPlaying(false);
      setTime(player.position);
      return;
    }
    try {
      await player.play();
      setPlaying(true);
    } catch (e) {
      notifyError("Couldn't play the stems", e);
    }
  }, [player]);

  const seek = useCallback(
    (seconds: number) => {
      void player?.seek(seconds);
      setTime(Math.max(0, Math.min(duration, seconds)));
    },
    [player, duration],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditable(document.activeElement)) return;
      if (document.activeElement instanceof HTMLButtonElement || document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const update = (name: StemName, patch: Partial<StemMix>) => setMix((m) => ({ ...m, [name]: { ...m[name], ...patch } }));
  const progress = duration ? time / duration : 0;

  return (
    <section aria-label="Stems" className={cn(PANEL, "flex min-h-0 flex-col gap-3 px-4 py-3.5")}>
      <div className="flex min-w-0 items-center gap-3.5">
        <Button size="icon" onClick={() => void toggle()} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="w-[92px] shrink-0 text-[12px] text-silkscreen-2 tabular-nums">
          {formatTime(time)} / {formatTime(duration)}
        </span>
        <Slider
          aria-label="Position"
          className="min-w-0 flex-1"
          min={0}
          max={duration}
          step={0.1}
          value={[time]}
          onValueChange={([v]) => seek(v)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Download data-icon="inline-start" />
              Export stems
              <ChevronDown data-icon="inline-end" className="text-silkscreen-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{COUNT_WORD[names.length]} WAV files, 44.1 kHz stereo</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => void exportStems(songName, stems, names, 16)}>WAV 16-bit</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportStems(songName, stems, names, 24)}>WAV 24-bit</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div role="list" aria-label="Stems" className="flex min-h-0 flex-col gap-1.5 overflow-y-auto">
        {names.map((name) => (
          <StemRow
            key={name}
            name={name}
            mix={mix[name]}
            wave={waves[name]!}
            progress={progress}
            level={levels?.[name] ?? 0}
            onChange={(patch) => update(name, patch)}
            onSeek={(fraction) => seek(fraction * duration)}
          />
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <p className="min-w-0 flex-1 text-[11px] text-pretty text-silkscreen-3">
          {lastSplit && `${splitSummary(lastSplit)} `}Solo a stem to hear it alone.
        </p>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <RotateCcw data-icon="inline-start" />
              Split again…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="flex w-[440px] flex-col gap-3 bg-surface-solid-raised!">
            <span className="text-sm font-[550] text-silkscreen-2">Split again with another model or quality</span>
            <SplitOptions />
            <Button className="self-end" onClick={() => void useSong.getState().split()}>
              Split again
            </Button>
          </PopoverContent>
        </Popover>
        {stems.guitar && (
          <Button onClick={() => useNav.getState().go("song", "tone")}>
            <Guitar data-icon="inline-start" />
            Match the guitar tone
          </Button>
        )}
      </div>
    </section>
  );
}

interface StemRowProps {
  name: StemName;
  mix: StemMix;
  wave: Float32Array;
  progress: number;
  level: number;
  onChange(patch: Partial<StemMix>): void;
  onSeek(fraction: number): void;
}

function StemRow({ name, mix, wave, progress, level, onChange, onSeek }: StemRowProps) {
  const label = STEM_LABEL[name];
  // RMS to a 0..1 meter over -60..0 dBFS.
  const meter = level > 0 ? Math.max(0, Math.min(1, 1 + (20 * Math.log10(level)) / 60)) : 0;
  return (
    <div role="listitem" aria-label={label} className="grid grid-cols-[96px_auto_120px_minmax(0,1fr)] items-center gap-3 rounded-lg bg-white/4 px-3 py-2">
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="size-2 rounded-full" style={{ background: STEM_COLOR[name] }} aria-hidden />
        {label}
      </span>
      <span className="flex gap-1">
        <Toggle size="sm" pressed={mix.mute} onPressedChange={(mute) => onChange({ mute })} aria-label={`Mute ${label}`}>
          M
        </Toggle>
        <Toggle size="sm" pressed={mix.solo} onPressedChange={(solo) => onChange({ solo })} aria-label={`Solo ${label}`}>
          S
        </Toggle>
      </span>
      <Slider aria-label={`${label} volume`} min={0} max={1} step={0.01} value={[mix.volume]} onValueChange={([volume]) => onChange({ volume })} />
      <div className="flex min-w-0 items-center gap-2">
        <Waveform wave={wave} progress={progress} color={STEM_COLOR[name]} dim={mix.mute} onSeek={onSeek} label={label} />
        <span className="h-9 w-1.5 shrink-0 overflow-hidden rounded-full bg-well" aria-hidden>
          <span className="block w-full rounded-full bg-silkscreen-2" style={{ height: `${meter * 100}%`, marginTop: `${(1 - meter) * 100}%` }} />
        </span>
      </div>
    </div>
  );
}

function Waveform({ wave, progress, color, dim, onSeek, label }: { wave: Float32Array; progress: number; color: string; dim: boolean; onSeek(f: number): void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      setSize({ w: Math.max(1, Math.round(el.clientWidth * dpr)), h: Math.max(1, Math.round(el.clientHeight * dpr)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !size) return;
    const { w, h } = size;
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(el).getPropertyValue("--wave").trim() || "#999";
    const played = Math.round(progress * w);
    for (let x = 0; x < w; x++) {
      const peak = wave[Math.min(wave.length - 1, Math.floor((x / w) * wave.length))];
      const bar = Math.max(1, Math.min(1, peak) * h);
      ctx.globalAlpha = dim ? 0.25 : x < played ? 1 : 0.45;
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [wave, progress, dim, size]);

  return (
    <canvas
      ref={canvas}
      role="slider"
      aria-label={`${label} waveform, click to seek`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={-1}
      className="h-9 min-w-0 flex-1 cursor-pointer"
      style={{ "--wave": color } as React.CSSProperties}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    />
  );
}
