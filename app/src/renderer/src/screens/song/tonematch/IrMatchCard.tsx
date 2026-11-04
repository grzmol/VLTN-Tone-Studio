import { useEffect, useState } from "react";
import { Download, Mic, RotateCcw, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/app/notify";
import { cn } from "@/lib/utils";
import { LocalIrDialog } from "@/screens/tones/T3kDialogs";
import { useSong } from "@/song/store";
import { IR_RATE, IR_TAPS, MATCH_HI_HZ, MATCH_LO_HZ, MAX_CORRECTION_DB, responseDb, type MatchedIr } from "@/song/tonematch/irdesign";
import { isSessionLive, MIN_PLAYING_S, RECORD_S, useIrMatch } from "@/song/tonematch/ir-store";
import { useToneMatch } from "@/song/tonematch/store";
import type { Level } from "@/song/tonematch/recorder";
import { useDevice, usePedalName, useProfile } from "@/state/device";
import type { OpenFile } from "@/state/ui";
import { CurvePlot, type CurveSeries } from "./CurvePlot";
import { Section } from "./parts";

const METER_FLOOR_DB = -60;
const PLOT_POINTS = Array.from({ length: 6 * 9 + 1 }, (_, i) => 40 * 2 ** (i / 6)); // 40 Hz–20 kHz, 1/6 octave

export function Meter({ level }: { level: Level | null }) {
  const pct = (db: number) => Math.max(0, Math.min(100, ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100));
  const rms = level ? pct(level.rmsDb) : 0;
  const peak = level ? pct(level.peakDb) : 0;
  const hot = (level?.peakDb ?? -90) > -1;
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative h-2 flex-1 overflow-hidden rounded-pill bg-muted"
        role="meter"
        aria-label="Input level"
        aria-valuemin={METER_FLOOR_DB}
        aria-valuemax={0}
        aria-valuenow={Math.round(level?.rmsDb ?? METER_FLOOR_DB)}
      >
        <div className={cn("absolute inset-y-0 left-0 transition-[width] duration-100", hot ? "bg-led-fault" : "bg-led-on")} style={{ width: `${rms}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-silkscreen-2" style={{ left: `calc(${peak}% - 1px)` }} />
      </div>
      <span className={cn("w-20 text-right text-[11px] tabular-nums", hot ? "text-led-fault" : "text-silkscreen-3")}>
        {level ? (hot ? "Too loud" : `${level.rmsDb.toFixed(0)} dBFS`) : "No signal"}
      </span>
    </div>
  );
}

function InputPicker({ disabled }: { disabled: boolean }) {
  const inputs = useIrMatch((s) => s.inputs);
  const inputId = useIrMatch((s) => s.inputId);
  return (
    <label className="flex items-center gap-2 text-[12px] text-silkscreen-2">
      Record from
      <Select value={inputId ?? ""} onValueChange={(v) => void useIrMatch.getState().selectInput(v)} disabled={disabled}>
        <SelectTrigger className="h-8 w-72" aria-label="Audio input to record from">
          <SelectValue placeholder="Choose an input" />
        </SelectTrigger>
        <SelectContent>
          {inputs.map((i) => (
            <SelectItem key={i.deviceId} value={i.deviceId}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/**
 * The correction and the IR's response; the IR is peak-normalised in time, so it is levelled at its 200 Hz–4 kHz mean.
 * `against` names what the song was compared with.
 */
export function resultSeries(result: MatchedIr, against = "your recording"): CurveSeries[] {
  const response = PLOT_POINTS.map((f): [number, number] => [f, responseDb(result.ir, f, IR_RATE)]);
  const mid = response.filter(([f]) => f >= 200 && f <= 4000);
  const offset = mid.reduce((a, [, db]) => a + db, 0) / mid.length;
  return [
    { label: `Correction measured (song − ${against})`, points: result.curve.centers.map((f, i): [number, number] => [f, result.curve.db[i]]), className: "stroke-silkscreen-3", dashed: true },
    { label: "Matched IR", points: response.map(([f, db]): [number, number] => [f, db - offset]), className: "stroke-block-cab" },
  ];
}

const irFileName = (song: string | undefined) => `${(song ?? "Song").replace(/\.[^.]+$/, "")} IR.wav`;

function Result({ result, playedS }: { result: MatchedIr; playedS: number }) {
  const songName = useSong((s) => s.source?.name);
  const [sendFile, setSendFile] = useState<OpenFile | null>(null);
  const fileName = irFileName(songName);
  const pedal = usePedalName();
  const kept = useProfile().userIr.samples;

  const save = async () => {
    try {
      const where = await useIrMatch.getState().save(fileName);
      if (where) notifySuccess("Saved the matched IR", where);
    } catch (e) {
      notifyError("Couldn't save the IR", e);
    }
  };
  const send = () => {
    const bytes = useIrMatch.getState().wavBytes();
    if (bytes) setSendFile({ name: fileName, path: null, file: new File([bytes as BlobPart], fileName, { type: "audio/wav" }) });
  };

  return (
    <div className="flex flex-col gap-3">
      <CurvePlot title="Correction between your recording and the song, and the matched IR's response" series={resultSeries(result)} />
      <p className="text-[12px] text-pretty text-silkscreen-3">
        From {playedS.toFixed(0)} s of playing. A {IR_TAPS}-sample minimum-phase IR at 44.1 kHz; the {pedal} keeps its first {kept} samples ({((kept / IR_RATE) * 1000).toFixed(1)} ms), and a minimum-phase IR puts its energy first. It
        follows the song from {MATCH_LO_HZ} Hz to {MATCH_HI_HZ / 1000} kHz (at most ±{MAX_CORRECTION_DB} dB) and rolls off like a cabinet outside that. Write it to a User IR slot,
        then pick that slot in the CAB block.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()}>
          <Download data-icon="inline-start" />
          Save WAV…
        </Button>
        <Button variant="outline" onClick={send}>
          <Send data-icon="inline-start" />
          Write to a User IR slot…
        </Button>
        <Button variant="ghost" onClick={() => void useIrMatch.getState().open()}>
          <RotateCcw data-icon="inline-start" />
          Record again
        </Button>
      </div>
      <LocalIrDialog file={sendFile} onClose={() => setSendFile(null)} />
    </div>
  );
}

export function IrMatchCard() {
  const step = useIrMatch((s) => s.step);
  const level = useIrMatch((s) => s.level);
  const seconds = useIrMatch((s) => s.seconds);
  const connected = useDevice((s) => s.status === "connected" && s.preset !== null);
  const pedal = usePedalName();
  const auditionBusy = useToneMatch((s) => s.audition.kind === "applying" || s.audition.kind === "restoring");
  const live = isSessionLive(step);

  // Leaving the tab mid-session closes the input and puts the CAB block back; a finished IR stays.
  useEffect(
    () => () => {
      if (isSessionLive(useIrMatch.getState().step)) void useIrMatch.getState().cancel();
    },
    [],
  );

  return (
    <Section title="Match the cabinet with an IR">
      <p className="text-[12px] text-pretty text-silkscreen-3">
        The {pedal} is also a USB audio interface. Tone Studio turns its CAB block off, records you playing about {RECORD_S} s in the song's style, compares that with the
        guitar in the song and designs an impulse response (IR) to use in place of the cabinet. Audition the proposed preset first, so the amp is close.
      </p>

      {step.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!connected || auditionBusy} onClick={() => void useIrMatch.getState().open()}>
            <Mic data-icon="inline-start" />
            Start the IR match
          </Button>
          {!connected && <span className="text-[12px] text-silkscreen-3">Connect the {pedal} first; the recording goes through it.</span>}
        </div>
      )}

      {step.kind === "opening" && (
        <p role="status" className="flex items-center gap-2 text-[12px] text-silkscreen-2">
          <Spinner />
          Opening the audio input…
        </p>
      )}

      {(step.kind === "ready" || step.kind === "recording") && (
        <div className="flex flex-col gap-3">
          <InputPicker disabled={step.kind === "recording"} />
          <Meter level={level} />
          {step.kind === "ready" ? (
            <p className="text-[12px] text-pretty text-silkscreen-2">
              The CAB block is off now (it comes back when you finish). Pick the {pedal} as the input, check the meter moves when you play without reaching the top,
              then record the part, or something like it, the way the song plays it.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5" role="status">
              <div className="flex items-center justify-between text-[12px]">
                <b className="font-semibold">Recording: keep playing</b>
                <span className="text-silkscreen-2 tabular-nums">
                  {Math.min(seconds, RECORD_S).toFixed(0)} / {RECORD_S} s
                </span>
              </div>
              <Progress value={(Math.min(seconds, RECORD_S) / RECORD_S) * 100} aria-label="Recording progress" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {step.kind === "ready" ? (
              <Button onClick={() => useIrMatch.getState().record()}>
                <Mic data-icon="inline-start" />
                Record {RECORD_S} s
              </Button>
            ) : (
              <Button variant="outline" disabled={seconds < MIN_PLAYING_S} onClick={() => void useIrMatch.getState().finish()}>
                <Square data-icon="inline-start" />
                Stop and match
              </Button>
            )}
            <Button variant="ghost" onClick={() => void useIrMatch.getState().cancel()}>
              <X data-icon="inline-start" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step.kind === "done" && <Result result={step.result} playedS={step.playedS} />}

      {step.kind === "error" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-[12px] text-pretty text-led-fault">
            {step.message}
          </p>
          <div>
            <Button variant="outline" disabled={!connected || auditionBusy} onClick={() => void useIrMatch.getState().open()}>
              <RotateCcw data-icon="inline-start" />
              Try again
            </Button>
          </div>
        </div>
      )}

      {live && <span className="sr-only" aria-live="polite">{step.kind === "recording" ? "Recording" : ""}</span>}
    </Section>
  );
}
