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
import { addKickEighths, barRoles, choked, dropBar, fillSizeOf, overlay, riseHats, shapeFill, snareBuild } from "./drum-phrases";
import { VEL } from "./styles/notation";
import { BUSY_FROM, LEAN_FROM, LEGACY_FILLS, playsAt, type DrumGroove, type DrumHit, type Energy } from "./styles/types";
import { barBeats, barEnd, barSpans, clampVelocity, fitStepsToBar, patternBeats, planOfBar, stepAt, stepsPerGridBeat } from "./timing";

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

/** Above this tempo one hand cannot keep sixteenths: the busy hits drop. */
const BUSY_LIMIT_BPM = 150;
/** Above this tempo the lean hits drop too (for the snare; the kick keeps them). */
const LEAN_LIMIT_BPM = 190;
/** Below this tempo a bar has room, so the complexity is raised. */
const SLOW_BPM = 80;
const SLOW_BOOST = 0.2;
/** A cap just under a tier's threshold, so the tier is out and the one below is not. */
const JUST_UNDER = 1e-6;
/** The metal style's kick may play its busy sixteenths up to this tempo: double kick is the style. */
const METAL_KICK_LIMIT_BPM = 200;

/**
 * The complexity a bar can physically play at this tempo: sixteenths with one hand stop being playable around 150 BPM. At four steps to
 * the beat, above 150 BPM the busy hits drop (the complexity is capped just under their tier) and above 190 the lean ones too; below 80 BPM
 * a bar has room, and the complexity rises by 0.2 (up to 1). Other grids are as they are.
 */
export function tempoLimitedComplexity(complexity: number, bpm: number, stepsPerBeat: number): number {
  if (stepsPerBeat !== 4) return complexity;
  if (bpm > LEAN_LIMIT_BPM) return Math.min(complexity, LEAN_FROM - JUST_UNDER);
  if (bpm > BUSY_LIMIT_BPM) return Math.min(complexity, BUSY_FROM - JUST_UNDER);
  if (bpm < SLOW_BPM) return Math.min(1, complexity + SLOW_BOOST);
  return complexity;
}

/** The complexity the kick plays at: it keeps its lean hits above 190 BPM, and the metal style keeps its busy ones up to 200. */
function kickComplexity(complexity: number, bpm: number, style: Style): number {
  const felt = style.id === "metal" ? (bpm > METAL_KICK_LIMIT_BPM ? BUSY_LIMIT_BPM + 1 : Math.min(bpm, BUSY_LIMIT_BPM)) : Math.min(bpm, LEAN_LIMIT_BPM);
  return tempoLimitedComplexity(complexity, felt, style.meter.stepsPerBeat);
}

/** The style a section plays: its own, or at drum engine 3 the half-time style's grooves for a half-time shape, when the two share a bar. */
function styleOf(plan: SectionPlan, phrased: boolean): Style | undefined {
  const own = findStyle(plan.style);
  const half = findStyle("half-time");
  const fits = own && half && half.meter.beatsPerBar === own.meter.beatsPerBar && half.meter.stepsPerBeat === own.meter.stepsPerBeat;
  return phrased && plan.shape === "half" && fits ? half : own;
}

/** The draws a bar makes under the drum phrases: which turnaround, short fill, half fill and bar fill it would use. Always drawn, whether used or not. */
interface BarDraws {
  turn: number;
  short: number;
  half: number;
  bar: number;
}

/** What a section plays under the drum phrases: its two grooves (the second one is the lift), the follow pushes of each, and its draws per bar. */
interface PhraseSection {
  grooves: [number, number];
  pushes: [number[], number[]];
  draws: BarDraws[];
}

/**
 * A section's groove, lift and draws. They come from streams named by the section's seed (its own, or the song's) and its name, so a section
 * keeps its drums when another section is given a new seed. A repeat of a section name has the same grooves; its fills are drawn again.
 * With follow-my-playing the groove is among the best FOLLOW_TOP fits to the accents, and the lift is the next one down the ranking.
 */
function phraseSection(
  plan: SectionPlan,
  songSeed: number,
  occurrence: number,
  bars: number,
  style: Style,
  accent: AccentProfile | undefined,
  complexity: number,
): PhraseSection {
  const seed = plan.seed ?? songSeed;
  const grooves = style.grooves[plan.energy];
  const ranked = accent ? rankGrooves(grooves, accent.weights, complexity) : grooves.map((_, i) => i);
  const pick = createRandom(variationSeed(seed, `${plan.name}/groove`, 0)).int(accent ? Math.min(FOLLOW_TOP, ranked.length) : ranked.length);
  const first = ranked[pick];
  const lift = ranked[(pick + 1) % ranked.length];
  const pushesOf = (groove: number): number[] => (accent ? accentPushes(accent.weights, grooves[groove], complexity, style.meter.stepsPerBeat) : []);
  const random = createRandom(variationSeed(seed, `${plan.name}/bars`, occurrence));
  const draws = Array.from({ length: bars }, () => ({
    turn: random.int(style.turnarounds.length),
    short: random.int(style.fills.short.length),
    half: random.int(style.fills.half.length),
    bar: random.int(style.fills.bar.length),
  }));
  return { grooves: [first, lift], pushes: [pushesOf(first), pushesOf(lift)], draws };
}

