import { ChevronDown, List, Lock, Zap } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dial } from "@/components/gear";
import { cn } from "@/lib/utils";
import { useDevice } from "@/state/device";
import { attachedDevice, globalSpecsFor, pedalName } from "@/state/device-model";
import type { GlobalRecord, Globals, SettingSpec } from "@/state/device-types";
import { controlKind, isNamedRecord, rangeCaption, settingsGroups } from "./pedal-settings";

/**
 * Pedal settings faceplate: globals stored on the pedal, outside every preset, as the connected (or last connected)
 * model's settings table grouped like its menu. Same layout as the Rig faceplate.
 */
export function PedalSettings({ offline }: { offline: boolean }) {
  const { device, remembered, firmware } = useDevice(useShallow((s) => ({ device: s.device, remembered: s.globals, firmware: s.firmware })));
  // Another model is attached (being connected, or on USB): the remembered values are not its settings.
  const attached = useDevice((s) => attachedDevice(s));
  const globals = attached === device ? remembered : null;
  const pedal = pedalName(attached);
  const live = !offline;
  const groups = settingsGroups(device, globals, firmware);
  const cabSim = globalSpecsFor(device).find((g) => g.name === "cabSimBypass");

  return (
    <section
      aria-label="Pedal settings"
      className="relative grid grid-cols-1 min-[1100px]:grid-cols-[220px_minmax(0,1fr)] items-start gap-y-4 overflow-hidden rounded-xl bg-faceplate px-7 py-6 shadow-[inset_0_0_0_1px_var(--seam)] min-[1360px]:grid-cols-[280px_minmax(0,1fr)_236px]"
    >
      <div className="min-w-0">
        <h2 className="mb-1.5 text-xl leading-[1.1] font-bold tracking-[-0.01em] text-balance">Pedal settings</h2>
        <p className="max-w-[240px] text-sm text-pretty text-silkscreen-3">Global: stored on the {pedal} and shared by every preset. Saving a preset doesn't change them.</p>
      </div>

      {globals ? (
        <div
          className={cn("flex min-w-0 flex-wrap justify-start gap-x-8 min-[1360px]:justify-around gap-y-5 px-0 min-[1100px]:border-l min-[1100px]:px-4 min-[1360px]:border-r", offline && "pointer-events-none opacity-45")}
          aria-disabled={offline || undefined}
        >
          {groups.map(({ group, title, items }) => (
            <div key={group} role="group" aria-label={title} className="flex min-w-0 flex-col gap-2.5">
              <h3 className="text-sm font-[550] text-silkscreen-2">{title}</h3>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-4">
                {items.map((spec) => (
                  <SettingControl key={spec.name} spec={spec} globals={globals} disabled={!live || globals[spec.name] === undefined} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[132px] items-center justify-center px-6 text-center text-silkscreen-3 min-[1100px]:border-l min-[1360px]:border-r">
          Connect the pedal to read its settings.
        </div>
      )}

      <div className="col-span-full flex flex-row flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3.5 text-sm min-[1360px]:col-span-1 min-[1360px]:flex-col min-[1360px]:items-start min-[1360px]:gap-2 min-[1360px]:border-t-0 min-[1360px]:pt-0 min-[1360px]:pl-6">
        {live ? (
          <span className="flex items-center gap-1.5 font-[550] text-silkscreen-2">
            <Zap className="size-3.5" aria-hidden />
            Changes apply immediately
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-[550] text-silkscreen-2 opacity-45">
            <Lock className="size-3.5" aria-hidden />
            Read-only until connected
          </span>
        )}
        <span className="text-xs text-pretty text-silkscreen-3">
          Every change is sent to the pedal as you make it. There is nothing to save.
        </span>
        {cabSim && <span className="text-xs text-pretty text-silkscreen-3">{cabSim.label}: turn it on when the pedal feeds a real guitar cabinet.</span>}
      </div>
    </section>
  );
}

/** One setting: a dial for numbers, an on/off dial for Off/On, a list for other choices. */
function SettingControl({ spec, globals, disabled }: { spec: SettingSpec; globals: Globals; disabled: boolean }) {
  const value = globals[spec.name];
  const set = (v: number) => useDevice.getState().setGlobal(spec.name, v);
  switch (controlKind(spec)) {
    case "dial":
      return (
        <div className="flex min-w-[92px] flex-col items-center">
          <Dial
            label={spec.label}
            value={value ?? spec.min}
            spec={{ min: spec.min, max: spec.max, step: 1, unit: spec.unit }}
            size={64}
            disabled={disabled}
            onChange={set}
            className="[&>span:first-child]:whitespace-nowrap"
          />
          <span className="mt-0.5 text-center text-xs text-silkscreen-4">{rangeCaption(spec)}</span>
        </div>
      );
    case "toggle":
      return (
        <div className="flex min-w-[92px] flex-col items-center">
          <ToggleDial label={spec.label} on={value === spec.max} disabled={disabled} onChange={(on) => set(on ? spec.max : spec.min)} />
          <span className="mt-0.5 text-center text-xs text-silkscreen-4">On or off</span>
        </div>
      );
    case "select":
      return (
        <div className="flex w-[168px] flex-col gap-1.5">
          <span className="text-xs font-medium tracking-wide whitespace-nowrap text-silkscreen-3 uppercase">{spec.label}</span>
          <Select value={value === undefined ? "" : String(value)} onValueChange={(v) => set(Number(v))} disabled={disabled}>
            <SelectTrigger className="h-8 w-full" aria-label={spec.label}>
              <SelectValue placeholder="Not reported" />
            </SelectTrigger>
            <SelectContent>
              {(spec.labels ?? []).map((label, i) => (
                <SelectItem key={label} value={String(spec.min + i)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
  }
}

/** On/off dial (cab sim bypass): the knob sits at min or max; Space or Enter toggles. */
function ToggleDial({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const size = 64;
  const c = size / 2;
  const r = c - 5;
  const a0 = -225;
  const sweep = 270;
  const end = a0 + (on ? sweep : 0);
  const pt = (deg: number, rad: number) => [c + rad * Math.cos((deg * Math.PI) / 180), c + rad * Math.sin((deg * Math.PI) / 180)];
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from, r);
    const [x1, y1] = pt(to, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const inner = r - 9;
  const [px, py] = pt(end, inner - 1);
  const [qx, qy] = pt(end, inner - 7);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="group flex flex-col items-center gap-1.5 rounded-lg bg-transparent p-0 disabled:cursor-not-allowed"
    >
      <span className="text-xs font-medium tracking-wide whitespace-nowrap text-silkscreen-3 uppercase group-focus-visible:text-silkscreen">{label}</span>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="block">
        <path d={arc(a0, a0 + sweep)} fill="none" stroke="#2a2a2d" strokeWidth={3} strokeLinecap="round" />
        {on && <path d={arc(a0, end)} fill="none" stroke="var(--silkscreen-2)" strokeWidth={3} strokeLinecap="round" />}
        <circle cx={c} cy={c} r={inner} fill="#1c1c1e" stroke="#333336" strokeWidth={1} />
        <line x1={qx.toFixed(2)} y1={qy.toFixed(2)} x2={px.toFixed(2)} y2={py.toFixed(2)} stroke="var(--silkscreen)" strokeWidth={2} strokeLinecap="round" />
      </svg>
      <span className="text-sm font-semibold text-silkscreen">{on ? "On" : "Off"}</span>
    </button>
  );
}

const rawBytes = (r: GlobalRecord) => {
  const out: string[] = [];
  let v = r.value < 0 ? r.value + 2 ** (8 * r.len) : r.value;
  for (let i = 0; i < r.len; i++) {
    out.push((v % 256).toString(16).toUpperCase().padStart(2, "0"));
    v = Math.floor(v / 256);
  }
  return out.join(" ");
};

/** Read-only list of the 0x10 records the toolkit can't name. The app never writes unknown records. */
export function RawRecords() {
  const records = useDevice(
    useShallow((s) => s.globalRecords?.filter((r) => !isNamedRecord(s.device, r.a, r.b)) ?? null),
  );
  if (!records?.length) return null;
  return (
    <Collapsible className="group/adv rounded-lg shadow-[inset_0_0_0_1px_var(--seam)]">
      <CollapsibleTrigger className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-[550] text-silkscreen-2 hover:text-silkscreen">
        <List className="size-3.5" aria-hidden />
        Advanced: {records.length} more global {records.length === 1 ? "record" : "records"} the app can't name yet, shown read-only
        <ChevronDown className="ml-auto size-3.5 text-silkscreen-3 transition-transform group-data-[state=open]/adv:rotate-180 motion-reduce:transition-none" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pt-1 pb-3">
        <Table className="text-sm">
          <TableHeader>
            <TableRow>
              {["Record", "Size", "Value", "Raw bytes", "Notes"].map((h) => (
                <TableHead key={h} className="text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase">
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={`${r.a}.${r.b}`}>
                <TableCell className="font-semibold text-silkscreen">
                  {r.a}.{r.b}
                </TableCell>
                <TableCell className="text-silkscreen-2">
                  {r.len} {r.len === 1 ? "byte" : "bytes"}
                </TableCell>
                <TableCell className="text-silkscreen-2">{r.value}</TableCell>
                <TableCell className="text-silkscreen-2">{rawBytes(r)}</TableCell>
                <TableCell className="text-silkscreen-3">Unknown</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}
