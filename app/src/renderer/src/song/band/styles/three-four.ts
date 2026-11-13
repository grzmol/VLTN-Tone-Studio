// Three-four: three beats to the bar, four steps to the beat, so a bar has twelve steps. The kick is on the one. At low energy the
// snare (or cross-stick) is on two and three; at high energy it is on three alone, over hats in eighths, with the ride from energy 4.

import { figure } from "../bass-figures";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, ramp } from "./notation";
import type { Style } from "./types";

/** Step positions in a bar of three beats of sixteenths. */
const BEATS = [0, 4, 8];
const EIGHTHS = [0, 2, 4, 6, 8, 10];

export const THREE_FOUR: Style = {
  id: "three-four",
  name: "3/4",
  meter: { beatsPerBar: 3, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "natural",
  grooves: {
    1: [
      groove("Sidestick waltz", 12, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [4, 8]), lane(CLOSED_HAT, VEL.hat, BEATS)),
      groove("Kick and one stick", 12, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, BEATS)),
    ],
    2: [
      groove(
        "Waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 8]),
        lane(CLOSED_HAT, VEL.hat, BEATS),
        lane(CLOSED_HAT, VEL.hat, [2, 6, 10], { tier: "busy" }),
      ),
      groove(
        "Light waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(SNARE, VEL.normal, [4, 8]),
        lane(CLOSED_HAT, VEL.hat, BEATS),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [7], { ghost: true, tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Eighth hat waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Two and three",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [4, 8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [7], { tier: "busy" }),
      ),
    ],
    4: [
      groove(
        "Ride waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Ride and cross-stick",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(SIDE_STICK, VEL.normal, [4]),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(KICK, VEL.normal, [7], { tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Driving waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [5, 11], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Open hat waltz",
        12,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, BEATS),
        lane(OPEN_HAT, VEL.hat, [6], { tier: "lean" }),
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
      ),
    ],
  },
  fills: {
    short: [
      bar(12, ramp(SNARE, [8, 9, 10, 11], 66, 106)),
      bar(12, lane(HIGH_TOM, 76, [8]), lane(MID_TOM, 86, [9]), lane(LOW_TOM, 96, [10]), lane(SNARE, VEL.accent, [11])),
      bar(12, lane(KICK, VEL.normal, [8]), lane(SNARE, 84, [10]), lane(SNARE, VEL.accent, [11])),
    ],
    half: [
      bar(12, lane(SNARE, VEL.normal, [6, 8, 10]), lane(LOW_TOM, VEL.normal, [11])),
      bar(12, lane(HIGH_TOM, VEL.normal, [7]), lane(MID_TOM, VEL.normal, [9]), lane(LOW_TOM, VEL.normal, [10]), lane(SNARE, VEL.normal, [11])),
      bar(12, ramp(SNARE, [6, 7, 8, 9, 10, 11], 60, 108)),
      bar(12, lane(KICK, VEL.normal, [6]), ramp(HIGH_TOM, [7, 8], 72, 80), ramp(MID_TOM, [9, 10], 86, 92), lane(LOW_TOM, 98, [11])),
    ],
    bar: [
      bar(12, lane(KICK, VEL.normal, [0]), lane(HIGH_TOM, VEL.normal, [0, 4]), lane(MID_TOM, VEL.normal, [8]), lane(SNARE, VEL.normal, [11])),
      bar(12, lane(KICK, VEL.normal, [0]), lane(SNARE, VEL.normal, [4, 6, 8, 10]), lane(SNARE, VEL.ghost, [5, 7, 9, 11], { ghost: true })),
      bar(12, lane(KICK, VEL.accent, [0]), ramp(SNARE, [2, 4, 6, 7, 8, 9, 10, 11], 58, 110)),
      bar(
        12,
        lane(KICK, VEL.accent, [0]),
        ramp(HIGH_TOM, [2, 4], 66, 74),
        ramp(MID_TOM, [6, 8], 80, 88),
        ramp(LOW_TOM, [9, 10], 92, 98),
        lane(SNARE, VEL.accent, [11]),
      ),
    ],
  },
  turnarounds: [
    bar(12, lane(OPEN_HAT, VEL.hat, [10])),
    bar(12, lane(KICK, VEL.normal, [11])),
    bar(12, lane(SNARE, VEL.normal, [8]), ramp(SNARE, [10, 11], 66, 96)),
  ],
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    figures: {
      1: [figure(12, "1 . . . . ."), figure(12, "1 . . . 1 ."), figure(12, "1 . . . . .", "1 . . . 5 .")],
      2: [figure(12, "1 . . . 1 ."), figure(12, "1 . 1 . . ."), figure(12, "1 . . . 5 .")],
      3: [figure(12, "1 . 1 . 5 ."), figure(12, "1 . . . 1 5"), figure(12, "1 . 1 . 5 .", "1 . 1 . 5 app")],
      4: [figure(12, "1 . 1 . 5 1"), figure(12, "1 . 5 . 1 5"), figure(12, "1 . 1 5 1 .", "1 . 1 5 1 app")],
      5: [figure(12, "1 1 1 1 5 5"), figure(12, "1 . 1 1 5 1"), figure(12, "1 1 5 1 1 5")],
    },
    rhythms: {
      1: [[0], [0, 8]],
      2: [[0], [0, 8]],
      3: [
        [0, 4, 8],
        [0, 8],
      ],
      4: [
        [0, 4, 8],
        [0, 4, 6, 8],
      ],
      5: [
        [0, 4, 6, 8],
        [0, 2, 4, 6, 8, 10],
      ],
    },
  },
};
