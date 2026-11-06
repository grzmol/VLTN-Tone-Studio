// Every style the engine knows, by id. The arrangement and the generators read styles from here; they never import a style file.

import { BALLAD } from "./ballad";
import { COUNTRY } from "./country";
import { FUNK } from "./funk";
import { HALF_TIME } from "./half-time";
import { METAL } from "./metal";
import { POP } from "./pop";
import { REGGAE } from "./reggae";
import { ROCK } from "./rock";
import { SHUFFLE } from "./shuffle";
import { SIX_EIGHT } from "./six-eight";
import { STYLE_IDS, type Style, type StyleId } from "./types";

export {
  STYLE_IDS,
  ENERGIES,
  type BassStyle,
  type DrumGroove,
  type DrumHit,
  type DrumPattern,
  type Energy,
  type Meter,
  type Style,
  type StyleId,
} from "./types";

export const STYLES: Record<StyleId, Style> = {
  rock: ROCK,
  pop: POP,
  ballad: BALLAD,
  funk: FUNK,
  shuffle: SHUFFLE,
  country: COUNTRY,
  reggae: REGGAE,
  metal: METAL,
  "six-eight": SIX_EIGHT,
  "half-time": HALF_TIME,
};

/** The style with this id, or undefined for an id the engine does not know. */
export function findStyle(id: string): Style | undefined {
  return (STYLE_IDS as readonly string[]).includes(id) ? STYLES[id as StyleId] : undefined;
}
