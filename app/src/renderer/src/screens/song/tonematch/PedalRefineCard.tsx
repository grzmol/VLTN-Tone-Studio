import { useEffect } from "react";
import { Check, Mic, RotateCcw, SlidersHorizontal, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { isSessionLive as irLive, useIrMatch } from "@/song/tonematch/ir-store";
import { MAX_ROUNDS } from "@/song/tonematch/pedal-refine";
import { isRefineLive, TAKE_S, usePedalRefine } from "@/song/tonematch/pedal-refine-store";
import { useToneMatch } from "@/song/tonematch/store";
import { useDevice, usePedalName } from "@/state/device";
import { Meter } from "./IrMatchCard";
import { Section } from "./parts";

const steps = (d: number) => d.toFixed(1);

/** The takes so far, each with its distance from the song's guitar; the best one is marked. */
function Takes() {
  const history = usePedalRefine((s) => s.history);
  if (!history.length) return null;
  const best = Math.min(...history.map((r) => r.measure.distance));
  return (
    <ol aria-label="Takes so far" className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-silkscreen-2">
      {history.map((r, i) => (
        <li key={i} className={cn(r.measure.distance === best && "font-semibold text-silkscreen")}>
          Take {i + 1}: {steps(r.measure.distance)}
          {r.measure.distance === best && " ✓"}
        </li>
      ))}
    </ol>
  );
}

function InputPicker({ disabled }: { disabled: boolean }) {
  const inputs = usePedalRefine((s) => s.inputs);
  const inputId = usePedalRefine((s) => s.inputId);
  return (
    <label className="flex items-center gap-2 text-[12px] text-silkscreen-2">
      Record from
      <Select value={inputId ?? ""} onValueChange={(v) => void usePedalRefine.getState().selectInput(v)} disabled={disabled}>
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
 * Tune the proposal on the pedal itself: you play a few takes in the song's style, Tone Studio records the pedal's
 * output, compares it with the song's guitar and corrects the amp's Gain and the Guitar EQ after each one.
 */
export function PedalRefineCard() {
  const step = usePedalRefine((s) => s.step);
  const level = usePedalRefine((s) => s.level);
  const seconds = usePedalRefine((s) => s.seconds);
  const notice = usePedalRefine((s) => s.notice);
  const pedal = usePedalName();
  const connected = useDevice((s) => s.status === "connected" && s.preset !== null);
  const auditionBusy = useToneMatch((s) => s.audition.kind === "applying" || s.audition.kind === "restoring");
  const irBusy = useIrMatch((s) => irLive(s.step));

  // Leaving the tab mid-session closes the input; the pedal keeps the settings it has.
  useEffect(
    () => () => {
      if (isRefineLive(usePedalRefine.getState().step)) void usePedalRefine.getState().cancel();
    },
    [],
  );

  return (
    <Section title="Tune it on the pedal">
      <p className="text-[12px] text-pretty text-silkscreen-3">
        The proposal is a starting point worked out from the song. Here it is checked against what the {pedal} really plays: you play up to {MAX_ROUNDS} takes of about {TAKE_S} s in the song's style, Tone Studio
        records the {pedal}'s output, compares it with the song's guitar and corrects the amp's Gain and the five Guitar EQ bands after each take. It keeps the best take, and nothing is written to a slot.
      </p>

      {step.kind === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!connected || auditionBusy || irBusy} onClick={() => void usePedalRefine.getState().open()}>
            <SlidersHorizontal data-icon="inline-start" />
            Tune it on the pedal
          </Button>
          {!connected && <span className="text-[12px] text-silkscreen-3">Connect the {pedal} first; the takes go through it.</span>}
          {connected && irBusy && <span className="text-[12px] text-silkscreen-3">Finish the IR match first.</span>}
        </div>
      )}

      {step.kind === "opening" && (
        <p role="status" className="flex items-center gap-2 text-[12px] text-silkscreen-2">
          <Spinner />
          Putting the proposal on the {pedal} and opening the audio input…
        </p>
      )}

      {step.kind === "ready" && (
        <div className="flex flex-col gap-3">
          <InputPicker disabled={false} />
          <Meter level={level} />
          <Takes />
          {notice && (
            <p role="alert" className="text-[12px] text-pretty text-led-warn">
              {notice}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => usePedalRefine.getState().record()}>
              <Mic data-icon="inline-start" />
              Record take {step.take}
            </Button>
            {step.take > 1 && (
              <Button variant="outline" onClick={() => usePedalRefine.getState().finishNow()}>
                <Check data-icon="inline-start" />
                Use the best take
              </Button>
            )}
            <Button variant="ghost" onClick={() => void usePedalRefine.getState().cancel()}>
              <X data-icon="inline-start" />
              Cancel
            </Button>
          </div>
          <p className="text-[12px] text-pretty text-silkscreen-3">Play the part of the song you matched, the same way each time: it is the sound that is compared, not the notes.</p>
        </div>
      )}

      {step.kind === "recording" && (
        <div className="flex flex-col gap-3">
          <Meter level={level} />
          <Progress value={Math.min(100, (seconds / TAKE_S) * 100)} aria-label={`Take ${step.take} of up to ${MAX_ROUNDS}`} />
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => void usePedalRefine.getState().finishTake()}>
              <Square data-icon="inline-start" />
              Stop and measure
            </Button>
            <span className="text-[12px] tabular-nums text-silkscreen-2" role="status">
              Take {step.take}: {seconds.toFixed(0)} of {TAKE_S} s
            </span>
          </div>
        </div>
      )}

      {step.kind === "done" && (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-[13px] text-pretty">
            {step.best.measure.distance < step.start.measure.distance
              ? `Closer to the song's guitar: ${steps(step.start.measure.distance)} → ${steps(step.best.measure.distance)} steps in ${step.takes} ${step.takes === 1 ? "take" : "takes"} (1 step is about a difference you can hear).`
              : `The proposal as it was is the closest of ${step.takes} ${step.takes === 1 ? "take" : "takes"} (${steps(step.start.measure.distance)} steps), so nothing changed.`}
          </p>
          <Takes />
          <p className="text-[12px] text-pretty text-silkscreen-3">The {pedal} is playing the best settings now. Keep them to put them in the proposal above, then save the preset from the Rig.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => usePedalRefine.getState().keep()}>
              <Check data-icon="inline-start" />
              Keep these settings
            </Button>
            <Button variant="outline" onClick={() => void usePedalRefine.getState().open()}>
              <RotateCcw data-icon="inline-start" />
              Take again
            </Button>
            <Button variant="ghost" onClick={() => void usePedalRefine.getState().cancel()}>
              Leave it
            </Button>
          </div>
        </div>
      )}

      {step.kind === "error" && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-[12px] text-pretty text-led-fault">
            {step.message}
          </p>
          <div>
            <Button variant="outline" onClick={() => void usePedalRefine.getState().open()}>
              <RotateCcw data-icon="inline-start" />
              Try again
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}
