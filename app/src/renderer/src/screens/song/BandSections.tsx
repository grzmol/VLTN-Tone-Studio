import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENERGIES, type StyleId } from "@/song/band/styles";
import { BASS_PART_CHOICES, type BassPartChoice } from "@/song/band/bass-parts";
import type { SectionOverride, SectionPlan } from "@/song/band/arrangement";
import { BandSectionMore } from "./BandSectionMore";
import { BASS_PART_LABELS, styleChoices } from "./band-labels";

export interface BandSectionRow {
  plan: SectionPlan;
  name: string;
  /** The bass part the section chose in its override: "auto" when it has none. */
  choice: BassPartChoice;
  /** What the performer changed in this section. A field that is missing here is automatic. */
  override: SectionOverride;
  /** The section's own colour, shown beside its name. */
  color?: string;
  /** The section's length in bars, or null when there is no beat grid to measure it with. */
  bars: number | null;
}

/** The levels a number select offers: energy, busy and loud all run from 1 to 5. */
const LEVEL_OPTIONS = ENERGIES.map(String);
/** An automatic value is muted, so the performer sees which ones they changed. */
const MUTED = "text-silkscreen-3";
/** Below this window width the Style and Loud columns move into the More popover. */
const NARROW = "min-[1000px]:table-cell";
const WIDE_ONLY = `hidden ${NARROW}`;

/** The same section's name with a trailing number taken off, so "Verse 2" and "Verse" are one kind of section. */
export function sectionKind(name: string): string {
  return name
    .replace(/\s*\d+$/, "")
    .trim()
    .toLowerCase();
}

/**
 * One row per section plan: name and length, style, energy, the fill at its end, whether drums and bass play in it, then the bass part,
 * busy and loud, and a More popover for the rest. A value the performer has not changed is muted. A song without sections has one row,
 * and it is edited the same way. The table scrolls inside its own container, with a sticky header, so the dialog never widens.
 */
export function BandSections({
  rows,
  disabled,
  selected,
  onSelect,
  onChange,
  onCopyToSameKind,
  onReset,
  beatsPerBar,
}: {
  rows: readonly BandSectionRow[];
  disabled: boolean;
  /** The index of the row that previews start from, or null to start from the first row. */
  selected: number | null;
  onSelect(index: number | null): void;
  onChange(sectionId: string | null, patch: SectionOverride): void;
  /** Writes this section's overrides to every section of the same kind ("Verse 1", "Verse 2" …). */
  onCopyToSameKind(sectionId: string | null): void;
  /** Removes this section's overrides, so the plan is automatic again. */
  onReset(sectionId: string | null): void;
  /** The song's beats per bar, to list the styles written for it first. */
  beatsPerBar?: number;
}) {
  const head = "sticky top-0 z-10 bg-popover py-1 pr-2 font-normal";
  return (
    <>
      <div className="max-h-[calc(100dvh-14rem)] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="text-silkscreen-3">
            <tr>
              <th className={head}>Section</th>
              <th className={`${head} ${WIDE_ONLY}`}>Style</th>
              <th className={head}>Energy</th>
              <th className={head}>Fill</th>
              <th className={head}>Drums</th>
              <th className={head}>Bass</th>
              <th className={head}>Bass part</th>
              <th className={head}>Busy</th>
              <th className={`${head} ${WIDE_ONLY}`}>Loud</th>
              <th className={head}>More</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ plan, name, choice, override, color, bars }, index) => {
              const muted = (field: keyof SectionOverride) => (field in override ? "" : MUTED);
              const picked = selected === index;
              const levelSelect = (field: "energy" | "busy" | "loud", label: string, width: string) => (
                <Select value={String(plan[field])} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { [field]: Number(value) })}>
                  <SelectTrigger size="sm" aria-label={`${label} of ${name}`} className={`${width} ${muted(field)}`}>
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
              );
              return (
                <tr
                  key={plan.sectionId ?? "whole"}
                  className={`h-11 border-t border-seam ${picked ? "bg-white/7" : ""}`}
                  // A click on the row's own space selects it, so the preview follows. The controls in it keep their own clicks.
                  onClick={(event) => {
                    if (!disabled && !(event.target as HTMLElement).closest("button, [role=combobox], [role=checkbox], input")) onSelect(index);
                  }}
                >
                  <td className="py-0 pr-2" style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
                    <div className="flex items-baseline gap-2 pl-2">
                      <button
                        type="button"
                        aria-pressed={picked}
                        disabled={disabled}
                        onClick={() => onSelect(picked ? null : index)}
                        className={`rounded px-1 text-left ${picked ? "text-led-on" : ""}`}
                      >
                        {name}
                      </button>
                      {bars !== null && <span className="whitespace-nowrap text-xs text-silkscreen-3">{bars === 1 ? "1 bar" : `${bars} bars`}</span>}
                    </div>
                  </td>
                  <td className={`py-0 pr-2 ${WIDE_ONLY}`}>
                    <Select value={plan.style} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { style: value as StyleId })}>
                      <SelectTrigger size="sm" aria-label={`Style of ${name}`} className={muted("style")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {styleChoices(beatsPerBar).map(({ id, label }) => (
                          <SelectItem key={id} value={id}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-0 pr-2">{levelSelect("energy", "Energy", "")}</td>
                  <td className="py-0 pr-2">
                    <Checkbox
                      aria-label={`Fill at the end of ${name}`}
                      className={"fill" in override ? "" : "opacity-60"}
                      disabled={disabled}
                      checked={plan.fill}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { fill: checked === true })}
                    />
                  </td>
                  <td className="py-0 pr-2">
                    <Checkbox
                      aria-label={`Drums in ${name}`}
                      className={"play" in override ? "" : "opacity-60"}
                      disabled={disabled}
                      checked={plan.play.drums}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, drums: checked === true } })}
                    />
                  </td>
                  <td className="py-0 pr-2">
                    <Checkbox
                      aria-label={`Bass in ${name}`}
                      className={"play" in override ? "" : "opacity-60"}
                      disabled={disabled}
                      checked={plan.play.bass}
                      onCheckedChange={(checked) => onChange(plan.sectionId, { play: { ...plan.play, bass: checked === true } })}
                    />
                  </td>
                  <td className="py-0 pr-2">
                    <div className="flex items-center gap-2">
                      <Select value={choice} disabled={disabled} onValueChange={(value) => onChange(plan.sectionId, { bassPart: value as BassPartChoice })}>
                        <SelectTrigger size="sm" aria-label={`Bass part of ${name}`} className={`w-32 ${muted("bassPart")}`}>
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
                  <td className="py-0 pr-2">{levelSelect("busy", "Busy", "w-16")}</td>
                  <td className={`py-0 pr-2 ${WIDE_ONLY}`}>{levelSelect("loud", "Loud", "w-16")}</td>
                  <td className="py-0 pr-2">
                    <div className="flex items-center gap-1">
                      <BandSectionMore
                        name={name}
                        plan={plan}
                        disabled={disabled}
                        beatsPerBar={beatsPerBar}
                        onChange={(patch) => onChange(plan.sectionId, patch)}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Menu for ${name}`}>
                            <Ellipsis aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={Object.keys(override).length === 0} onSelect={() => onCopyToSameKind(plan.sectionId)}>
                            Copy settings to all sections named {name.replace(/\s*\d+$/, "").trim() || name}
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={Object.keys(override).length === 0} onSelect={() => onReset(plan.sectionId)}>
                            Reset to automatic
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-silkscreen-3">
        Energy shapes the drums. Busy and Loud shape the bass, and Loud also softens or hardens the drums. Muted values are automatic.
      </p>
    </>
  );
}
