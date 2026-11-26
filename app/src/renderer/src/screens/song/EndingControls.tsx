import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BandSettings } from "@/song/band/arrangement";
import { ENDINGS, type EndingKind } from "@/song/band/ending";

const ENDING_LABELS: Record<EndingKind, string> = { hit: "Hit", hold: "Fill and hold", hits: "Three hits", slow: "Slow down", none: "None" };
/** The value of the "End after" menu that leaves the choice to the generator. */
const AUTOMATIC = "automatic";

/**
 * How the generated drums and bass end the song, and after which section. A hold, three hits and a slow-down play past the song's end, so
 * the generated tracks can be a little longer than the song.
 */
export function EndingControls({
  settings,
  sections,
  disabled,
  onChange,
}: {
  settings: BandSettings;
  /** The song's sections, for "End after". Empty for a song without sections. */
  sections: readonly { id: string; name: string }[];
  disabled?: boolean;
  onChange(patch: Partial<BandSettings>): void;
}) {
  const { ending } = settings;
  const known = sections.some((section) => section.id === ending.atSection);
  return (
    <section aria-label="Ending" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <label className="flex items-center gap-3">
        Ending
        <Select value={ending.kind} disabled={disabled} onValueChange={(kind) => onChange({ ending: { ...ending, kind: kind as EndingKind } })}>
          <SelectTrigger aria-label="Ending" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENDINGS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {ENDING_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {ending.kind !== "none" && sections.length > 0 && (
        <label className="flex items-center gap-3">
          End after
          <Select
            value={known ? (ending.atSection ?? AUTOMATIC) : AUTOMATIC}
            disabled={disabled}
            onValueChange={(value) => onChange({ ending: { ...ending, atSection: value === AUTOMATIC ? null : value } })}
          >
            <SelectTrigger aria-label="End after" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATIC}>Automatic</SelectItem>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <p className="basis-full text-silkscreen-3">
        {ending.kind === "hit" || ending.kind === "none"
          ? "Automatic ends the parts at the end of the last section with drums, or at the song's Trim end."
          : "This ending plays past the end of the song, so the generated tracks are a little longer than the song."}
      </p>
    </section>
  );
}
