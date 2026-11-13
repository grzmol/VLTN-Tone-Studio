// Rock: straight eighths on the hat, a backbeat on 2 and 4, and kick patterns that get busier with energy.

import { figure } from "../bass-figures";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS } from "./notation";
import type { Style } from "./types";

export const ROCK: Style = {
  id: "rock",
  name: "Rock",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "natural",
  grooves: {
    1: [
      groove("Cross-stick quarters", 16, lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse kick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Straight eighths",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [3, 11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Kick and eighths",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Push into two",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(KICK, VEL.normal, [14], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
      groove(
        "Eighths and a ghost before four",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [11], { ghost: true, tier: "busy" }),
      ),
    ],
    4: [
      groove(
        "Ride eighths",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [3, 11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Kick pushes",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [6, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Open hat and four kicks",
        16,
        lane(KICK, VEL.accent, [0, 8]),
        lane(KICK, VEL.normal, [6, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [2, 10], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [3, 7, 11, 15], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Ride and crash",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(HIGH_TOM, VEL.normal, [13]), lane(MID_TOM, VEL.normal, [14]), lane(LOW_TOM, VEL.normal, [15])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8]), lane(MID_TOM, VEL.normal, [10]), lane(LOW_TOM, VEL.normal, [12]), lane(SNARE, VEL.accent, [14, 15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 13, 14, 15]),
      ),
      bar(16, lane(KICK, VEL.accent, [0, 8]), lane(SNARE, VEL.normal, EIGHTHS), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    figures: {
      1: [figure(16, "1 . . . . . . ."), figure(16, "1 . . . 1 . . ."), figure(16, "1 . . . . . . .", "1 . . . 5 . . .")],
      2: [figure(16, "1 . . . 1 . . ."), figure(16, "1 . . 1 . . 1 ."), figure(16, "1 . . . 1 . 5 .")],
      3: [figure(16, "1 . 1 . 1 . 5 ."), figure(16, "1 . . 1 . . 5 ."), figure(16, "1 . 1 . 8 . 5 .", "1 . 1 . 5 . app .")],
      4: [figure(16, "1 . . 1 . . 5 .", "1 . . 1 . 8 5 app"), figure(16, "1 1 1 1 1 1 5 5"), figure(16, "1 . 1 . 8 . 5 ."), figure(16, "1 . . 1 . 1 5 .")],
      5: [figure(16, "1 1 1 1 1 1 1 1"), figure(16, "1 1 1 1 1 1 5 5", "1 1 1 1 8 8 5 app"), figure(16, "1 . 1 1 . 1 5 5")],
    },
    rhythms: {
      1: [[0], [0, 8]],
      2: [
        [0, 8],
        [0, 6, 8],
      ],
      3: [
        [0, 6, 8, 14],
        [0, 4, 8, 12],
      ],
      4: [
        [0, 3, 8, 11],
        [0, 6, 8, 14],
      ],
      5: [[...EIGHTHS], [0, 3, 6, 8, 11, 14]],
    },
  },
};
