import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { defaultFills, FILLS, type Fills, type SectionOverride, type SectionPlan, type SectionShape } from "@/song/band/arrangement";
import { OCTAVE_SHIFTS, type OctaveShift } from "@/song/band/bass-parts";
import { ENERGIES, findStyle, type StyleId } from "@/song/band/styles";
import { SHAPE_CHOICES, SHAPE_LABELS, styleChoices } from "./band-labels";

const OCTAVE_LABELS: Record<string, string> = { "-1": "−1 octave", "0": "Same", "1": "+1 octave" };

/**
 * The bass options a section keeps out of the table: octave, fills, hit the one, slides, dead notes and pickups. Each shows the value the
 * section plays now, and the style's default for the three techniques, so a change is measured against what the style does.
 */
export function BandSectionMore({
  name,
  plan,
  disabled,
  onChange,
  beatsPerBar,
  drumPhrases = true,
}: {
  name: string;
  plan: SectionPlan;
  disabled: boolean;
  onChange(patch: SectionOverride): void;
  /** The song's beats per bar, to list the styles written for it first. */
  beatsPerBar?: number;
  /** False for a song on the earlier drums, which have no shapes. */
  drumPhrases?: boolean;
}) {
  const technique = findStyle(plan.style)?.bass.techniques;
  const styleDefault = (on: boolean | undefined) => (on === undefined ? "" : `Style: ${on ? "on" : "off"}`);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} aria-label={`More bass options for ${name}`}>
          More
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        {/* The table drops these two columns in a narrow window (under 1000 px), so they are offered here instead. */}
        <label className="flex items-center justify-between gap-2 text-sm min-[1000px]:hidden">
          Style
          <Select value={plan.style} disabled={disabled} onValueChange={(value) => onChange({ style: value as StyleId })}>
            <SelectTrigger size="sm" aria-label={`Style of ${name}`} className="w-36">
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
        </label>
        <label className="flex items-center justify-between gap-2 text-sm min-[1000px]:hidden">
          Loud
          <Select value={String(plan.loud)} disabled={disabled} onValueChange={(value) => onChange({ loud: Number(value) as SectionPlan["loud"] })}>
            <SelectTrigger size="sm" aria-label={`Loud of ${name}`} className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENERGIES.map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Octave
          <Select value={String(plan.octave)} disabled={disabled} onValueChange={(value) => onChange({ octave: Number(value) as OctaveShift })}>
            <SelectTrigger size="sm" aria-label={`Octave of ${name}`} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OCTAVE_SHIFTS.map((shift) => (
                <SelectItem key={shift} value={String(shift)}>
                  {OCTAVE_LABELS[String(shift)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {drumPhrases && (
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>
              Shape <span className="text-xs text-silkscreen-3">(the drums)</span>
            </span>
            <Select value={plan.shape ?? "steady"} disabled={disabled} onValueChange={(value) => onChange({ shape: value as SectionShape })}>
              <SelectTrigger size="sm" aria-label={`Shape of ${name}`} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHAPE_CHOICES.map((shape) => (
                  <SelectItem key={shape} value={shape}>
                    {SHAPE_LABELS[shape]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className="flex items-center justify-between gap-2 text-sm">
          Fills
          <span className="flex items-center gap-2">
            <span className="text-xs text-silkscreen-3">Default {defaultFills(name)}</span>
            <Select value={String(plan.fills)} disabled={disabled} onValueChange={(value) => onChange({ fills: Number(value) as Fills })}>
              <SelectTrigger size="sm" aria-label={`Fills of ${name}`} className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILLS.map((fills) => (
                  <SelectItem key={fills} value={String(fills)}>
                    {fills}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            Hit the one <span className="text-xs text-silkscreen-3">(a chorus after another section)</span>
          </span>
          <Checkbox
            aria-label={`Hit the one in ${name}`}
            disabled={disabled}
            checked={plan.hitTheOne}
            onCheckedChange={(on) => onChange({ hitTheOne: on === true })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            Slides <span className="text-xs text-silkscreen-3">{styleDefault(technique?.slides)}</span>
          </span>
          <Checkbox aria-label={`Slides in ${name}`} disabled={disabled} checked={plan.slides} onCheckedChange={(on) => onChange({ slides: on === true })} />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            Dead notes <span className="text-xs text-silkscreen-3">{styleDefault(technique?.deadNotes)}</span>
          </span>
          <Checkbox
            aria-label={`Dead notes in ${name}`}
            disabled={disabled}
            checked={plan.deadNotes}
            onCheckedChange={(on) => onChange({ deadNotes: on === true })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            Pickups <span className="text-xs text-silkscreen-3">{styleDefault(technique?.pickups)}</span>
          </span>
          <Checkbox aria-label={`Pickups in ${name}`} disabled={disabled} checked={plan.pickups} onCheckedChange={(on) => onChange({ pickups: on === true })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
