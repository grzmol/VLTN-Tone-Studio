import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { notifyError } from "@/app/notify";
import { cn } from "@/lib/utils";
import { PartPreview } from "@/song/preview";
import { audioSeconds, MIN_RANGE_SECONDS } from "@/song/range";
import { useSong } from "@/song/store";
import { formatTime, peaks } from "@/song/stems/mix";

const WAVE_BUCKETS = 800;
const STEP_S = 0.1;
/** Pointer travel that turns a press on the waveform into a drag */
const DRAG_PX = 4;

/**
 * The part of the loaded song the split takes: the song's waveform with the part lit (drag across it to choose a
 * part), handles to adjust it, and a preview to hear it. A whole song splits when no part is chosen.
 */
export function PartPicker({ className }: { className?: string }) {
  const source = useSong((s) => s.source);
  const range = useSong((s) => s.range);
  const busy = useSong((s) => s.status.kind === "decoding" || s.status.kind === "model" || s.status.kind === "splitting");
  const duration = source ? audioSeconds(source.audio) : 0;
  const part = range ?? { start: 0, end: duration };
  const wave = useMemo(() => (source ? peaks(source.audio.channels, WAVE_BUCKETS) : new Float32Array(0)), [source]);
  // Created in an effect so StrictMode's mount/unmount/mount gets a live AudioContext.
  const [preview, setPreview] = useState<PartPreview | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState<number | null>(null);

  useEffect(() => {
    if (!source) return;
    const p = new PartPreview(source.audio);
    p.onEnded = () => setPlaying(false);
    setPreview(p);
    return () => {
      setPreview(null);
      setPlaying(false);
      void p.dispose();
    };
  }, [source]);

  // The playhead follows the audio clock while the part plays.
  useEffect(() => {
    if (!playing || !preview) {
      setTime(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      setTime(preview.position);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview, playing]);

  if (!source) return null;

  const choose = (start: number, end: number) => {
    preview?.stop();
    setPlaying(false);
    useSong.getState().setRange({ start, end });
  };

  const toggle = async () => {
    if (!preview) return;
    if (preview.isPlaying) {
      preview.stop();
      setPlaying(false);
      return;
    }
    try {
      await preview.play(part);
      setPlaying(true);
    } catch (e) {
      notifyError("Couldn't play the part", e);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2 text-left", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[12px] font-semibold text-silkscreen-2">Part to split</span>
        <span className="text-[12px] text-silkscreen-3 tabular-nums">
          {range ? `${formatTime(part.start)} – ${formatTime(part.end)} (${formatTime(part.end - part.start)} of ${formatTime(duration)})` : `Whole song, ${formatTime(duration)}`}
        </span>
        <span className="ml-auto flex gap-1">
          {range && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => choose(0, duration)}>
              Whole song
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={!preview} onClick={() => void toggle()}>
            {playing ? <Square data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            {playing ? "Stop" : range ? "Play the part" : "Play"}
          </Button>
        </span>
      </div>
      <PartWave wave={wave} duration={duration} part={part} time={time} disabled={busy} onChoose={choose} />
      <Slider
        aria-label="Part to split"
        min={0}
        max={duration}
        step={STEP_S}
        minStepsBetweenThumbs={Math.round(Math.min(MIN_RANGE_SECONDS, duration) / STEP_S)}
        value={[part.start, part.end]}
        disabled={busy}
        onValueChange={([start, end]) => choose(start, end)}
      />
      <p className="text-[12px] text-pretty text-silkscreen-3">
        Drag across the waveform to pick the part with the guitar sound you want, such as one riff or the solo. Tone Match reads that part only, and a shorter part
        splits faster and with less memory.
      </p>
    </div>
  );
}

interface PartWaveProps {
  wave: Float32Array;
  duration: number;
  part: { start: number; end: number };
  /** Playhead in seconds while the part plays */
  time: number | null;
  disabled: boolean;
  onChoose(start: number, end: number): void;
}

/** The whole song's waveform with the part lit; dragging across it chooses a new part. */
function PartWave({ wave, duration, part, time, disabled, onChoose }: PartWaveProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /** Where a drag started: song seconds and the pointer's x */
  const drag = useRef<{ from: number; x: number; moved: boolean } | null>(null);

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
    if (!el || !ctx || !size || !duration) return;
    const { w, h } = size;
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(el).getPropertyValue("--wave").trim() || "#999";
    const from = (part.start / duration) * w;
    const to = (part.end / duration) * w;
    for (let x = 0; x < w; x++) {
      const peak = wave[Math.min(wave.length - 1, Math.floor((x / w) * wave.length))] ?? 0;
      const bar = Math.max(1, Math.min(1, peak) * h);
      ctx.globalAlpha = x >= from && x < to ? 1 : 0.25;
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
    if (time !== null) {
      ctx.globalAlpha = 1;
      ctx.fillRect(Math.round((time / duration) * w), 0, Math.max(1, Math.round(window.devicePixelRatio || 1)), h);
    }
  }, [wave, duration, part.start, part.end, time, size]);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const choose = (a: number, b: number) => onChoose(Math.min(a, b), Math.max(a, b));

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn("h-16 w-full rounded-lg bg-white/4", disabled ? "pointer-events-none opacity-50" : "cursor-crosshair")}
      style={{ "--wave": "var(--block-amp)" } as React.CSSProperties}
      onPointerDown={(e) => {
        drag.current = { from: at(e), x: e.clientX, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // A click that wobbles a few pixels keeps the current part.
        if (!d.moved && Math.abs(e.clientX - d.x) < DRAG_PX) return;
        d.moved = true;
        choose(d.from, at(e));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    />
  );
}
