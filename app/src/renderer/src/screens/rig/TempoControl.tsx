import { useEffect, useId, useRef, useState } from "react";
import { MinusIcon, PlusIcon, TimerIcon } from "lucide-react";
import { notifyError, notifySuccess } from "@/app/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useDevice, usePedalName } from "@/state/device";
import { editBpm } from "./edits";
import { saveOnlyNote, useLiveMode } from "./live-edits";
import { loadVolume, Metronome } from "./metronome";
import { tap } from "./tempo";

/** Where a tempo edit goes: live where the pedal has a tempo command (GP-50 with Experimental pedal commands, GP-200), else with the save. */
function useTempoNote(): string {
  const pedal = usePedalName();
  const mode = useLiveMode("liveBpm");
  return mode === "live" ? `Plays on the ${pedal} right away. Save the preset to keep it.` : saveOnlyNote(mode, "The new tempo", pedal);
}

/** Rig header tempo: the preset's BPM with a field and a tap button; taps are averaged in the app. `range`: the model's. */
export function TempoControl({ bpm, range, disabled }: { bpm: number; range: { min: number; max: number }; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(bpm));
  const taps = useRef<number[]>([]);
  const inputId = useId();
  const note = useTempoNote();

  useEffect(() => setDraft(String(bpm)), [bpm]);

  // The click reads the tempo from the store on every beat, so editing it while it runs is heard on the next beat.
  const metronome = useRef<Metronome | null>(null);
  const [clicking, setClicking] = useState(false);
  useEffect(() => () => metronome.current?.stop(), []);
  const clickTrack = () => (metronome.current ??= new Metronome(() => useDevice.getState().preset?.bpm ?? bpm));
  const [volume, setVolume] = useState(loadVolume);
  const toggleClick = async () => {
    const m = clickTrack();
    if (m.running) {
      m.stop();
      return setClicking(false);
    }
    try {
      const output = await m.start();
      setClicking(true);
      notifySuccess("Metronome on", `Playing through ${output}.`);
    } catch (e) {
      setClicking(false);
      notifyError("Couldn't start the metronome", e);
    }
  };

  const commit = (text: string) => {
    const n = Number(text.trim());
    if (text.trim() && Number.isFinite(n)) editBpm(n);
    setDraft(String(useDevice.getState().preset?.bpm ?? bpm));
  };

  const onTap = () => {
    const next = tap(taps.current, performance.now(), range);
    taps.current = next.taps;
    if (next.bpm !== null) editBpm(next.bpm);
  };

  return (
    <span className="flex items-center gap-1.5">
      Tempo
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs" disabled={disabled} aria-label={`Tempo ${bpm} BPM, change`} className="-mx-1 px-1.5 text-sm font-semibold text-silkscreen tabular-nums">
            {bpm} BPM
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-[260px] flex-col gap-3">
          <label htmlFor={inputId} className="text-sm font-[550] text-silkscreen-2">
            Tempo ({range.min}–{range.max} BPM)
          </label>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" aria-label="Slower" onClick={() => editBpm(bpm - 1)} disabled={bpm <= range.min}>
              <MinusIcon aria-hidden />
            </Button>
            <Input
              id={inputId}
              inputMode="numeric"
              className="h-8 w-20 text-center tabular-nums"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit(e.currentTarget.value);
                else if (e.key === "Escape") setDraft(String(bpm));
              }}
            />
            <Button variant="outline" size="icon-sm" aria-label="Faster" onClick={() => editBpm(bpm + 1)} disabled={bpm >= range.max}>
              <PlusIcon aria-hidden />
            </Button>
          </div>
          <p className="text-xs text-pretty text-silkscreen-3">{note}</p>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="xs" disabled={disabled} onClick={onTap} aria-label="Tap tempo" title="Tap in time: the tempo follows the last few taps">
        Tap
      </Button>
      <Button variant={clicking ? "default" : "outline"} size="icon-xs" aria-label="Metronome" aria-pressed={clicking} onClick={() => void toggleClick()} title="Click track at this tempo, played through the pedal's USB audio when it is connected">
        <TimerIcon aria-hidden />
      </Button>
      <Slider
        className="w-20"
        aria-label="Metronome volume"
        title={`Metronome volume ${Math.round(volume * 100)}%`}
        min={0}
        max={100}
        step={1}
        value={[Math.round(volume * 100)]}
        onValueChange={([v]) => {
          setVolume(v / 100);
          clickTrack().setVolume(v / 100);
        }}
      />
    </span>
  );
}
