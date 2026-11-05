import { FlaskConical, Info, Lock, Zap } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dial } from "@/components/gear";
import { GLOBAL_EQ_INDEX } from "@/gp200/lib/protocol.mjs";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { attachedDevice, pedalName } from "@/state/device-model";
import { GP200_EQ_BANDS, gp200EqSpec } from "@/state/driver/gp200-globals";
import { useNav } from "@/state/nav";

/**
 * Global EQ faceplate (GP-200 family): the pedal's output EQ after every preset, its on/off switch (the globalEq
 * setting) and every section's values, sent as they change. Same layout as Pedal settings.
 */
export function GlobalEqPanel({ offline }: { offline: boolean }) {
  const s = useDevice(
    useShallow((s) => ({
      eq: s.globalEq,
      on: s.globals?.globalEq,
      device: s.device,
      mode: s.mode,
      experimental: s.lockedFeatures.includes("globalEq"),
      attached: attachedDevice(s),
    })),
  );
  // Another model attached: the remembered EQ is not its EQ (the faceplate above shows no values either).
  if (!s.eq || s.attached !== s.device) return null;
  const pedal = pedalName(s.device);
  const locked = offline;
  const disabled = locked || s.experimental;
  const values = s.eq.values;

  /** `name`: the accessible name ("Band 1 frequency") */
  const dial = (index: number, label: string, name: string) => {
    const spec = gp200EqSpec(index);
    return (
      <div className="flex flex-col items-center">
        <Dial
          label={label}
          ariaLabel={name}
          value={values[index]}
          spec={spec}
          size={46}
          disabled={disabled}
          onChange={(v) => useDevice.getState().setGlobalEq(index, v)}
        />
      </div>
    );
  };

  return (
    <section
      aria-label="Global EQ"
      className="relative grid grid-cols-1 min-[1100px]:grid-cols-[220px_minmax(0,1fr)] items-start gap-y-4 overflow-hidden rounded-xl bg-faceplate px-7 py-6 shadow-[inset_0_0_0_1px_var(--seam)] min-[1360px]:grid-cols-[280px_minmax(0,1fr)_236px]"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="mb-1.5 text-xl leading-[1.1] font-bold tracking-[-0.01em] text-balance">Global EQ</h2>
          <p className="max-w-[240px] text-sm text-pretty text-silkscreen-3">Shapes everything the {pedal} plays, after every preset. The USB recording doesn't get it.</p>
        </div>
        <div className="flex items-center gap-2.5 text-sm font-[550] text-silkscreen-2">
          <Switch
            checked={s.on === 1}
            disabled={locked || s.on === undefined}
            onCheckedChange={(v) => useDevice.getState().setGlobal("globalEq", v ? 1 : 0)}
            aria-label="Global EQ on"
          />
          {s.on === 1 ? "On" : "Off"}
        </div>
      </div>

      <div className={cn("flex min-w-0 flex-wrap justify-around gap-x-4 gap-y-5 px-0 min-[1100px]:border-l min-[1100px]:px-4 min-[1360px]:border-r", offline && "opacity-45")}>
        {GP200_EQ_BANDS.map((b) => (
          <div key={b.label} role="group" aria-label={b.label} className="flex w-[84px] flex-col items-center gap-2.5">
            <h3 className="text-sm font-[550] whitespace-nowrap text-silkscreen-2">{b.label}</h3>
            <Switch size="sm" checked={values[b.en] >= 0.5} disabled={disabled} onCheckedChange={(v) => useDevice.getState().setGlobalEq(b.en, v ? 1 : 0)} aria-label={`${b.label} on`} />
            {dial(b.freq, "Freq", `${b.label} frequency`)}
            {b.q !== undefined && dial(b.q, "Q", `${b.label} Q`)}
            {b.gain !== undefined && dial(b.gain, "Gain", `${b.label} gain`)}
          </div>
        ))}
        <div role="group" aria-label="Level" className="flex w-[84px] flex-col items-center gap-2.5">
          <h3 className="text-sm font-[550] text-silkscreen-2">Level</h3>
          {dial(GLOBAL_EQ_INDEX.level, "Level", "Global EQ level")}
        </div>
      </div>

      <div className="col-span-full flex flex-row flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3.5 text-sm min-[1360px]:col-span-1 min-[1360px]:flex-col min-[1360px]:items-start min-[1360px]:gap-2 min-[1360px]:border-t-0 min-[1360px]:pt-0 min-[1360px]:pl-6">
        {offline ? (
          <span className="flex items-center gap-1.5 font-[550] text-silkscreen-2 opacity-45">
            <Lock className="size-3.5" aria-hidden />
            Read-only until connected
          </span>
        ) : s.experimental ? (
          <>
            <span className="flex items-center gap-1.5 font-[550] text-silkscreen-2">
              <FlaskConical className="size-3.5" aria-hidden />
              Experimental
            </span>
            <span className="text-xs text-pretty text-silkscreen-3">Tone Studio knows this command from Valeton's editor only. Turn on Experimental pedal commands to use it.</span>
            <Button variant="outline" size="sm" onClick={() => useNav.getState().go("device", "settings")}>
              Open Settings
            </Button>
          </>
        ) : (
          <span className="flex items-center gap-1.5 font-[550] text-silkscreen-2">
            <Zap className="size-3.5" aria-hidden />
            Changes apply immediately
          </span>
        )}
        {!s.eq.read && (
          <span className="flex gap-1.5 text-xs text-pretty text-silkscreen-3">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            The {pedal} hasn't reported its Global EQ, so the controls start at the factory settings.
          </span>
        )}
        <span className="text-xs text-pretty text-silkscreen-3">Boosts raise the level of every output: turn them up gently.</span>
      </div>
    </section>
  );
}
