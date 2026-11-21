// Half-time: the backbeat sits on beat 3 only, so the groove feels half as fast as the tempo. Kicks move around the bar as energy rises.

import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, RIDE, SIDE_STICK, SNARE } from "../note";
import { VEL, bar, groove, lane, EIGHTHS, ODD_SIXTEENTHS, QUARTERS } from "./notation";
import type { Style } from "./types";

export const HALF_TIME: Style = {
  id: "half-time",
  name: "Half-time",
  meter: { beatsPerBar: 4, stepsPerBeat: 4 },
  swingDefault: 0,
  feelDefault: "laid-back",
  grooves: {
    1: [
      groove("Half-time sidestick", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, QUARTERS)),
      groove("Sparse half-time", 16, lane(KICK, VEL.normal, [0]), lane(SIDE_STICK, VEL.normal, [8]), lane(CLOSED_HAT, VEL.hat, [0, 8])),
    ],
    2: [
      groove(
        "Half-time eighths",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [7], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Half-time quarters",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, QUARTERS),
        lane(CLOSED_HAT, VEL.hat, [7, 15], { tier: "busy" }),
      ),
    ],
    3: [
      groove(
        "Half-time pulse",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6, 10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(KICK, VEL.normal, [14], { tier: "busy" }),
      ),
      groove(
        "Ghost before the end",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [7], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [14], { ghost: true, tier: "busy" }),
      ),
    ],
    4: [
      groove(
        "Half-time ride",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6, 10], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [15], { ghost: true, tier: "busy" }),
      ),
      groove(
        "Ghost and ride",
        16,
        lane(KICK, VEL.normal, [0, 10]),
        lane(KICK, VEL.normal, [3], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(SNARE, VEL.ghost, [12], { ghost: true, tier: "busy" }),
        lane(RIDE, VEL.hat, EIGHTHS),
      ),
    ],
    5: [
      groove(
        "Busy half-time",
        16,
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [6, 8, 10, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(CLOSED_HAT, VEL.hat, EIGHTHS),
        lane(CLOSED_HAT, VEL.hat, ODD_SIXTEENTHS, { tier: "busy" }),
      ),
      groove(
        "Crash and ride",
        16,
        lane(CRASH, VEL.crash, [0], { tier: "busy" }),
        lane(KICK, VEL.normal, [0]),
        lane(KICK, VEL.normal, [3, 6, 10, 14], { tier: "lean" }),
        lane(SNARE, VEL.normal, [8]),
        lane(RIDE, VEL.hat, EIGHTHS),
        lane(SNARE, VEL.ghost, [15], { ghost: true, tier: "busy" }),
      ),
    ],
  },
  fills: {
    half: [
      bar(16, lane(SNARE, VEL.normal, [8, 10, 12, 13]), lane(MID_TOM, VEL.normal, [14]), lane(LOW_TOM, VEL.normal, [15])),
      bar(16, lane(HIGH_TOM, VEL.normal, [8]), lane(MID_TOM, VEL.normal, [10]), lane(LOW_TOM, VEL.normal, [12]), lane(SNARE, VEL.normal, [14, 15])),
    ],
    bar: [
      bar(
        16,
        lane(KICK, VEL.accent, [0]),
        lane(HIGH_TOM, VEL.normal, [0, 4]),
        lane(MID_TOM, VEL.normal, [8]),
        lane(LOW_TOM, VEL.normal, [12]),
        lane(SNARE, VEL.normal, [14]),
      ),
      bar(16, lane(KICK, VEL.accent, [0, 8]), lane(SNARE, VEL.normal, [8, 10, 12, 13, 14, 15]), lane(SNARE, VEL.ghost, [9, 11], { ghost: true })),
    ],
  },
  bass: {
    walking: false,
    techniques: { slides: false, deadNotes: false, pickups: true },
    rhythms: {
      1: [[0], [0, 10]],
      2: [
        [0, 10],
        [0, 6],
      ],
      3: [
        [0, 6, 10],
        [0, 7, 14],
      ],
      4: [
        [0, 6, 10],
        [0, 3, 10],
      ],
      5: [
        [0, 6, 10, 14],
        [0, 3, 6, 10, 14],
      ],
    },
  },
};
