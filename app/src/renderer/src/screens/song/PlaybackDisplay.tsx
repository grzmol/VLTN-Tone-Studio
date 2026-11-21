import { lrcTime } from "@/song/performance/chart";
import { useClockText, useClockTenths } from "@/song/performance/playback-clock";

/** Current song position. Subscribes to the clock so its parent does not re-render while playing. */
export function ClockText() {
  return <>{useClockText()}</>;
}

/** "position / duration" text for the transport. */
export function ClockOverDuration({ duration, className }: { duration: number; className?: string }) {
  return (
    <span className={className}>
      <ClockText /> / {lrcTime(duration)}
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
