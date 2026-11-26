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
