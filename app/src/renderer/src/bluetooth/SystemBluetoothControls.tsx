import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { host } from "@/host";

/** macOS owns the radio connection; the app selects its resulting system MIDI port. */
export function SystemBluetoothControls({
  locked = false,
  onOpening,
  onReady,
}: {
  locked?: boolean;
  onOpening?: () => void;
  onReady?: () => Promise<unknown> | void;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requesting = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (requesting.current) void host.bluetoothMidi?.cancelSetup().catch(() => {});
    };
  }, []);
  const open = async () => {
    if (opening || locked || !host.bluetoothMidi) return;
    onOpening?.();
    requesting.current = true;
    setOpening(true);
    setError("");
    try {
      await host.bluetoothMidi.openSetup();
      if (alive.current) await onReady?.();
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      requesting.current = false;
      if (alive.current) setOpening(false);
    }
  };
  return (
    <div className="flex max-w-xl flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={opening || locked} onClick={() => void open()}>
          Open macOS MIDI setup
        </Button>
        {opening && (
          <Button variant="outline" onClick={() => void host.bluetoothMidi?.cancelSetup().catch((error) => setError(String(error)))}>
            Cancel Bluetooth setup
          </Button>
        )}
      </div>
      {opening && <p role="status">Opening macOS MIDI setup. Playback stays stopped.</p>}
      <p>
        In Audio MIDI Setup, choose Window → Show MIDI Studio, then MIDI Studio → Open Bluetooth Configuration. Connect your pedal there. Return here, choose
        its MIDI output and enable Send cues. Reconnection never resumes playback.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
