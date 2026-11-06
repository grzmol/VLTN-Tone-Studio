import { describe, expect, it, vi } from "vitest";
import { ACTION_IDS, ACTIONS, actionLabel, isActionId, runAction, type ActionHost } from "./actions";

/** A host whose every method records its call and returns no hint, so each test can see what ran. */
function recordingHost(pdf = false): ActionHost & { calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const names: (keyof ActionHost)[] = [
    "play",
    "playPause",
    "stop",
    "playFromStart",
    "panic",
    "nextSong",
    "previousSong",
    "selectSong",
    "crossfade",
    "nextSection",
    "previousSection",
    "armSection",
    "jumpSection",
    "toggleSectionLoop",
    "exitSectionLoop",
    "cancelSectionJump",
    "arm",
    "disarm",
    "scrollLyrics",
    "pdfOnScreen",
    "fontSize",
    "toggleStage",
    "muteGroup",
    "toggleClick",
    "tap",
    "speed",
  ];
  const host = { calls } as unknown as ActionHost & { calls: [string, ...unknown[]][] };
  for (const name of names) {
    (host as unknown as Record<string, (...args: unknown[]) => void>)[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  }
  // A PDF on screen answers the question; the rest of the host records the call and returns nothing.
  host.pdfOnScreen = () => {
    calls.push(["pdfOnScreen"]);
    return pdf;
  };
  return host;
}

describe("the action registry", () => {
  it("names every action and gives each a group", () => {
    for (const id of ACTION_IDS) {
      expect(ACTIONS[id].label.length).toBeGreaterThan(0);
      expect(ACTIONS[id].group.length).toBeGreaterThan(0);
    }
  });

  it("covers the actions the spec lists", () => {
    for (const id of [
      "transport.play",
      "transport.playPause",
      "transport.stop",
      "transport.playFromStart",
      "transport.panic",
      "song.next",
      "song.previous",
      "song.select",
      "song.crossfade",
      "section.next",
      "section.previous",
      "section.arm",
      "section.jump",
      "section.toggleLoop",
      "section.exitLoop",
      "section.cancelJump",
      "view.scrollUp",
      "view.scrollDown",
      "view.pageUp",
      "view.pageDown",
      "view.fontLarger",
      "view.fontSmaller",
      "view.stage",
      "mix.muteGroup",
      "mix.click",
      "mix.drums",
      "mix.bass",
      "tempo.tap",
      "speed.up",
      "speed.down",
      "speed.reset",
      "midi.arm",
      "midi.disarm",
    ]) {
      expect(isActionId(id), id).toBe(true);
    }
  });

  it("recognises only registry ids", () => {
    expect(isActionId("transport.play")).toBe(true);
    expect(isActionId("toString")).toBe(false);
    expect(isActionId("__proto__")).toBe(false);
    expect(isActionId(42)).toBe(false);
  });

  it("labels a numbered action with its number", () => {
    expect(actionLabel("section.jump", 3)).toBe("Jump to section now 3");
    expect(actionLabel("transport.stop")).toBe("Stop");
  });
});

describe("runAction", () => {
  it("runs each action on the matching host method", () => {
    const host = recordingHost();
    runAction({ action: "transport.play" }, host);
    runAction({ action: "transport.panic" }, host);
    runAction({ action: "section.next" }, host);
    runAction({ action: "view.scrollDown" }, host);
    runAction({ action: "view.pageUp" }, host);
    runAction({ action: "speed.reset" }, host);
    expect(host.calls).toEqual([["play"], ["panic"], ["nextSection"], ["scrollLyrics", 1, false], ["scrollLyrics", -1, true], ["speed", "reset"]]);
  });

  it("turns a PDF page with the default section keys while a PDF is on screen, and goes to the section otherwise", () => {
    const withPdf = recordingHost(true);
    runAction({ action: "section.nextOrPage" }, withPdf);
    runAction({ action: "section.previousOrPage" }, withPdf);
    expect(withPdf.calls).toEqual([["pdfOnScreen"], ["scrollLyrics", 1, true], ["pdfOnScreen"], ["scrollLyrics", -1, true]]);
    const without = recordingHost(false);
    runAction({ action: "section.nextOrPage" }, without);
    runAction({ action: "section.previousOrPage" }, without);
    expect(without.calls).toEqual([["pdfOnScreen"], ["nextSection"], ["pdfOnScreen"], ["previousSection"]]);
  });

  it("never turns a page for a section action the performer chose, even with a PDF on screen", () => {
    const host = recordingHost(true);
    runAction({ action: "section.next" }, host);
    runAction({ action: "section.previous" }, host);
    expect(host.calls).toEqual([["nextSection"], ["previousSection"]]);
  });

  it("passes the number of a numbered action", () => {
    const host = recordingHost();
    runAction({ action: "section.jump", index: 4 }, host);
    runAction({ action: "mix.muteGroup", index: 6 }, host);
    expect(host.calls).toEqual([
      ["jumpSection", 4],
      ["muteGroup", 6],
    ]);
  });

  it("does nothing, and says so, when a numbered action has no usable number", () => {
    const host = recordingHost();
    expect(runAction({ action: "section.jump" }, host)).toBe("Section must be between 1 and 64.");
    expect(runAction({ action: "mix.muteGroup", index: 7 }, host)).toBe("Mute group must be between 1 and 6.");
    expect(runAction({ action: "song.select", index: 1.5 }, host)).toBe("Song must be between 1 and 99.");
    expect(host.calls).toEqual([]);
  });

  it("returns a hint from the host, so the performer sees why nothing happened", () => {
    const host = { ...recordingHost(), nextSection: () => "This song has no sections." };
    expect(runAction({ action: "section.next" }, host)).toBe("This song has no sections.");
  });

  it("never throws on an unknown action or a host that throws", () => {
    const host = recordingHost();
    expect(runAction({ action: "not.an.action" }, host)).toBe("This binding's action is no longer available.");
    const broken = {
      ...recordingHost(),
      play: () => {
        throw new Error("Audio is busy.");
      },
    };
    expect(runAction({ action: "transport.play" }, broken)).toBe("Audio is busy.");
    const odd = {
      ...recordingHost(),
      stop: () => {
        throw "not an error";
      },
    };
    expect(runAction({ action: "transport.stop" }, odd)).toBe("The action could not run.");
  });

  it("leaves the host alone when the binding's action is unknown", () => {
    const spy = vi.fn();
    const host = { ...recordingHost(), play: spy };
    runAction({ action: "constructor" }, host);
    expect(spy).not.toHaveBeenCalled();
  });
});
