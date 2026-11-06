/*
 * The live actions a performer can trigger from a MIDI message, a key or a Bluetooth page-turner (pure).
 *
 * Each action names what it does through `ActionHost`. The session supplies the transport, song and section methods, and the
 * performance screen supplies the view, mixer and tempo methods. An action that does not apply in the current state returns a short
 * hint for the performer instead of throwing, and a binding that is malformed or names an unknown action does nothing at all.
 */

/** A hint shown to the performer when an action did not do what it asked. Nothing returned means it did. */
export type Hint = string | void;

export interface ActionHost {
  play(): Hint;
  playPause(): Hint;
  stop(): Hint;
  playFromStart(): Hint;
  panic(): Hint;
  nextSong(): Hint;
  previousSong(): Hint;
  selectSong(n: number): Hint;
  crossfade(): Hint;
  nextSection(): Hint;
  previousSection(): Hint;
  armSection(n: number): Hint;
  jumpSection(n: number): Hint;
  toggleSectionLoop(): Hint;
  exitSectionLoop(): Hint;
  cancelSectionJump(): Hint;
  arm(): Hint;
  disarm(): Hint;
  /** Scrolls the lyrics, or turns the page of a PDF chart on screen (a page action turns a page). */
  scrollLyrics(direction: -1 | 1, pages: boolean): Hint;
  /** Whether a PDF chart is on screen. The default section keys turn its pages while it is. */
  pdfOnScreen(): boolean;
  fontSize(direction: -1 | 1): Hint;
  toggleStage(): Hint;
  muteGroup(n: number): Hint;
  toggleClick(): Hint;
  /** Switches a part between its original and its generated track (see song/band/part-choice.ts). */
  togglePart(kind: "drums" | "bass"): Hint;
  tap(): Hint;
  speed(change: "up" | "down" | "reset"): Hint;
}

/** The part of `ActionHost` that the performance screen supplies. */
export type ViewHost = Pick<ActionHost, "scrollLyrics" | "pdfOnScreen" | "fontSize" | "toggleStage" | "muteGroup" | "toggleClick" | "togglePart" | "tap">;

/** A number an action takes, such as the section in "Jump to section 3". */
export interface ActionNumber {
  min: number;
  max: number;
  noun: string;
}

export interface ActionDef {
  label: string;
  group: string;
  number?: ActionNumber;
  run(host: ActionHost, n: number): Hint;
}

const SECTION_MAX = 64;

