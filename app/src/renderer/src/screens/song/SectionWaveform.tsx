import { useEffect, useMemo, useRef } from "react";
import { peaks } from "@/song/stems/mix";
import type { Section } from "@/song/performance/sections";

const BUCKETS = 600;

/**
 * The song's waveform with its sections drawn over it. A click reports the song time under the pointer, so the editor can place the
 * selected section's start or end there.
 */
export function SectionWaveform({
  channels,
  duration,
  sections,
  selected,
  onPick,
}: {
  channels: Float32Array[] | null;
  duration: number;
  sections: Section[];
  selected: string | null;
  onPick: (seconds: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bars = useMemo(() => (channels?.length ? peaks(channels, BUCKETS) : null), [channels]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !duration) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    for (const section of sections) {
      ctx.fillStyle = section.id === selected ? "rgba(120, 170, 255, 0.35)" : section.color ? `${section.color}55` : "rgba(140, 140, 160, 0.2)";
      const x = (section.start / duration) * width;
      ctx.fillRect(x, 0, ((section.end - section.start) / duration) * width, height);
    }
    if (bars) {
      ctx.fillStyle = "rgba(200, 200, 215, 0.8)";
      bars.forEach((peak, i) => {
        const h = Math.max(1, peak * height);
        ctx.fillRect((i / bars.length) * width, (height - h) / 2, Math.max(1, width / bars.length), h);
      });
    }
  }, [bars, duration, sections, selected]);
  return (
    <canvas
      ref={ref}
      width={BUCKETS}
      height={80}
      role="img"
      aria-label="Waveform with section boundaries. Click to place the selected section's edge."
      className="h-20 w-full cursor-crosshair rounded-md bg-well"
      onClick={(e) => {
        if (!duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onPick(((e.clientX - rect.left) / rect.width) * duration);
      }}
    />
  );
}
