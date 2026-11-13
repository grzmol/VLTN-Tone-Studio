// Funk: sixteenth-note grooves, with kick and snare placed on the off-beats and ghost notes between the backbeats.

import { figure } from "../bass-figures";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS } from "./notation";
import type { Style } from "./types";

export const FUNK: Style = {
  id: "funk",
  name: "Funk",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "tight",
  grooves: {
    1: [
      groove("Sidestick funk", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse funk", 16, lane(KICK, VEL.normal, [0, 11]), lane(SIDE_STICK, VEL.normal, [4, 12]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Ghosts between the backbeats",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 15], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
      groove(
        "Kick on three",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [3], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [6, 14], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    3: [
      groove(
        "Sixteenth hats",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [3], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
      groove(
        "Syncopated kick",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [2, 9, 14], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    4: [
      groove(
        "Funk groove",
        16,
        lane(KICK, VEL.normal, [0, 8]),
        lane(KICK, VEL.normal, [3, 10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
      groove(
        "Eighth hat funk",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [3, 6], { tier: "lean" }),
        lane(KICK, VEL.normal, [11], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [9, 14], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
      ),
    ],
    5: [
      groove(
        "Busy funk",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [3, 6], { tier: "lean" }),
        lane(KICK, VEL.normal, [13], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(OPEN_HAT, VEL.hat, [2, 6, 10, 14], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [7, 11, 15], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
      groove(
        "Crash funk",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [2, 3, 6], { tier: "lean" }),
        lane(KICK, VEL.normal, [11], { tier: "busy" }),
        lane(SNARE, VEL.normal, [4, 12]),
        lane(SNARE, VEL.ghost, [7, 14], { ghost: true, tier: "busy" }),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 14]), lane(SNARE, VEL.ghost, [9, 11, 13, 15], { ghost: true }), lane(KICK, VEL.normal, [14])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8, 10]), lane(MID_TOM, VEL.normal, [12, 13]), lane(LOW_TOM, VEL.normal, [14]), lane(SNARE, VEL.normal, [15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0, 8, 14]),
        lane(HIGH_TOM, VEL.normal, [0, 2]),
        lane(MID_TOM, VEL.normal, [4, 6]),
        lane(LOW_TOM, VEL.normal, [8, 10]),
        lane(SNARE, VEL.normal, [12, 14]),
      ),
      bar(16, lane(KICK, VEL.accent, [0, 8]), lane(SNARE, VEL.normal, [2, 4, 6, 8, 10, 12, 14]), lane(SNARE, VEL.ghost, ODD_SIXTEENTHS, { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: true, pickups: true },
    figures: {
      1: [figure(16, "1 . . . . . . . . . . 5 . . . ."), figure(16, "1 . . . . . . . . . . . . . . ."), figure(16, "1 . . . . . . . . . . . . . 8s .")],
      2: [figure(16, "1 . . 1s . . . . . . 5 . . . . ."), figure(16, "1 . . . . . 8s . . . 1 . . . . ."), figure(16, "1 . . . . . 1s . . . . . 5 . . .")],
      3: [figure(16, "1 . . 1s . . 5 . . . 1s . . . 8s ."), figure(16, "1 . . 1s . . . . 8 . 1s . . . 5 ."), figure(16, "1 . . 1 . . 8s . . . 7 . . . 5 .")],
      4: [
        figure(16, "1 . . 1s . . 8 . . . 7 5 . . . ."),
        figure(16, "1 . . 1s . . 7 . 8 . 5 . . . 1s ."),
        figure(16, "1 . 1s . . 8s . . 1 . . 7 . 5 . ."),
        figure(16, "1 . . 1s . . 8 . . . 1 . . . 5 ."),
      ],
      5: [
        figure(16, "1 . 1s 1s . . 8s . 1 . 7 5 . . 8s ."),
        figure(16, "1 . . 1s . . 8s 7 . . 1s . . 5 8s ."),
        figure(16, "1 . 1s . 1s . 5 8s . 1s . 7 . 5 . ."),
        figure(16, "1 . 1s 1s . . 8s . 1 . 1 5 . . 8s ."),
      ],
    },
    rhythms: {
      1: [[0, 11], [0]],
      2: [
        [0, 3, 10],
        [0, 6, 10],
      ],
      3: [
        [0, 3, 6, 10],
        [0, 3, 8, 10, 14],
      ],
      4: [
        [0, 3, 6, 10, 11],
        [0, 3, 8, 10, 13],
      ],
      5: [
        [0, 2, 3, 6, 8, 10, 11, 14],
        [0, 3, 6, 7, 10, 13, 14],
      ],
    },
  },
};
