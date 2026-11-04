import { useEffect, useRef, useState, type SVGProps } from "react";
import { notifyError } from "@/app/notify";
import { Switch } from "@/components/ui/switch";
import { useDevice } from "@/state/device";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isPedalInput, listInputs, type AudioInput } from "@/song/tonematch/recorder";
import { detectPitch, noteOf, type Note } from "./tuner";

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
  const connected = useDevice((s) => s.status === "connected");
  const canMute = useDevice((s) => s.status === "connected" && s.features.includes("tuner"));
  const [muted, setMuted] = useState(false);
  const mutedNow = useRef(false);

  const mute = async (on: boolean) => {
    try {
      await useDevice.getState().setTuner(on);
      mutedNow.current = on;
      setMuted(on);
    } catch (e) {
      notifyError(on ? "Couldn't mute the pedal" : "Couldn't unmute the pedal", e);
    }
  };

  // Closing the tuner (this unmounts) always takes the pedal out of its tuner mode, so it never stays muted.
  useEffect(
    () => () => {
      if (mutedNow.current) void useDevice.getState().setTuner(false).catch(() => {});
    },
    [],
  );

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
            <span className="block text-xs text-silkscreen-3">Puts the pedal in tuner mode, so nothing plays while you tune.</span>
          </span>
          <Switch checked={muted} onCheckedChange={(on) => void mute(on)} aria-label="Mute the pedal while tuning" />
        </label>
      )}
      {connected && !canMute && (
        <p className="text-xs text-pretty text-silkscreen-3">Tone Studio can't switch this pedal's own tuner on yet. To mute it while you tune, use the tuner on the pedal.</p>
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
