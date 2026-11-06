import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePracticeMute } from "@/song/performance/practice-mute";
import { PracticeMuteBanner, PracticeMuteMenu } from "./PracticeMute";

afterEach(() => {
  cleanup();
  usePracticeMute.getState().clear();
});

describe("PracticeMuteBanner", () => {
  it("shows nothing until a kind is muted, then names it, and hides again when unmuted", () => {
    render(<PracticeMuteBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => usePracticeMute.getState().set("guitar", true));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => usePracticeMute.getState().clear());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says 'Guitar muted in every song' and turns every practice mute off with Unmute", async () => {
    usePracticeMute.getState().set("guitar", true);
    render(<PracticeMuteBanner />);
    expect(screen.getByRole("status").textContent).toContain("Guitar muted in every song");
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(usePracticeMute.getState().kinds).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("adds the song's own note when it has no track for the muted kind", () => {
    usePracticeMute.getState().set("guitar", true);
    render(<PracticeMuteBanner note="This song has no guitar track to mute" />);
    expect(screen.getByRole("status").textContent).toContain("This song has no guitar track to mute");
  });
});

describe("PracticeMuteMenu", () => {
  it("has a checkbox per kind that turns the practice mute on and off", () => {
    render(<PracticeMuteMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Practice mute" }));
    const guitar = screen.getByRole("checkbox", { name: "Mute guitar in every song" });
    fireEvent.click(guitar);
    expect(usePracticeMute.getState().kinds).toEqual(["guitar"]);
    fireEvent.click(guitar);
    expect(usePracticeMute.getState().kinds).toEqual([]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
  });
});
