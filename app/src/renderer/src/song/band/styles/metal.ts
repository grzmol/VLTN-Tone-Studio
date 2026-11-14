// Metal: double kick. Pairs of kicks on the eighths and sixteenths, a snare on 2 and 4 and tom fills that use the whole kit.

import { figure } from "../bass-figures";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS, SIXTEENTHS, ramp } from "./notation";
import type { Style } from "./types";

export const METAL: Style = {
  id: "metal",
  name: "Metal",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "tight",
  grooves: {
    1: [
      groove("Kick quarters and cross-stick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse double kick", 16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Kick pairs",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [6, 14], { tier: "busy" }),
      ),
      groove(
        "Kick pairs with more pairs",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 4, 10, 12], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [6, 14], { tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Eighth double kick",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 4, 6, 10, 12, 14], { tier: "lean" }),
        lane(KICK, VEL.normal, [7, 15], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
      groove(
        "Eighth kick with a hit on the and",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 6, 10, 14], { tier: "lean" }),
        lane(KICK, VEL.normal, [3, 11], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
      ),
    ],
    4: [
      groove(
        "Sixteenth double kick",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [4, 12], { tier: "lean" }),
        lane(KICK, VEL.normal, [1, 5, 9, 13], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
      groove(
        "Eighth kick and open hat",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 4, 6, 10, 12, 14], { tier: "lean" }),
        lane(KICK, VEL.normal, [7, 15], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [14], { tier: "lean" }),
      ),
    ],
    5: [
      groove(
        "Full double kick",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 4, 6, 10, 12, 14], { tier: "lean" }),
        lane(KICK, VEL.normal, ODD_SIXTEENTHS, { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [6, 14], { tier: "lean" }),
      ),
      groove(
        "Crash and busy double kick",
        16,
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 4, 6, 10, 12, 14], { tier: "lean" }),
        lane(KICK, VEL.normal, [3, 11], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
    ],
  },
  fills: {
    short: [
      bar(16, ramp(KICK, [12, 13, 14, 15], 74, 112)),
      bar(16, lane(HIGH_TOM, 80, [12]), lane(MID_TOM, 90, [13]), lane(LOW_TOM, 100, [14]), lane(KICK, VEL.accent, [15])),
      bar(16, lane(SNARE, VEL.normal, [12]), ramp(SNARE, [13, 14, 15], 74, 112)),
    ],
    half: [
      bar(16, lane(KICK, VEL.normal, [8, 10, 12, 14]), lane(SNARE, VEL.normal, [9, 11, 13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [8, 9]),
        lane(MID_TOM, VEL.normal, [10, 11]),
        lane(LOW_TOM, VEL.normal, [12, 13]),
        lane(SNARE, VEL.normal, [14]),
        lane(KICK, VEL.normal, [15]),
      ),
      bar(16, ramp(KICK, [8, 9, 10, 11, 12, 13, 14, 15], 70, 112), lane(SNARE, VEL.accent, [12])),
      bar(16, ramp(HIGH_TOM, [8, 9], 76, 82), ramp(MID_TOM, [10, 11], 88, 94), ramp(LOW_TOM, [12, 13], 100, 104), lane(KICK, VEL.accent, [14, 15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [...EIGHTHS]),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(HIGH_TOM, VEL.normal, [10]),
        lane(MID_TOM, VEL.normal, [13]),
        lane(LOW_TOM, VEL.normal, [14, 15]),
      ),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
        lane(KICK, VEL.accent, [0, 8]),
      ),
      bar(16, ramp(KICK, SIXTEENTHS, 76, 112), lane(SNARE, VEL.accent, [4, 12])),
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        ramp(HIGH_TOM, [2, 3, 4], 74, 82),
        ramp(MID_TOM, [6, 7, 8], 86, 94),
        ramp(LOW_TOM, [10, 11, 12], 98, 106),
        lane(SNARE, VEL.accent, [14, 15]),
      ),
    ],
  },
  turnarounds: [
    bar(16, lane(KICK, VEL.accent, [13, 15])),
    bar(16, lane(SNARE, VEL.normal, [12]), lane(KICK, VEL.normal, [14, 15])),
    bar(16, lane(CRASH, VEL.crash, [14])),
  ],
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    figures: {
      1: [figure(16, "1 . . . 1 . . ."), figure(16, "1 . . . . . . ."), figure(16, "1 . . . 1 . 5 .")],
      2: [figure(16, "1 . 1 . 1 . . ."), figure(16, "1 . . . 1 . 1 ."), figure(16, "1 . 1 . . . 5 .")],
      3: [figure(16, "1 1 1 1 1 1 1 1"), figure(16, "1 . 1 . 1 . 1 1"), figure(16, "1 1 1 . 1 1 1 .")],
      4: [figure(16, "1 1 1 1 1 1 1 1", "1 1 1 1 1 1 5 app"), figure(16, "1 . 1 1 . 1 1 1"), figure(16, "1 1 . 1 1 . 5 5")],
      5: [figure(16, "1 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1"), figure(16, "1 1 1 1 1 1 1 1 1 1 1 1 5 5 5 5"), figure(16, "1 . 1 1 . 1 1 1 . 1 1 1 . 1 5 5")],
    },
    rhythms: {
      1: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      2: [
        [0, 2, 8, 10],
        [0, 4, 8, 12],
      ],
      3: [[...EIGHTHS], [0, 2, 8, 10]],
      4: [[...EIGHTHS], [0, 1, 4, 5, 8, 9, 12, 13]],
      5: [[...EIGHTHS], [...SIXTEENTHS]],
    },
  },
};
