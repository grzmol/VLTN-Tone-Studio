import { SECTION_SHAPES, type FillSize, type SectionShape } from "@/song/band/arrangement";
import type { BassPartChoice } from "@/song/band/bass-parts";
import { STYLE_IDS, STYLES, type StyleId } from "@/song/band/styles";

/** The names the Band panel shows for each bass part, and for Auto. */
export const BASS_PART_LABELS: Record<BassPartChoice, string> = {
  auto: "Auto",
  ring: "Ring out",
  pulse: "Root pulse",
  groove: "Groove",
  melodic: "Melodic",
  walking: "Walking",
  pedal: "Pedal",
  rest: "Rest",
};

/** The meter a style is written in, as the menus name it: 4/4, 3/4, 6/8. */
function meterLabel(id: StyleId): string {
  const { beatsPerBar, stepsPerBeat } = STYLES[id].meter;
  return beatsPerBar === 2 && stepsPerBeat === 3 ? "6/8" : `${beatsPerBar}/4`;
}

/**
 * The styles for a style menu. With the song's beats per bar known, the styles written for that many beats come first and the others
 * carry their meter, "(4/4)" or "(6/8)", so a style that does not fit the song is easy to see.
 */
export function styleChoices(beatsPerBar?: number): { id: StyleId; label: string }[] {
  const fits = (id: StyleId) => beatsPerBar === undefined || (STYLES[id].meter.beatsPerBar === beatsPerBar && meterLabel(id) !== "6/8");
  const choice = (id: StyleId) => ({ id, label: fits(id) ? STYLES[id].name : `${STYLES[id].name} (${meterLabel(id)})` });
  return [...STYLE_IDS.filter(fits), ...STYLE_IDS.filter((id) => !fits(id))].map(choice);
}

/** The choices of the Fill menu: Auto sizes the fill to the change into the next section. */
export const FILL_CHOICES = ["auto", "none", "short", "half", "whole"] as const;
export type FillChoice = (typeof FILL_CHOICES)[number];

export const FILL_LABELS: Record<FillChoice, string> = { auto: "Auto", none: "None", short: "Short", half: "Half bar", whole: "Whole bar" };

const FILL_SIZE_CHOICES: Record<FillSize, FillChoice> = { 0: "none", 1: "short", 2: "half", 3: "whole" };

/** The menu choice for a section's fill: `true` is Auto, `false` and 0 are None, and a size is its own choice. */
export function fillChoiceOf(fill: boolean | FillSize): FillChoice {
  if (fill === true) return "auto";
  if (fill === false) return "none";
  return FILL_SIZE_CHOICES[fill];
}

/** The fill a menu choice saves: Auto is `true`, and the others are sizes. */
export function fillOfChoice(choice: FillChoice): boolean | FillSize {
  if (choice === "auto") return true;
  return (FILL_CHOICES.indexOf(choice) - 1) as FillSize;
}

/** The shapes a section's drums can take, as the Shape menu names them. */
export const SHAPE_LABELS: Record<SectionShape, string> = { steady: "Steady", build: "Build", drop: "Drop", half: "Half-time" };
export const SHAPE_CHOICES: readonly SectionShape[] = SECTION_SHAPES;
