// Six-eight: two dotted-quarter beats to the bar, each split into three steps. The step is an eighth note, so the grid is a triplet
// grid (stepsPerBeat 3) and the bar has six steps. The backbeat falls on the second beat, step 3.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane } from "./notation";
import type { Style } from "./types";

const ALL = [0, 1, 2, 3, 4, 5];

export const SIX_EIGHT: Style = {
  id: "six-eight",
  name: "6/8",
  meter: { beatsPerBar: 2, stepsPerBeat: 3 },
  swingDefault: 0,
  feelDefault: "natural",
  grooves: {
    1: [
      groove("Sidestick six-eight", 6, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [3]), lane(CLOSED_HAT, VEL.hat, [0, 3])),
      groove("Kick on both beats", 6, lane(KICK, VEL.normal, [0, 3]), lane(CLOSED_HAT, VEL.hat, [0, 3])),
    ],
    2: [
      groove(
        "Six-eight pulse",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(KICK, VEL.normal, [2], { tier: "lean" }),
        lane(SNARE, VEL.normal, [3]),
        lane(CLOSED_HAT, VEL.hat, ALL),
        lane(SNARE, VEL.ghost, [5], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Light pulse",
        6,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [3], { tier: "lean" }),
        lane(SNARE, VEL.normal, [3]),
        lane(CLOSED_HAT, VEL.hat, [0, 2, 3, 5]),
        lane(SNARE, VEL.ghost, [1], { ghost: true, tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Six-eight eighths",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(SNARE, VEL.normal, [3]),
        lane(CLOSED_HAT, VEL.hat, ALL),
        lane(SNARE, VEL.ghost, [4], { ghost: true, tier: "lean" }),
        lane(KICK, VEL.normal, [5], { tier: "busy" }),
      ),
      groove(
        "Kick on the and of one",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(KICK, VEL.normal, [2], { tier: "lean" }),
        lane(SNARE, VEL.normal, [3]),
        lane(CLOSED_HAT, VEL.hat, ALL),
        lane(SNARE, VEL.ghost, [5], { ghost: true, tier: "busy" }),
      ),
    ],
    4: [
      groove(
        "Busy six-eight",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(KICK, VEL.normal, [2, 5], { tier: "lean" }),
        lane(SNARE, VEL.normal, [3]),
        lane(CLOSED_HAT, VEL.hat, ALL),
        lane(SNARE, VEL.ghost, [1], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Ghosts and ride",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(KICK, VEL.normal, [1, 4], { tier: "lean" }),
        lane(SNARE, VEL.normal, [3]),
        lane(RIDE, VEL.hat, ALL),
        lane(SNARE, VEL.ghost, [2, 5], { ghost: true, tier: "busy" }),
      ),
    ],
    5: [
      groove(
        "Driving six-eight",
        6,
        lane(KICK, VEL.normal, [0, 3]),
        lane(KICK, VEL.normal, [2, 5], { tier: "lean" }),
        lane(KICK, VEL.normal, [1, 4], { tier: "busy" }),
        lane(SNARE, VEL.normal, [3]),
        lane(RIDE, VEL.hat, ALL),
      ),
      groove(
        "Crash six-eight",
        6,
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
        lane(KICK, VEL.normal, [0, 3]),
        lane(SNARE, VEL.normal, [3]),
        lane(RIDE, VEL.hat, ALL),
        lane(OPEN_HAT, VEL.hat, [5], { tier: "lean" }),
        lane(SNARE, VEL.ghost, [2], { ghost: true, tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(6, lane(SNARE, VEL.normal, [3, 4]), lane(HIGH_TOM, VEL.normal, [5])),
      bar(6, lane(HIGH_TOM, VEL.normal, [3]), lane(MID_TOM, VEL.normal, [4]), lane(LOW_TOM, VEL.normal, [5])),
    ],
    bar: [
      bar(6, lane(KICK, VEL.accent, [0]), lane(HIGH_TOM, VEL.normal, [0, 1]), lane(MID_TOM, VEL.normal, [2, 3]), lane(LOW_TOM, VEL.normal, [4, 5])),
      bar(6, lane(KICK, VEL.accent, [0, 3]), lane(SNARE, VEL.normal, [1, 2, 3, 4, 5])),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    rhythms: {
      1: [[0], [0, 3]],
      2: [
        [0, 3],
        [0, 2, 3],
      ],
      3: [
        [0, 3],
        [0, 1, 3, 4],
      ],
      4: [
        [0, 2, 3, 5],
        [0, 3, 4],
      ],
      5: [[...ALL], [0, 2, 3, 5]],
    },
  },
};
