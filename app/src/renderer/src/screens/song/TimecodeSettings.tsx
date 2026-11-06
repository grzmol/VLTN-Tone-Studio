import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import type { PerformanceSession } from "@/song/performance/session";
import { parseOffset, TIMECODE_RATES, type TimecodeRate } from "@/song/performance/timecode";
import { HelpNote } from "@/components/ui/help-note";

const field = "rounded border border-seam bg-transparent p-2";

/**
 * MIDI timecode: on or off, the frame rate (saved with the MIDI setup), and the song's own offset (saved with the song). Timecode and
 * app MIDI clock are exclusive, so turning timecode on turns the clock off.
 */
export function TimecodeSettings({
  session,
  offset,
  onOffset,
  bluetooth,
}: {
  session: PerformanceSession;
  offset: string;
  onOffset: (value: string) => void;
  bluetooth: boolean;
}) {
  const timecode = useMidiConfiguration((s) => s.timecode);
  const update = useMidiConfiguration((s) => s.update);
  const parsed = parseOffset(offset || "00:00:00:00", timecode.fps);
  return (
    <div className="w-full space-y-2 rounded border border-seam p-3 text-sm" aria-label="MIDI timecode">
      <label>
        <input
          type="checkbox"
          aria-label="Send MIDI timecode"
          checked={timecode.enabled}
          onChange={(e) => {
            session.pause();
            if (e.target.checked) session.setClock(false);
            update({ timecode: { ...timecode, enabled: e.target.checked } });
          }}
        />{" "}
        Send MIDI timecode (quarter frames)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Frame rate{" "}
          <select
            aria-label="Timecode frame rate"
            className={field}
            value={timecode.fps}
            onChange={(e) => {
              session.pause();
              update({ timecode: { ...timecode, fps: Number(e.target.value) as TimecodeRate } });
            }}
          >
            {TIMECODE_RATES.map((fps) => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </label>
        <label>
          This song’s offset (HH:MM:SS:FF){" "}
          <input
            aria-label="Song timecode offset"
            className={field + " w-36 font-mono"}
            value={offset}
            placeholder="00:00:00:00"
            onChange={(e) => onOffset(e.target.value)}
          />
        </label>
      </div>
      {"error" in parsed && offset.trim() && (
        <p role="alert" className="text-silkscreen-3">
          {parsed.error}
        </p>
      )}
      <HelpNote>
        <p>
          Timecode follows song time. A full frame goes out at start, seek, jumps, loops and speed changes, then quarter frames. Nothing is sent during the
          count-in. Timecode replaces app MIDI clock. 29.97 drop-frame is not offered.
          {bluetooth ? " Bluetooth is not recommended for timecode: use USB." : ""}
        </p>
      </HelpNote>
    </div>
  );
}