const DEFINITIONS = {
  "transport.play": { label: "Play", group: "Transport", run: (h) => h.play() },
  "transport.playPause": { label: "Play or pause", group: "Transport", run: (h) => h.playPause() },
  "transport.stop": { label: "Stop", group: "Transport", run: (h) => h.stop() },
  "transport.playFromStart": { label: "Play from start", group: "Transport", run: (h) => h.playFromStart() },
  "transport.panic": { label: "Panic and disarm", group: "Transport", run: (h) => h.panic() },
  "song.next": { label: "Next song", group: "Songs", run: (h) => h.nextSong() },
  "song.previous": { label: "Previous song", group: "Songs", run: (h) => h.previousSong() },
  "song.select": { label: "Select song", group: "Songs", number: { min: 1, max: 99, noun: "Song" }, run: (h, n) => h.selectSong(n) },
  "song.crossfade": { label: "Crossfade to next song", group: "Songs", run: (h) => h.crossfade() },
  "section.next": { label: "Next section", group: "Sections", run: (h) => h.nextSection() },
  "section.previous": { label: "Previous section", group: "Sections", run: (h) => h.previousSection() },
  "section.arm": { label: "Arm section", group: "Sections", number: { min: 1, max: SECTION_MAX, noun: "Section" }, run: (h, n) => h.armSection(n) },
  "section.jump": { label: "Jump to section now", group: "Sections", number: { min: 1, max: SECTION_MAX, noun: "Section" }, run: (h, n) => h.jumpSection(n) },
  "section.toggleLoop": { label: "Loop current section", group: "Sections", run: (h) => h.toggleSectionLoop() },
  "section.exitLoop": { label: "Exit loop", group: "Sections", run: (h) => h.exitSectionLoop() },
  "section.cancelJump": { label: "Cancel jump", group: "Sections", run: (h) => h.cancelSectionJump() },
  // The default keys for the next and previous section (PageDown, PageUp and the arrows). While a PDF chart is on screen they turn its
  // pages instead. A key the performer learned to a section action is never changed: it still runs `section.next`.
  "section.nextOrPage": {
    label: "Next section, or next PDF page",
    group: "Sections",
    run: (h) => (h.pdfOnScreen() ? h.scrollLyrics(1, true) : h.nextSection()),
  },
  "section.previousOrPage": {
    label: "Previous section, or previous PDF page",
    group: "Sections",
    run: (h) => (h.pdfOnScreen() ? h.scrollLyrics(-1, true) : h.previousSection()),
  },
  "view.scrollUp": { label: "Scroll lyrics up", group: "View", run: (h) => h.scrollLyrics(-1, false) },
  "view.scrollDown": { label: "Scroll lyrics down", group: "View", run: (h) => h.scrollLyrics(1, false) },
  "view.pageUp": { label: "Page up", group: "View", run: (h) => h.scrollLyrics(-1, true) },
  "view.pageDown": { label: "Page down", group: "View", run: (h) => h.scrollLyrics(1, true) },
  "view.previousPage": { label: "Previous page", group: "View", run: (h) => h.scrollLyrics(-1, true) },
  "view.nextPage": { label: "Next page", group: "View", run: (h) => h.scrollLyrics(1, true) },
  "view.fontLarger": { label: "Larger text", group: "View", run: (h) => h.fontSize(1) },
  "view.fontSmaller": { label: "Smaller text", group: "View", run: (h) => h.fontSize(-1) },
  "view.stage": { label: "Toggle stage mode", group: "View", run: (h) => h.toggleStage() },
  "mix.muteGroup": { label: "Toggle mute group", group: "Mix", number: { min: 1, max: 6, noun: "Mute group" }, run: (h, n) => h.muteGroup(n) },
  "mix.click": { label: "Toggle click", group: "Mix", run: (h) => h.toggleClick() },
  "mix.drums": { label: "Toggle drums: original or generated", group: "Mix", run: (h) => h.togglePart("drums") },
  "mix.bass": { label: "Toggle bass: original or generated", group: "Mix", run: (h) => h.togglePart("bass") },
  "tempo.tap": { label: "Tap tempo", group: "Tempo", run: (h) => h.tap() },
  "speed.up": { label: "Speed up", group: "Tempo", run: (h) => h.speed("up") },
  "speed.down": { label: "Speed down", group: "Tempo", run: (h) => h.speed("down") },
  "speed.reset": { label: "Reset speed", group: "Tempo", run: (h) => h.speed("reset") },
  "midi.arm": { label: "Arm MIDI cues", group: "MIDI", run: (h) => h.arm() },
  "midi.disarm": { label: "Disarm MIDI cues", group: "MIDI", run: (h) => h.disarm() },
} satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof DEFINITIONS;

/** Every action, by id. Keys are the stored action names, so renaming one breaks saved bindings. */
export const ACTIONS: Record<ActionId, ActionDef> = DEFINITIONS;
export const ACTION_IDS = Object.keys(DEFINITIONS) as ActionId[];

export function isActionId(value: unknown): value is ActionId {
  return typeof value === "string" && Object.hasOwn(DEFINITIONS, value);
}

/** The name of an action with its number, as shown to the performer: "Jump to section now 3". */
export function actionLabel(action: ActionId, index?: number): string {
  const def = ACTIONS[action];
  return def.number && index !== undefined ? `${def.label} ${index}` : def.label;
}

/**
 * Runs one binding's action on `host`. Returns the hint for the performer, if the action did not apply. A number the action needs
 * must be in its range, and anything else (an unknown action, a host that throws) becomes a hint too, so a live set never stops on it.
 */
export function runAction(binding: { action: string; index?: number }, host: ActionHost): Hint {
  if (!isActionId(binding.action)) return "This binding's action is no longer available.";
  const def = ACTIONS[binding.action];
  let n = 0;
  if (def.number) {
    const { min, max, noun } = def.number;
    if (binding.index === undefined || !Number.isInteger(binding.index) || binding.index < min || binding.index > max) {
      return `${noun} must be between ${min} and ${max}.`;
    }
    n = binding.index;
  }
  try {
    return def.run(host, n);
  } catch (e) {
    return e instanceof Error ? e.message : "The action could not run.";
  }
}
