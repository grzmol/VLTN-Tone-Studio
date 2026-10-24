import { useMemo } from 'react';
import { useDevice } from '@/state/device';
import { parsePrst, blocksOfMask } from '@/gp150/lib/prst.mjs';
import { BLOCKS } from '@/gp150/lib/protocol.mjs';
import { gp150ModelByFxid } from '@/gp150/app/catalog-adapter';

/** Inspect the last-read preset bytes and hardware assignments. */
export function Gp180Inspection() {
  const preset = useDevice(s => s.preset);
  const status = useDevice(s => s.status);
  const mode = useDevice(s => s.mode);
  const device = useDevice(s => s.device);

  const parsedPatch = useMemo(() => {
    if (preset?.device !== 'gp180') return null;
    try { return parsePrst(preset.prst); } catch { return null; }
  }, [preset]);

  const isRealGp180 = device === 'gp180';
  if (!isRealGp180) return null;

  const targetName = (target: number) => BLOCKS[target] ?? `Special target ${target}`;
  const parameterName = (target: number, param: number) => {
    if (!parsedPatch) return `Parameter ${param}`;
    const block = parsedPatch.blocks[target];
    if (!block) return `Parameter ${param}`;
    const model = gp150ModelByFxid(block.fxid, target);
    return model?.params.find(p => p.index === param)?.name ?? `Parameter ${param}`;
  };

  return (
    <section aria-label="GP-180 preset inspection" className="rounded-xl bg-faceplate p-6">
      <h2 className="text-xl font-bold">GP-180 preset inspection</h2>

      {parsedPatch && (
        <>
          <p className="mt-3 text-sm text-silkscreen-3">
            {mode === 'mock' ? 'Simulated data' : status === 'connected' ? 'Read from the connected pedal' : 'Last read; pedal disconnected'}
            {' '}· Preset {String(parsedPatch.slot + 1).padStart(3, '0')} · {parsedPatch.tempo} BPM
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-semibold">Knobs 1–3</h3>
              <ul className="mt-2 space-y-1 text-sm">{parsedPatch.knobs.map((k, i) => <li key={i}>Knob {i + 1}: {targetName(k.target)} / {parameterName(k.target, k.param)}</li>)}</ul>
              <p className="mt-2 text-xs text-silkscreen-3">Special target IDs are shown as reported; their meaning has not been verified.</p>
              <h3 className="mt-4 font-semibold">Footswitch assignments</h3>
              <ul className="mt-2 space-y-1 text-sm">{parsedPatch.footswitches.map((mask, i) => <li key={i}>{['A', 'B', 'C'][i] ?? i + 1}: {blocksOfMask(mask).map(k => BLOCKS[k]).join(', ') || 'No effect blocks assigned'}</li>)}</ul>
            </div>
            <div className="overflow-x-auto">
              <h3 className="font-semibold">Expression records · target {targetName(parsedPatch.exp.target)}</h3>
              <p className="mt-1 text-xs text-silkscreen-3">Raw records retained by the preset. Flags and unassigned parameter codes are shown without inferring their function.</p>
              <table className="mt-2 w-full text-left text-sm">
                <thead><tr>{['Entry', 'Parameter ID', 'Min', 'Max', 'Flag'].map(h => <th key={h} className="pr-3 pb-1">{h}</th>)}</tr></thead>
                <tbody>{parsedPatch.exp.entries.map((e, i) => <tr key={i}><td>{i + 1}</td><td>{e.param === 0xffff ? 'Unassigned (65535)' : e.param}</td><td>{e.min}</td><td>{e.max}</td><td>{e.flag}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
