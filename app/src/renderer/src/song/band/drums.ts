// Drum generation: turns the beat grid, the section plans and the style's grooves into timed drum notes. Pure: no audio and no store.
// Every bar is placed on the real beats, so a part follows tempo drift. Humanising is not done here; that is a later layer.
//
// Random draws are kept independent of the musical choices where it matters. A fill is always drawn, whether it is on or not, so
// turning one fill on changes only that bar and the rest of the song keeps its notes. Complexity does not draw at all: a hit's tier
// decides whether it plays, so every bar of a groove is the same at a fixed complexity.

import type { BandSettings, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { accentPushes, hitSteps, isAccented, rankGrooves, type AccentProfile, type Feel } from "./feel";
import { CLOSED_HAT, CRASH, DRUM_DURATION, KICK, SNARE, type NoteEvent } from "./note";
import { endingBar, endingShape, type EndingShape } from "./ending";
import { markBeats, marksByBar, markOf, withMarkStops } from "./marks";
import { variationSeed } from "./bass-phrases";
import { createRandom, type Random } from "./random";
import { findStyle, type Style } from "./styles";
import { playsAt, type DrumHit, type Energy } from "./styles/types";
import { barBeats, barSpans, clampVelocity, fitStepsToBar, patternBeats, planOfBar, stepAt, stepsPerGridBeat } from "./timing";

export { playsAt, BUSY_FROM, LEAN_FROM } from "./styles/types";

/** The kick and crash that end the song, before the section's loud level scales them. */
const ENDING_VELOCITY = 110;
const CRASH_VELOCITY = 110;
/** A follow push is a kick a little softer than the groove's own. A hit beat's kick is as loud as the ending's. */
const PUSH_VELOCITY = 100;
const HIT_KICK_VELOCITY = 110;
/** With follow-my-playing, a variation is picked among the best this many grooves. */
const FOLLOW_TOP = 2;
/** A section start gets a crash from this energy up, when crashOnSections is on. */
const CRASH_MIN_ENERGY = 3;
/** Up to this energy a fill is a half-bar fill. Above it the whole bar is a fill. */
const HALF_FILL_MAX_ENERGY = 3;
/** A variation lasts this many bars, picked at random each time one ends. */
const VARIATION_BARS: readonly [4, 8] = [4, 8];
/** How much a section's loud level scales the hits. Loud 3 is the groove as written. */
export const LOUD_DRUM_SCALE: Readonly<Record<Energy, number>> = { 1: 0.7, 2: 0.85, 3: 1, 4: 1.08, 5: 1.15 };
/** A ghost note stays below this velocity, whatever the loud level, so it is still a ghost. */
const GHOST_CEILING = 49;

/** The variation a plan is playing, how many bars it has left, and the follow pushes it adds to every bar. */
interface Segment {
  plan: number;
  groove: number;
  barsLeft: number;
  pushes: number[];
}

/**
 * Picks the variation a segment plays. Without a follow profile the groove is any of the style's, as before. With one, the groove is
 * among the best FOLLOW_TOP fits to the accents, and the pushes come from the same profile.
 */
function pickSegment(plan: number, energy: Energy, style: Style, accent: AccentProfile | undefined, complexity: number, random: Random): Segment {
  const grooves = style.grooves[energy];
  if (!accent) return { plan, groove: random.int(grooves.length), barsLeft: random.pick(VARIATION_BARS), pushes: [] };
  const ranked = rankGrooves(grooves, accent.weights, complexity);
  const groove = ranked[random.int(Math.min(FOLLOW_TOP, ranked.length))];
  return {
    plan,
    groove,
    barsLeft: random.pick(VARIATION_BARS),
    pushes: accentPushes(accent.weights, grooves[groove], complexity, style.meter.stepsPerBeat),
  };
}

/**
 * A crash and a kick on each hit beat of the bar that the bar does not already have there. The hit after a stop is then a clear restart.
 */
function hitBeatHits(hits: DrumHit[], feel: Feel, start: number, perBar: number, stepsPerBeat: number): DrumHit[] {
  const extra: DrumHit[] = [];
  for (const step of hitSteps(feel, start, perBar, stepsPerBeat)) {
    if (!hits.some((hit) => hit.step === step && hit.pitch === CRASH)) extra.push({ step, pitch: CRASH, velocity: CRASH_VELOCITY });
    if (!hits.some((hit) => hit.step === step && hit.pitch === KICK)) extra.push({ step, pitch: KICK, velocity: HIT_KICK_VELOCITY });
  }
  return extra.length > 0 ? [...hits, ...extra] : hits;
}

/** The hit that ends a hold: harder than any groove crash, and nothing chokes it. */
const HOLD_VELOCITY = 127;
/** The kick and snare of a slow-down's bars, and the hat on every beat of them. */
const SLOWING_KICK = 90;
const SLOWING_SNARE = 85;
const SLOWING_HAT = 70;

/**
 * The drum notes of an ending's hits. A hit is a kick and a crash; three hits are kick, snare and crash together, and so is the last hit
 * after them. A hold's last hit is a kick and a crash at full level. A slow-down plays a kick, a snare and a hat on its beats, which
 * are placed where the shape says, past the grid's last beat. `silent` drops a plain hit that the song's own stop puts under a rest.
 */
function writeEnding(shape: EndingShape, plan: SectionPlan, silent: boolean, emit: (time: number, pitch: number, velocity: number) => void): void {
  if (silent) return;
  const scale = LOUD_DRUM_SCALE[plan.loud];
  const unison = shape.unison.length > 0;
  for (const time of shape.unison) {
    emit(time, KICK, ENDING_VELOCITY * scale);
    emit(time, SNARE, ENDING_VELOCITY * scale);
    emit(time, CRASH, CRASH_VELOCITY * scale);
  }
  shape.slowing.forEach(({ time, downbeat }, i) => {
    emit(time, CLOSED_HAT, SLOWING_HAT * scale);
    if (downbeat) emit(time, KICK, SLOWING_KICK * scale);
    else if (i % 2 === 0) emit(time, SNARE, SLOWING_SNARE * scale);
  });
  const hold = shape.slowing.length > 0 || (!shape.inBar && !unison);
  emit(shape.final, KICK, hold ? HOLD_VELOCITY : ENDING_VELOCITY * scale);
  if (unison) emit(shape.final, SNARE, ENDING_VELOCITY * scale);
  emit(shape.final, CRASH, hold ? HOLD_VELOCITY : CRASH_VELOCITY * scale);
}

/**
 * Drum notes for the whole song, sorted by time. A bar belongs to the plan covering its middle. Bars of a plan with drums off, and
 * the pickup, are silent. The song ends the way `settings.ending` says (ending.ts), by default a crash and a kick on the downbeat of
 * its last bar, and nothing follows. `endTime` is the trim end: the ending then goes on the last full bar before it.
 *
 * With `feel` (follow my playing), the variation follows the accents, strong off-beat accents get pushes, the beats of a stop are silent,
 * and a hit beat gets a crash and a kick. Without it the notes are the same as before the feel layer existed.
 */
export function generateDrums(grid: BeatGrid, plans: readonly SectionPlan[], settings: BandSettings, seed: number, follow?: Feel, endTime?: number): NoteEvent[] {
  const beats = grid.beats;
  const notes: NoteEvent[] = [];
  if (beats.length === 0 || plans.length === 0) return notes;
  // The performer's marks: a stop becomes a stop of the feel, so both parts obey it (marks.ts). Without marks the feel is the one given.
  const { byBar: marked } = marksByBar(grid, settings.marks);
  const feel = withMarkStops(grid, marked, follow);

  const random = createRandom(seed);
  const perBar = barBeats(grid);
  const spans = barSpans(grid);
  const starts = spans.map((span) => span.start);
  const planOf = spans.map((span) => planOfBar(plans, beats, span));
  const emit = (time: number, pitch: number, velocity: number) => notes.push({ time, pitch, velocity: clampVelocity(velocity), duration: DRUM_DURATION });
  const quiet = (beat: number): boolean => feel?.stops.has(beat) === true;
  const ending = endingBar(grid, plans, settings.ending, endTime);
  const shape = ending >= 0 ? endingShape(grid, ending, settings.ending) : null;

  // A section with its own seed draws from a stream of its own, named by its place in the song. The song's stream still draws what it always
  // drew in that section, so the sections after it keep their notes.
  const seen = new Map<string, number>();
  const occurrence = plans.map((plan) => {
    const before = seen.get(plan.name) ?? 0;
    seen.set(plan.name, before + 1);
    return before;
  });
  const own = new Map<number, Random>();
  const ownRandom = (planIndex: number): Random | undefined => {
    const seed = plans[planIndex].seed;
    if (seed === undefined) return undefined;
    if (!own.has(planIndex)) own.set(planIndex, createRandom(variationSeed(seed, plans[planIndex].name, occurrence[planIndex])));
    return own.get(planIndex);
  };
  let segment: Segment | null = null;
  let ownSegment: Segment | null = null;
  let previousPlan = -2;
  let afterFill = false;
  let endingPlan: SectionPlan | undefined;

  for (let k = 0; k < starts.length; k++) {
    if (ending >= 0 && k > ending) break;
    const start = starts[k];
    const planIndex = planOf[k];
    const newPlan = planIndex !== previousPlan;
    const crashAfterFill = afterFill;
    previousPlan = planIndex;
    afterFill = false;

    const plan = planIndex >= 0 ? plans[planIndex] : undefined;
    const style = plan && plan.play.drums ? findStyle(plan.style) : undefined;
    if (!plan || !style) {
      segment = null;
      continue;
    }
    const profile = feel?.profiles[planIndex];
    const accent = isAccented(profile) ? profile : undefined;

    if (shape?.replacesBar && k === ending) {
      writeEnding(shape, plan, settings.ending.kind === "hit" && quiet(start), emit);
      continue;
    }

    if (!segment || segment.plan !== planIndex || segment.barsLeft === 0) {
      segment = pickSegment(planIndex, plan.energy, style, accent, settings.complexity, random);
    }
    segment.barsLeft -= 1;
    // A section with its own seed plays its own variation, which lasts as long as its own draw says. The song's segment runs on beside it.
    let played = segment;
    const mine = ownRandom(planIndex);
    if (mine) {
      if (!ownSegment || ownSegment.plan !== planIndex || ownSegment.barsLeft === 0) {
        ownSegment = pickSegment(planIndex, plan.energy, style, accent, settings.complexity, mine);
      }
      ownSegment.barsLeft -= 1;
      played = ownSegment;
    }
    const groove = style.grooves[plan.energy][played.groove];

    let hits: DrumHit[] =
      played.pushes.length > 0 ? [...groove.hits, ...played.pushes.map((step) => ({ step, pitch: KICK, velocity: PUSH_VELOCITY }))] : groove.hits;
    let filled = false;
    const holdBar = shape?.fill === true && k === ending;
    const endsPlan = planOf[k + 1] !== planIndex;
    let halfChoice = random.int(style.fills.half.length);
    let barChoice = random.int(style.fills.bar.length);
    if (mine) {
      halfChoice = mine.int(style.fills.half.length);
      barChoice = mine.int(style.fills.bar.length);
    }
    const fillMark = markOf(marked, k, "fill");
    if (holdBar) {
      // The bar before a hold is a whole-bar fill whatever the section's energy, so the band stops together.
      hits = style.fills.bar[barChoice].hits;
      filled = true;
    } else if (markOf(marked, k, "no-fill")) {
      // A bar marked No fill plays its groove, whatever the rules say.
    } else if (fillMark) {
      // A marked fill takes the last `beats` beats of the bar: the half-bar fill cut to them, or the whole-bar fill when it takes the bar.
      const taken = markBeats(fillMark);
      if (taken >= patternBeats(style, perBar)) {
        hits = style.fills.bar[barChoice].hits;
      } else {
        const cutoff = groove.steps * (1 - taken / patternBeats(style, perBar));
        hits = [...hits.filter((hit) => hit.step < cutoff), ...style.fills.half[halfChoice].hits.filter((hit) => hit.step >= cutoff)];
      }
      filled = true;
    } else if (endsPlan && plan.fill) {
      if (plan.energy <= HALF_FILL_MAX_ENERGY) {
        const middle = groove.steps / 2;
        hits = [...hits.filter((hit) => hit.step < middle), ...style.fills.half[halfChoice].hits.filter((hit) => hit.step >= middle)];
      } else {
        hits = style.fills.bar[barChoice].hits;
      }
      filled = true;
    }

    const sectionCrash = newPlan && settings.crashOnSections && plan.energy >= CRASH_MIN_ENERGY;
    if ((sectionCrash || crashAfterFill) && !hits.some((hit) => hit.step === 0 && hit.pitch === CRASH)) {
      hits = [...hits, { step: 0, pitch: CRASH, velocity: CRASH_VELOCITY }];
    }
    if (markOf(marked, k, "crash") && !hits.some((hit) => hit.step === 0 && hit.pitch === CRASH)) hits = [...hits, { step: 0, pitch: CRASH, velocity: CRASH_VELOCITY }];
    if (feel) hits = hitBeatHits(hits, feel, start, perBar, stepsPerGridBeat(style, perBar));
    if (markOf(marked, k, "no-crash")) hits = hits.filter((hit) => !(hit.step === 0 && hit.pitch === CRASH));
    // A stab: the downbeat only, a kick and a crash.
    if (markOf(marked, k, "hit")) {
      hits = [
        { step: 0, pitch: KICK, velocity: HIT_KICK_VELOCITY },
        { step: 0, pitch: CRASH, velocity: CRASH_VELOCITY },
      ];
      filled = false;
    }
    // A bar the drums rest in is still drawn from the same random numbers, so the bars after it keep their notes.
    const resting = markOf(marked, k, "drums-out") !== undefined;
    if (resting) filled = false;
    // A bar that is shorter or longer than the style's bar (a 3/4 song with a 4/4 style, or where the bar lines move) plays the part of
    // the pattern that fits it.
    hits = fitStepsToBar(hits, groove.steps, patternBeats(style, perBar), spans[k].beats);
    afterFill = filled;
    if (k === ending) endingPlan = plan;

    for (const hit of resting ? [] : hits) {
      if (hit.ghost && !settings.ghostNotes) continue;
      if (!playsAt(hit, settings.complexity)) continue;

      const at = stepAt(beats, style, start, hit.step, perBar, settings.swing);
      if (at.beat >= beats.length || quiet(at.beat)) continue;
      let velocity = hit.velocity * LOUD_DRUM_SCALE[plan.loud];
      if (hit.ghost) velocity = Math.min(velocity, GHOST_CEILING);
      emit(at.time, hit.pitch, velocity);
    }
  }

  // A hold or a slow ending plays its last hit after the ending bar, which may be past the grid's end.
  if (shape && !shape.replacesBar && endingPlan) writeEnding(shape, endingPlan, false, emit);

  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
