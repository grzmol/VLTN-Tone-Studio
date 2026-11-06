import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore } from "zustand/vanilla";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);
import { NO_LIVE, type Section } from "@/song/performance/sections";
import { sectionStatus, SectionStrip } from "./SectionStrip";
import type { PerformanceSession, SessionState } from "@/song/performance/session";

const sections: Section[] = [
  { id: "intro", name: "Intro", start: 0, end: 8, mode: "continue" },
  { id: "verse", name: "Verse", start: 8, end: 16, mode: "loop" },
  { id: "chorus", name: "Chorus", start: 16, end: 24, mode: "continue" },
];

function fakeSession(patch: Partial<SessionState> = {}) {
  const store = createStore<Partial<SessionState>>(() => ({ sections, sectionLive: NO_LIVE, sectionNext: null, playing: false, ...patch }));
  const session = {
    store,
    tapSection: vi.fn(),
    jumpSectionNow: vi.fn(),
    toggleSectionLoop: vi.fn(),
    releaseSectionLoop: vi.fn(),
    cancelSectionJump: vi.fn(),
  };
  return session as unknown as PerformanceSession & typeof session;
}

it("says what is armed and where it lands, and what is decided with its time", () => {
  expect(sectionStatus(sections, NO_LIVE, null, 10)).toBe("");
  expect(sectionStatus(sections, { ...NO_LIVE, jump: "chorus" }, null, 10)).toBe(
    "Chorus is armed. It lands at the end of Verse. Tap Cancel jump to stop it.",
  );
  expect(sectionStatus(sections, NO_LIVE, { kind: "jump", target: "chorus", at: 16 }, 14)).toBe("Jumps to Chorus at 0:16 (in 2.0 s).");
  expect(sectionStatus(sections, NO_LIVE, { kind: "pause", target: null, at: 24 }, 22)).toBe("Pauses at 0:24 (in 2.0 s).");
});

it("taps a section to arm it, double-taps to jump now, and offers loop, cancel and save", () => {
  const session = fakeSession({ playing: true, sectionLive: { ...NO_LIVE, jump: "chorus" } });
  const onSave = vi.fn();
  render(<SectionStrip session={session} onSaveDefaults={onSave} />);
  fireEvent.click(screen.getByRole("button", { name: /Chorus/ }));
  expect(session.tapSection).toHaveBeenCalledWith("chorus");
  fireEvent.doubleClick(screen.getByRole("button", { name: /Chorus/ }));
  expect(session.jumpSectionNow).toHaveBeenCalledWith("chorus");
  fireEvent.click(screen.getByText("Cancel jump"));
  expect(session.cancelSectionJump).toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save as default"));
  expect(onSave).toHaveBeenCalled();
});

it("offers Exit loop for a section that loops, and Loop for one that does not", () => {
  const session = fakeSession({ playing: true });
  render(<SectionStrip session={session} />);
  // Position 0 is the intro, which does not loop.
  fireEvent.click(screen.getByText(/Loop Intro/));
  expect(session.toggleSectionLoop).toHaveBeenCalledWith("intro");
  expect(screen.queryByText("Save as default")).toBeNull();
});
