// Country: the train beat. Kick on the one, backbeat on 2 and 4, and steady eighths on the hat, with busier energies adding kicks
// and a ride.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS } from "./notation";
import type { Style } from "./types";

export const COUNTRY: Style = {
  id: "country",
  name: "Country",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "natural",
  grooves: {
    1: [
      groove("Cross-stick and quarters", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse train", 16, lane(KICK, VEL.normal, [0, 8]), lane(SIDE_STICK, VEL.normal, [4, 12])),
    ],
    2: [
      groove(
        "Train beat",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [3, 11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Quarter hats",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(CLOSED_HAT, VEL.hat, [7, 15], { tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Kick push",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Ghost on the and of three",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [10], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    4: [
      groove(
        "Country eighths",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [6, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CLOSED_HAT, VEL.hat, [15], { tier: "busy" }),
      ),
      groove(
        "Ride eighths",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [3, 11], { ghost: true, tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Busy country",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [2, 6, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(OPEN_HAT, VEL.hat, [10], { tier: "lean" }),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
      groove(
        "Ride and crash",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [6, 10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(OPEN_HAT, VEL.hat, [14], { tier: "lean" }),
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
        lane(SNARE, VEL.ghost, [7], { ghost: true, tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 13]), lane(MID_TOM, VEL.normal, [14]), lane(LOW_TOM, VEL.normal, [15])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8, 10]), lane(SNARE, VEL.normal, [12, 14]), lane(LOW_TOM, VEL.normal, [15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [2]),
        lane(MID_TOM, VEL.normal, [4]),
        lane(LOW_TOM, VEL.normal, [6]),
        lane(SNARE, VEL.normal, [8, 10, 12, 14]),
      ),
      bar(
        16,
        lane(HIGH_TOM, VEL.normal, [0, 4]),
        lane(MID_TOM, VEL.normal, [8]),
        lane(LOW_TOM, VEL.normal, [12]),
        lane(SNARE, VEL.normal, [14, 15]),
        lane(KICK, VEL.accent, [0, 8]),
      ),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    rhythms: {
      1: [[0], [0, 8]],
      2: [
        [0, 8],
        [0, 4, 8, 12],
      ],
      3: [
        [0, 8],
        [0, 6, 8, 12],
      ],
      4: [
        [0, 6, 8, 14],
        [0, 4, 8, 12],
      ],
      5: [
        [0, 2, 6, 8, 14],
        [0, 3, 6, 8, 10, 14],
      ],
    },
  },
};
