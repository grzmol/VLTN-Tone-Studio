// Ballad: slow and soft. Sidestick or light snare on 3, a ride on the beat, and kicks that move only with more energy.

import { figure } from "../bass-figures";
import { CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, QUARTERS, ramp } from "./notation";
import type { Style } from "./types";

export const BALLAD: Style = {
  id: "ballad",
  name: "Ballad",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "laid-back",
  grooves: {
    1: [
      groove("Sidestick and ride quarters", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(RIDE, VEL.hat, QUARTERS)),
      groove("Sparse ride", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(RIDE, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Soft backbeat",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(RIDE, VEL.hat, [2, 6, 10, 14], { tier: "busy" }),
      ),
      groove(
        "Kick on the and of two",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, [0, 8]),
        lane(SNARE, VEL.ghost, [7], { ghost: true, tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Ride quarters",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(RIDE, VEL.hat, [2, 6, 10, 14], { tier: "busy" }),
      ),
      groove(
        "Ghost on the end",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.ghost, [15], { ghost: true, tier: "busy" }),
        lane(RIDE, VEL.hat, QUARTERS),
      ),
    ],
    4: [
      groove(
        "Ride eighths",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [7], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [15], { tier: "busy" }),
      ),
      groove(
        "Kick on three",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [4], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [14], { ghost: true, tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Driving ballad",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [6, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Open hat ballad",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8, 12]),
        lane(SNARE, VEL.normal, [4], { tier: "lean" }),
        lane(RIDE, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [6, 14], { tier: "lean" }),
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
      ),
    ],
  },
  fills: {
    short: [
      bar(16, ramp(SNARE, [12, 13, 14, 15], 54, 92)),
      bar(16, lane(HIGH_TOM, 66, [12]), lane(MID_TOM, 76, [13]), lane(LOW_TOM, 86, [14]), lane(SNARE, VEL.accent, [15])),
      bar(16, lane(KICK, 72, [12]), ramp(SNARE, [14, 15], 60, 96)),
    ],
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(MID_TOM, VEL.normal, [13]), lane(LOW_TOM, VEL.normal, [15])),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [9]),
        lane(MID_TOM, VEL.normal, [11]),
        lane(LOW_TOM, VEL.normal, [13]),
        lane(SNARE, VEL.normal, [14]),
        lane(KICK, VEL.normal, [15]),
      ),
      bar(16, ramp(SNARE, [8, 10, 12, 13, 14, 15], 54, 100)),
      bar(16, ramp(HIGH_TOM, [8, 10], 62, 70), lane(MID_TOM, 78, [12]), lane(LOW_TOM, 88, [14]), lane(SNARE, VEL.accent, [15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.normal, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 4]),
        lane(MID_TOM, VEL.normal, [8]),
        lane(LOW_TOM, VEL.normal, [12]),
        lane(SNARE, VEL.normal, [15]),
      ),
      bar(16, lane(KICK, VEL.normal, [0, 8]), lane(SNARE, VEL.normal, [4, 6, 8, 10, 12, 14]), lane(SNARE, VEL.ghost, [5, 7, 9, 11, 13, 15], { ghost: true })),
      bar(16, lane(KICK, VEL.normal, [0]), ramp(SNARE, [4, 6, 8, 10, 12, 13, 14, 15], 50, 104)),
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        ramp(HIGH_TOM, [4, 6], 60, 66),
        ramp(MID_TOM, [8, 10], 74, 80),
        ramp(LOW_TOM, [12, 14], 88, 94),
        lane(SNARE, VEL.accent, [15]),
      ),
    ],
  },
  turnarounds: [
    bar(16, lane(KICK, 80, [14])),
    bar(16, lane(OPEN_HAT, VEL.hat, [14])),
    bar(16, lane(SIDE_STICK, VEL.normal, [12]), ramp(SNARE, [14, 15], 56, 80)),
  ],
  bass: {
    walking: false,
    techniques: { slides: true, deadNotes: false, pickups: true },
    figures: {
      1: [figure(16, "1 . . . . . . ."), figure(16, "1 . . . . . 5 3"), figure(16, "1 . . . . . . .", "1 . . . 5 . . .")],
      2: [figure(16, "1 . . . 1 . . ."), figure(16, "1 . . . . . 5 ."), figure(16, "1 . . . . . 5 3")],
      3: [figure(16, "1 . . . 5 . . ."), figure(16, "1 . . . 1 . 5 ."), figure(16, "1 . . . . . 5 3", "1 . . . . . 5 app")],
      4: [figure(16, "1 . 5 . 1 . 5 ."), figure(16, "1 . . . 1 . 5 3"), figure(16, "1 . 1 . 5 . 3 5", "1 . 1 . 5 . 3 app")],
      5: [figure(16, "1 . 1 . 5 . 1 ."), figure(16, "1 . 5 . 8 . 5 ."), figure(16, "1 . 1 5 1 . 5 3")],
    },
    rhythms: {
      1: [[0], [0, 8]],
      2: [[0], [0, 8]],
      3: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      4: [
        [0, 4, 8, 12],
        [0, 6, 8],
      ],
      5: [
        [0, 4, 8, 12],
        [0, 2, 4, 6, 8, 10, 12, 14],
      ],
    },
  },
};
