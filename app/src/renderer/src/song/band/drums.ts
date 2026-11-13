// Drum generation: turns the beat grid, the section plans and the style's grooves into timed drum notes. Pure: no audio and no store.
// Every bar is placed on the real beats, so a part follows tempo drift. Humanising is not done here; that is a later layer.
//
// Random draws are kept independent of the musical choices where it matters. A fill is always drawn, whether it is on or not, so
// turning one fill on changes only that bar and the rest of the song keeps its notes. Complexity does not draw at all: a hit's tier
// decides whether it plays, so every bar of a groove is the same at a fixed complexity.

import type { BandSettings, SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { accentPushes, hitSteps, isAccented, rankGrooves, type AccentProfile, type Feel } from "./feel";
import { CRASH, DRUM_DURATION, KICK, type NoteEvent } from "./note";
import { createRandom, type Random } from "./random";
import { findStyle, type Style } from "./styles";
import { playsAt, type DrumHit, type Energy } from "./styles/types";
import { barBeats, barSpans, clampVelocity, fitStepsToBar, planIndexAt, stepAt } from "./timing";

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

/**
 * Drum notes for the whole song, sorted by time. A bar belongs to the plan covering its first beat. Bars of a plan with drums off, and
 * the pickup, are silent. The last bar of the song ends on a crash and a kick on its downbeat, and nothing follows.
 *
 * With `feel` (follow my playing), the variation follows the accents, strong off-beat accents get pushes, the beats of a stop are silent,
 * and a hit beat gets a crash and a kick. Without it the notes are the same as before the feel layer existed.
 */
export function generateDrums(grid: BeatGrid, plans: readonly SectionPlan[], settings: BandSettings, seed: number, feel?: Feel): NoteEvent[] {
  const beats = grid.beats;
  const notes: NoteEvent[] = [];
  if (beats.length === 0 || plans.length === 0) return notes;

  const random = createRandom(seed);
  const perBar = barBeats(grid);
  const spans = barSpans(grid);
  const starts = spans.map((span) => span.start);
  const planOf = starts.map((beat) => planIndexAt(plans, beats[beat]));
  const emit = (time: number, pitch: number, velocity: number) => notes.push({ time, pitch, velocity: clampVelocity(velocity), duration: DRUM_DURATION });
  const quiet = (beat: number): boolean => feel?.stops.has(beat) === true;

  let segment: Segment | null = null;
  let previousPlan = -2;
  let afterFill = false;

  for (let k = 0; k < starts.length; k++) {
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

    if (k === starts.length - 1) {
      if (!quiet(start)) {
        const scale = LOUD_DRUM_SCALE[plan.loud];
        emit(beats[start], KICK, ENDING_VELOCITY * scale);
        emit(beats[start], CRASH, CRASH_VELOCITY * scale);
      }
      continue;
    }

    if (!segment || segment.plan !== planIndex || segment.barsLeft === 0) {
      segment = pickSegment(planIndex, plan.energy, style, accent, settings.complexity, random);
    }
    segment.barsLeft -= 1;
    const groove = style.grooves[plan.energy][segment.groove];

    let hits: DrumHit[] =
      segment.pushes.length > 0 ? [...groove.hits, ...segment.pushes.map((step) => ({ step, pitch: KICK, velocity: PUSH_VELOCITY }))] : groove.hits;
    let filled = false;
    const endsPlan = planOf[k + 1] !== planIndex;
    const halfChoice = random.int(style.fills.half.length);
    const barChoice = random.int(style.fills.bar.length);
    if (endsPlan && plan.fill) {
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
    if (feel) hits = hitBeatHits(hits, feel, start, perBar, style.meter.stepsPerBeat);
    // A bar that is shorter or longer than the style's bar (a 3/4 song with a 4/4 style, or where the bar lines move) plays the part of
    // the pattern that fits it.
    hits = fitStepsToBar(hits, groove.steps, style.meter.beatsPerBar, spans[k].beats);
    afterFill = filled;

    for (const hit of hits) {
      if (hit.ghost && !settings.ghostNotes) continue;
      if (!playsAt(hit, settings.complexity)) continue;

      const at = stepAt(beats, style, start, hit.step, settings.swing);
      if (at.beat >= beats.length || quiet(at.beat)) continue;
      let velocity = hit.velocity * LOUD_DRUM_SCALE[plan.loud];
      if (hit.ghost) velocity = Math.min(velocity, GHOST_CEILING);
      emit(at.time, hit.pitch, velocity);
    }
  }

  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
