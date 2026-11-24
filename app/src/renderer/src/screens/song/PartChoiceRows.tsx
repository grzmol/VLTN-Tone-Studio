import { Button } from "@/components/ui/button";
import { effectiveChoice, PART_KINDS, pedalFallbackOf, type DrumFallback, type PartChoice, type PartChoices, type PartKeys, type PartKind } from "@/song/band/part-choice";

/** The three choices, in the order the buttons show them. */
const OPTIONS: { choice: PartChoice; label: string }[] = [
  { choice: "original", label: "Original" },
  { choice: "generated", label: "Generated" },
  { choice: "both", label: "Both" },
];
/** What plays when the pedal cannot be reached. */
const FALLBACKS: { choice: DrumFallback; label: string }[] = [
  { choice: "generated", label: "Generated" },
  { choice: "original", label: "Original" },
];
const LABEL: Record<PartKind, string> = { drums: "Drums", bass: "Bass" };

/**
 * The Band panel's "What plays" choice, one row per part. The button that is pressed is the choice that actually plays (see
 * effectiveChoice), so a saved Generated choice with no generated track shows Original. Clicking a button saves its choice.
 */
export function PartChoiceRows({
  choices,
  keys,
  disabled,
  onChange,
  pedalCues = false,
  onOpenMidi,
}: {
  /** The saved choices. They are not changed by showing them, so a choice comes back when its generated track does. */
  choices: PartChoices;
  /** The track keys of each part. Generated and Both need a generated track. */
  keys: PartKeys;
  /** True while a Band action runs. Playback does not disable the rows: switching only changes mute levels. */
  disabled: boolean;
  onChange(patch: Partial<PartChoices>): void;
  /** True when the song has automatic RC-10R cues. The pedal button for drums is shown only then, or when it is already chosen. */
  pedalCues?: boolean;
  /** Opens the MIDI view, where the automatic RC-10R drums are set up. */
  onOpenMidi?: () => void;
}) {
  return (
    <section aria-label="What plays" className="flex flex-col gap-2">
      <h3 className="font-semibold">What plays</h3>
      {PART_KINDS.map((kind) => {
        const part = keys[kind] ?? {};
        const shown = effectiveChoice(choices[kind], part);
        const hasGenerated = part.generated !== undefined;
        return (
          <div key={kind} role="group" aria-label={LABEL[kind]} className="flex flex-wrap items-center gap-2">
            <span className="w-16">{LABEL[kind]}</span>
            {OPTIONS.map(({ choice, label }) => {
              const needsGenerated = choice !== "original";
              const unavailable = needsGenerated && !hasGenerated;
              return (
                <Button
                  key={choice}
                  size="sm"
                  variant={shown === choice ? "default" : "outline"}
                  aria-pressed={shown === choice}
                  disabled={disabled || unavailable}
                  onClick={() => onChange({ [kind]: choice })}
                >
                  {label}
                </Button>
              );
            })}
            {kind === "drums" && (pedalCues || choices.drums === "pedal") && (
              <Button
                size="sm"
                variant={shown === "pedal" ? "default" : "outline"}
                aria-pressed={shown === "pedal"}
                disabled={disabled}
                onClick={() => onChange({ drums: "pedal" })}
              >
                RC-10R pedal
              </Button>
            )}
            {kind === "drums" && shown === "pedal" && (
              <div role="group" aria-label="If the pedal isn't there" className="flex basis-full flex-wrap items-center gap-2 pl-16">
                <span className="text-muted-foreground">If the pedal isn’t there, play:</span>
                {FALLBACKS.map(({ choice, label }) => {
                  const selected = pedalFallbackOf(choices, hasGenerated) === choice && (choice === "original" || hasGenerated);
                  return (
                    <Button
                      key={choice}
                      size="sm"
                      variant={selected ? "default" : "outline"}
                      aria-pressed={selected}
                      disabled={disabled || (choice === "generated" && !hasGenerated)}
                      onClick={() => onChange({ pedalFallback: choice })}
                    >
                      {label}
                    </Button>
                  );
                })}
                {!pedalCues && (
                  <span className="basis-full text-amber-400">
                    This song has no automatic RC-10R drums yet, so the fallback plays.{" "}
                    {onOpenMidi && (
                      <button type="button" className="underline" onClick={onOpenMidi}>
                        Set them up in the MIDI view
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
            {!hasGenerated && <span className="text-muted-foreground">Generate the {LABEL[kind].toLowerCase()} first.</span>}
          </div>
        );
      })}
    </section>
  );
}
