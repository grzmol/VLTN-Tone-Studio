// Reggae: the one drop. The kick and the rim or snare land together on beat 3 only, and the hat plays the off-beats (the skank).

import { figure } from "../bass-figures";
import { CLOSED_HAT, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS } from "./notation";
import type { Style } from "./types";

/** The off-beats, the skank that the hat or the guitar plays. */
const SKANK = [2, 6, 10, 14];

export const REGGAE: Style = {
  id: "reggae",
  name: "Reggae",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "laid-back",
  grooves: {
    1: [
      groove("Sidestick one drop", 16, lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, SKANK)),
      groove("Kick and sidestick", 16, lane(KICK, VEL.normal, [8]), lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, SKANK)),
    ],
    2: [
      groove(
        "One drop",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, SKANK),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(CLOSED_HAT, VEL.hat, [7, 15], { tier: "busy" }),
      ),
      groove(
        "One drop with quarter hats",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(SIDE_STICK, VEL.normal, [6, 10], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [14], { ghost: true, tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "One drop eighths",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CLOSED_HAT, VEL.hat, [7, 15], { tier: "busy" }),
      ),
      groove(
        "One drop with open skank",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(SNARE, VEL.normal, [8]),
        lane(OPEN_HAT, VEL.hat, SKANK),
        lane(SIDE_STICK, VEL.normal, [12], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [10], { ghost: true, tier: "busy" }),
      ),
    ],
    4: [
      groove(
        "One drop with ride",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, SKANK, { tier: "lean" }),
        lane(SNARE, VEL.ghost, [12], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Kick on the and of four",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [6], { ghost: true, tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Busy one drop",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(KICK, VEL.normal, [11, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.normal, [12], { tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, SKANK, { tier: "lean" }),
        lane(CLOSED_HAT, VEL.hat, [7, 15], { tier: "busy" }),
      ),
      groove(
        "Sixteenth hats",
        16,
        lane(KICK, VEL.normal, [8]),
        lane(KICK, VEL.normal, [10, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [14], { tier: "lean" }),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(MID_TOM, VEL.normal, [13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(KICK, VEL.normal, [8]),
        lane(HIGH_TOM, VEL.normal, [10]),
        lane(MID_TOM, VEL.normal, [12]),
        lane(LOW_TOM, VEL.normal, [14]),
        lane(SNARE, VEL.normal, [15]),
      ),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [8]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
      ),
      bar(16, lane(KICK, VEL.normal, [8]), lane(SNARE, VEL.normal, EIGHTHS), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    figures: {
      1: [figure(16, ". . . . 1 . . ."), figure(16, ". . . . 1 . . .", ". . . . 5 . . ."), figure(16, ". . . . 1 . . 1")],
      2: [figure(16, ". . . . 1 . . ."), figure(16, ". 1s . . 1 . . ."), figure(16, ". . . . 1 . 5 .")],
      3: [figure(16, ". 1s . . 1 . 5 ."), figure(16, ". . . . 1 . 1s ."), figure(16, ". 1s . . 1 1s . .", ". 1s . . 1 . 5 .")],
      4: [figure(16, "1 . . . 1 . 5 ."), figure(16, ". 1s . 1s 1 . 5 ."), figure(16, ". 1s . . 1 1s 5 .", ". 1s . . 1 . 5 app")],
      5: [figure(16, "1 . 1s . 1 . 5 ."), figure(16, ". 1s 1s 1 1 . 5 5"), figure(16, "1 . . 1s 1 . 5 1s")],
    },
    rhythms: {
      1: [[8], [0, 8]],
      2: [[8], [2, 8]],
      3: [[8], [2, 8, 10]],
      4: [
        [0, 8],
        [2, 6, 8, 10],
      ],
      5: [
        [0, 2, 8, 10],
        [2, 6, 8, 14],
      ],
    },
  },
};