/** The fill of a size (1 last beat, 2 half a bar, 3 the whole bar) a bar draws, shaped to rise, and the step it takes the bar from. */
function fillOf(style: Style, draw: BarDraws, size: 1 | 2 | 3, steps: number): { from: number; fill: DrumHit[] } {
  const from = size === 1 ? steps - style.meter.stepsPerBeat : size === 2 ? steps / 2 : 0;
  const pattern = size === 1 ? style.fills.short[draw.short] : size === 2 ? style.fills.half[draw.half] : style.fills.bar[draw.bar];
  return { from, fill: shapeFill(pattern.hits, VEL.accent).filter((hit) => hit.step >= from) };
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
  // Under the drum phrases (engine 3) every bar knows its place in its section's phrases, and a section draws from streams of its own.
  const phrased = settings.engine >= 3;
  const barsOf = plans.map((_, i) => planOf.filter((index) => index === i).length);
  const counted = plans.map(() => 0);
  const barIndex = planOf.map((index) => (index >= 0 ? counted[index]++ : -1));
  const roles = barsOf.map((bars) => barRoles(bars));
  const sections = new Map<number, PhraseSection>();
  const sectionFor = (planIndex: number): PhraseSection => {
    let found = sections.get(planIndex);
    if (!found) {
      const accented = feel?.profiles[planIndex];
      found = phraseSection(
        plans[planIndex],
        seed,
        occurrence[planIndex],
        barsOf[planIndex],
        styleOf(plans[planIndex], true) ?? findStyle("rock")!,
        isAccented(accented) ? accented : undefined,
        settings.complexity,
      );
      sections.set(planIndex, found);
    }
    return found;
  };
  // The fill a section's end draws, of a kind. Two section ends in a row draw different fills of the same kind, unless one of the sections has
  // a seed of its own: a kept section does not depend on its neighbours. Every kind is drawn whether it is used or not, so the fill's size
  // changes nothing but the notes of that bar.
  const fillDraws = new Map<string, number>();
  const sectionFill = (planIndex: number, kind: "short" | "half" | "bar"): number => {
    const key = `${planIndex}/${kind}`;
    const known = fillDraws.get(key);
    if (known !== undefined) return known;
    const last = sectionFor(planIndex).draws[barsOf[planIndex] - 1];
    const style = styleOf(plans[planIndex], true);
    let choice = last[kind];
    const before = planIndex > 0 ? plans[planIndex - 1] : undefined;
    if (before && style && styleOf(before, true)?.id === style.id && before.seed === undefined && plans[planIndex].seed === undefined) {
      if (sectionFill(planIndex - 1, kind) === choice) choice = (choice + 1) % style.fills[kind].length;
    }
    fillDraws.set(key, choice);
    return choice;
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
    const style = plan && plan.play.drums ? styleOf(plan, phrased) : undefined;
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

    let groove: DrumGroove;
    let hits: DrumHit[];
    let filled = false;
    // The loud level of the bar: a build lifts its last two bars by one.
    let barLoud: Energy = plan.loud;
    if (phrased) {
      const section = sectionFor(planIndex);
      const role = roles[planIndex][barIndex[k]];
      const next = plans[planIndex + 1];
      const fillSize = fillSizeOf(plan, next);
      // The bar at the end of a section draws its fills from the section's end draws; the other bars from their own.
      const draw = role.sectionEnd
        ? { ...section.draws[role.bar], short: sectionFill(planIndex, "short"), half: sectionFill(planIndex, "half"), bar: sectionFill(planIndex, "bar") }
        : section.draws[role.bar];
      // A repeat of a section (Verse 2) plays the section's other groove in its second half, so it is the same part with a lift.
      const lifted = occurrence[planIndex] % 2 === 1 && role.bar >= Math.floor(barsOf[planIndex] / 2) ? 1 : 0;
      groove = style.grooves[plan.energy][section.grooves[lifted]];
      const pushes = section.pushes[lifted];
      hits = pushes.length > 0 ? [...groove.hits, ...pushes.map((step) => ({ step, pitch: KICK, velocity: PUSH_VELOCITY }))] : groove.hits;
      const lastBeat = groove.steps - style.meter.stepsPerBeat;
      const fillMark = markOf(marked, k, "fill");
      const noFill = markOf(marked, k, "no-fill") !== undefined;
      const hold = shape?.fill === true && k === ending;
      const asFill = (size: 1 | 2 | 3): void => {
        const { from, fill } = fillOf(style, draw, size, groove.steps);
        hits = [...hits.filter((hit) => hit.step < from), ...fill];
        filled = size >= 2;
      };
      if (hold) {
        // The bar before a hold is a whole-bar fill whatever the section's energy, so the band stops together.
        asFill(3);
      } else if (noFill) {
        // A bar marked No fill plays its groove, whatever the rules say.
      } else if (fillMark) {
        // A marked fill takes the last `beats` beats of the bar: a short fill for one beat, a half-bar fill cut to the beats, or the whole bar.
        const taken = markBeats(fillMark);
        const bar = patternBeats(style, perBar);
        if (taken >= bar) asFill(3);
        else if (taken <= 1) asFill(1);
        else {
          const cutoff = groove.steps * (1 - taken / bar);
          hits = [...hits.filter((hit) => hit.step < cutoff), ...shapeFill(style.fills.half[draw.half].hits, VEL.accent).filter((hit) => hit.step >= cutoff)];
          filled = true;
        }
      } else if (role.sectionEnd) {
        // The last bar of a drop is kick and hats, then a half-bar fill, whatever size the change asks for.
        if (plan.shape === "drop") hits = dropBar(hits, style.meter.stepsPerBeat);
        if (fillSize !== 0) asFill(plan.shape === "drop" ? 2 : fillSize);
        // Before a section with the drums off the last bar ends with a kick and a crash, if the section is loud.
        if (choked(plan, next)) {
          hits = [
            ...hits.filter((hit) => hit.step < lastBeat),
            { step: lastBeat, pitch: KICK, velocity: HIT_KICK_VELOCITY },
            { step: lastBeat, pitch: CRASH, velocity: CRASH_VELOCITY },
          ];
        }
      } else if (plan.shape === "drop") {
        // A drop is kick and hats, with none of the small fills and turnarounds of the phrases.
        hits = dropBar(hits, style.meter.stepsPerBeat);
      } else if (role.pairEnd) {
        asFill(1);
      } else if (role.phraseEnd) {
        hits = overlay(hits, style.turnarounds[draw.turn].hits, lastBeat);
      }
      if (plan.shape === "build") {
        // A build rises over the section's last four bars (or all of it when it is shorter): the hats get louder, the kick fills in the eighths
        // and the loud level lifts in the last two, and the last bar is a snare roll.
        const window = Math.min(4, barsOf[planIndex]);
        const into = role.bar - (barsOf[planIndex] - window);
        if (into >= 0) {
          const lifting = into >= window - 2;
          hits = riseHats(hits, into);
          if (lifting) {
            hits = addKickEighths(hits, groove.steps, style.meter.stepsPerBeat);
            barLoud = Math.min(5, plan.loud + 1) as Energy;
          }
          if (role.sectionEnd && !fillMark && !noFill && !hold && fillSize !== 0) {
            hits = snareBuild(groove.steps, style.meter.stepsPerBeat);
            filled = true;
          }
        }
      }
    } else {
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
      groove = style.grooves[plan.energy][played.groove];

      hits =
        played.pushes.length > 0 ? [...groove.hits, ...played.pushes.map((step) => ({ step, pitch: KICK, velocity: PUSH_VELOCITY }))] : groove.hits;
      const holdBar = shape?.fill === true && k === ending;
      const endsPlan = planOf[k + 1] !== planIndex;
      // Songs on drum engine 2 or earlier draw from the fills a style had then.
      const halfCount = Math.min(LEGACY_FILLS, style.fills.half.length);
      const barCount = Math.min(LEGACY_FILLS, style.fills.bar.length);
      let halfChoice = random.int(halfCount);
      let barChoice = random.int(barCount);
      if (mine) {
        halfChoice = mine.int(halfCount);
        barChoice = mine.int(barCount);
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

    // Under the drum phrases a bar plays what its own tempo allows, so a song that speeds up thins out.
    const bpm = (60 * spans[k].beats) / Math.max(1e-6, barEnd(beats, start, spans[k].beats) - beats[start]);
    const barComplexity = phrased ? tempoLimitedComplexity(settings.complexity, bpm, style.meter.stepsPerBeat) : settings.complexity;
    const kickPlays = phrased ? kickComplexity(settings.complexity, bpm, style) : settings.complexity;
    for (const hit of resting ? [] : hits) {
      if (hit.ghost && !settings.ghostNotes) continue;
      if (!playsAt(hit, hit.pitch === KICK ? kickPlays : barComplexity)) continue;

      const at = stepAt(beats, style, start, hit.step, perBar, settings.swing);
      if (at.beat >= beats.length || quiet(at.beat)) continue;
      let velocity = hit.velocity * LOUD_DRUM_SCALE[barLoud];
      if (hit.ghost) velocity = Math.min(velocity, GHOST_CEILING);
      emit(at.time, hit.pitch, velocity);
    }
  }

  // A hold or a slow ending plays its last hit after the ending bar, which may be past the grid's end.
  if (shape && !shape.replacesBar && endingPlan) writeEnding(shape, endingPlan, false, emit);

  return notes.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}
