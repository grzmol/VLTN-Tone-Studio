import { lrcTime } from "@/song/performance/chart";
import { useClockText, useClockTenths, usePlaybackClock } from "@/song/performance/playback-clock";
import { clock } from "./format";

/** Current song position. Subscribes to the clock so its parent does not re-render while playing. */
export function ClockText() {
  return <>{useClockText()}</>;
}

/** "m:ss" for the current position, in the places that do not show the chart's bracketed time. */
function ClockSeconds() {
  return <>{clock(usePlaybackClock((s) => Math.floor(s.position)))}</>;
}

/** "position / duration" text for the transport: `[00:12.50] / [05:30.00]`, or `0:12 / 5:30` with `plain`. Stage mode keeps the bracketed form. */
export function ClockOverDuration({ duration, className, plain = false }: { duration: number; className?: string; plain?: boolean }) {
  return (
    <span className={className}>
      {plain ? <ClockSeconds /> : <ClockText />} / {plain ? clock(duration) : lrcTime(duration)}
    </span>
  );
}

/** Seek slider that follows the clock; only this input re-renders during playback. */
export function PositionSlider({
  label,
  duration,
  disabled,
  className,
  onSeek,
}: {
  label: string;
  duration: number;
  disabled?: boolean;
  className?: string;
  onSeek: (seconds: number) => void;
}) {
  const position = useClockTenths();
  return (
    <input
      aria-label={label}
      className={className}
      disabled={disabled}
      type="range"
      min="0"
      max={duration}
      step="0.1"
      value={position}
      onChange={(e) => onSeek(Number(e.target.value))}
    />
  );
}
