import { useEffect, useRef, useState, type SVGProps } from "react";
import { Switch } from "@/components/ui/switch";
import { useDevice } from "@/state/device";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isPedalInput, listInputs, type AudioInput } from "@/song/tonematch/recorder";
import { detectPitch, noteOf, type Note } from "./tuner-pitch";

/** A tuning fork, drawn like the lucide icons (the set has none). */
function TuningForkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 3v7a4 4 0 0 0 8 0V3" />
      <path d="M12 14v7" />
    </svg>
  );
}

/** In tune within this many cents. */
const IN_TUNE = 5;
/** Show the last note this long after the string stops, so the needle doesn't flicker between plucks. */
const HOLD_MS = 600;

/** Rig header button + dialog: a chromatic tuner on an audio input (the pedal's USB audio, or any interface). */
export function Tuner() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" aria-label="Tuner" onClick={() => setOpen(true)} className="max-[1320px]:w-[34px] max-[1320px]:px-0">
            <TuningForkIcon aria-hidden />
            <span className="max-[1320px]:hidden">Tuner</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="min-[1321px]:hidden">Tuner</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Tuner</DialogTitle>
            <DialogDescription>Plays nothing; listens to the input you pick and shows the note.</DialogDescription>
          </DialogHeader>
          {open && <TunerBody />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TunerBody() {
  const [inputs, setInputs] = useState<AudioInput[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [note, setNote] = useState<(Note & { hz: number }) | null>(null);
  const [error, setError] = useState("");
  const canMute = useDevice((s) => s.status === "connected" && s.preset !== null && s.busy === null);
  const [muted, setMuted] = useState(false);
  // Mute sets the preset's Out volume to 0 and remembers the value for this slot, so it works on every model.
  const before = useRef<{ slot: number; volume: number } | null>(null);

  const unmute = () => {
    const was = before.current;
    before.current = null;
    // a different preset is active now (it has its own volume): nothing to put back
    if (was && useDevice.getState().slot === was.slot) useDevice.getState().setVolume(was.volume);
  };

  const mute = (on: boolean) => {
    const d = useDevice.getState();
    if (on && d.preset && d.slot !== null) {
      before.current = { slot: d.slot, volume: d.preset.volume };
      d.setVolume(0);
    } else unmute();
    setMuted(on && before.current !== null);
  };

  // Closing the tuner (this unmounts) always puts the volume back.
  useEffect(() => unmute, []);

  useEffect(() => {
    listInputs().then(
      (list) => {
        setInputs(list);
        setDeviceId((list.find((i) => isPedalInput(i.label)) ?? list[0])?.deviceId ?? null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    if (deviceId === null) return;
    let stop = () => {};
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        let seen = 0;
        const timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          const hz = detectPitch(buf, ctx.sampleRate);
          if (hz) {
            seen = performance.now();
            setNote({ ...noteOf(hz), hz });
          } else if (performance.now() - seen > HOLD_MS) setNote(null);
        }, 60);
        stop = () => {
          window.clearInterval(timer);
          for (const t of stream.getTracks()) t.stop();
          void ctx.close();
        };
        if (cancelled) stop();
        setError("");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [deviceId]);

  const inTune = note !== null && Math.abs(note.cents) <= IN_TUNE;
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex h-24 flex-col items-center justify-center" aria-live="polite">
        <span className={cn("text-6xl font-bold tabular-nums", note ? (inTune ? "text-led-ok" : "text-silkscreen") : "text-silkscreen-4")}>{note?.name ?? "–"}</span>
        <span className="text-sm text-silkscreen-3 tabular-nums">{note ? `${note.hz.toFixed(1)} Hz` : "Play a string"}</span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-faceplate-raised" role="meter" aria-label="Cents off" aria-valuemin={-50} aria-valuemax={50} aria-valuenow={note?.cents ?? 0}>
        <span className="absolute top-[-4px] left-1/2 h-4 w-px bg-silkscreen-3" aria-hidden />
        {note && <span className={cn("absolute top-[-3px] size-3.5 -translate-x-1/2 rounded-full", inTune ? "bg-led-ok" : "bg-led-warn")} style={{ left: `${50 + note.cents}%` }} />}
      </div>
      <span className="text-sm text-silkscreen-2 tabular-nums">{note ? (inTune ? "In tune" : `${note.cents > 0 ? "+" : ""}${note.cents} cents, ${note.cents > 0 ? "too high" : "too low"}`) : ""}</span>
      {canMute && (
        <label className="flex w-full items-center justify-between gap-3 text-sm text-silkscreen-2">
          <span>
            Mute the pedal
            <span className="block text-xs text-silkscreen-3">Sets Out to 0 while you tune and puts it back when you close the tuner.</span>
          </span>
          <Switch checked={muted} onCheckedChange={mute} aria-label="Mute the pedal while tuning" />
        </label>
      )}
      {error ? (
        <p className="text-sm text-led-fault">{error}</p>
      ) : (
        <select
          aria-label="Audio input"
          className="h-8 w-full rounded-md border border-border bg-faceplate px-2 text-sm"
          value={deviceId ?? ""}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          {inputs.length === 0 && <option value="">No audio input found</option>}
          {inputs.map((i) => (
            <option key={i.deviceId} value={i.deviceId}>
              {i.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
