import type { BassPartChoice } from "@/song/band/bass-parts";

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
