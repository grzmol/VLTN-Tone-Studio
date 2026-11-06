import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENERGIES, STYLE_IDS, STYLES, type StyleId } from "@/song/band/styles";
import { BASS_PART_CHOICES, type BassPartChoice } from "@/song/band/bass-parts";
import type { SectionOverride, SectionPlan } from "@/song/band/arrangement";
import { BandSectionMore } from "./BandSectionMore";
import { BASS_PART_LABELS } from "./band-labels";

export interface BandSectionRow {
  plan: SectionPlan;
  name: string;
  /** The bass part the section chose in its override: "auto" when it has none. */
  choice: BassPartChoice;
}

/** The levels a number select offers: energy, busy and loud all run from 1 to 5. */
const LEVEL_OPTIONS = ENERGIES.map(String);

/**
 * One row per section plan: name, style, energy, the fill at its end, whether drums and bass play in it, then the bass part, busy and
 * loud, and a More popover for the rest of the bass options. A song without sections has one row, and it is edited the same way. The
 * table scrolls inside its own container, so the dialog never widens.
 */
export function BandSections({
  rows,
  disabled,
  selected,
  onSelect,
  onChange,
}: {
  rows: readonly BandSectionRow[];
  disabled: boolean;
  /** The index of the row that previews start from, or null to start from the playhead. */
  selected: number | null;
  onSelect(index: number | null): void;
  onChange(sectionId: string | null, patch: SectionOverride): void;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="text-silkscreen-3">
            <tr>
              <th className="py-1 pr-2 font-normal">Section</th>
              <th className="py-1 pr-2 font-normal">Style</th>
              <th className="py-1 pr-2 font-normal">Energy</th>
              <th className="py-1 pr-2 font-normal">Fill</th>
              <th className="py-1 pr-2 font-normal">Drums</th>
              <th className="py-1 pr-2 font-normal">Bass</th>
              <th className="py-1 pr-2 font-normal">Bass part</th>
              <th className="py-1 pr-2 font-normal">Busy</th>
              <th className="py-1 pr-2 font-normal">Loud</th>
              <th className="py-1 pr-2 font-normal">More</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plan, name, choice }, index) => {
              return (
                <tr key={plan.sectionId ?? "whole"} className="border-t border-seam">
                  <td className="py-1.5 pr-2">
                    <button
                      type="button"
                      aria-pressed={selected === index}
                      disabled={disabled}
                      onClick={() => onSelect(selected === index ? null : index)}
                      className={`rounded px-1 text-left ${selected === index ? "text-led-on" : ""}`}
                    >
                      {name}
                    </button>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select value={plan.style} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { style: value as StyleId })}>
                      <SelectTrigger size="sm" aria-label={`Style of ${name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLE_IDS.map((id) => (
                          <SelectItem key={id} value={id}>
                            {STYLES[id].name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={String(plan.energy)}
                      disabled={disabled}
                      onValueChange={(value) => onChange(plan.sectionId, { energy: Number(value) as SectionPlan["energy"] })}
                    >
                      <SelectTrigger size="sm" aria-label={`Energy of ${name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEVEL_OPTIONS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Checkbox
                      aria-label={`Fill at the end of ${name}`}
                      disabled={disabled}
                      checked={plan.fill}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { fill: checked === true })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Checkbox
                      aria-label={`Drums in ${name}`}
                      disabled={disabled}
                      checked={plan.play.drums}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, drums: checked === true } })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Checkbox
                      aria-label={`Bass in ${name}`}
                      disabled={disabled}
                      checked={plan.play.bass}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, bass: checked === true } })}
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-2">
                      <Select value={choice} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { bassPart: value as BassPartChoice })}>
                        <SelectTrigger size="sm" aria-label={`Bass part of ${name}`} className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BASS_PART_CHOICES.map((part) => (
                            <SelectItem key={part} value={part}>
                              {BASS_PART_LABELS[part]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {choice === "auto" && <span className="whitespace-nowrap text-xs text-silkscreen-3">Auto · {BASS_PART_LABELS[plan.bassPart]}</span>}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={String(plan.busy)}
                      disabled={disabled}
                      onValueChange={(value) => onChange(plan.sectionId, { busy: Number(value) as SectionPlan["busy"] })}
                    >
                      <SelectTrigger size="sm" aria-label={`Busy of ${name}`} className="w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEVEL_OPTIONS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <Select
                      value={String(plan.loud)}
                      disabled={disabled}
                      onValueChange={(value) => onChange(plan.sectionId, { loud: Number(value) as SectionPlan["loud"] })}
                    >
                      <SelectTrigger size="sm" aria-label={`Loud of ${name}`} className="w-16">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEVEL_OPTIONS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {level}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-2">
                    <BandSectionMore name={name} plan={plan} disabled={disabled} onChange={(patch) => onChange(plan.sectionId, patch)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-silkscreen-3">Energy shapes the drums. Busy and Loud shape the bass, and Loud also softens or hardens the drums.</p>
    </>
  );
}
