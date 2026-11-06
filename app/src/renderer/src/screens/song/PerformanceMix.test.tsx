import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mix } from "@/song/stems/mix";
import type { Stems, PcmAudio } from "@/song/types";
import type { TrackInfo } from "@/song/tracks";
import { ORIGINAL_PARTS, type PartChoices } from "@/song/band/part-choice";
import { usePracticeMute } from "@/song/performance/practice-mute";
import { PerformanceMix } from "./PerformanceMix";

const mocks = vi.hoisted(() => ({ names: [] as string[], speed: { followsPitch: {}, rate: 1 } as Record<string, unknown> }));
vi.mock("@/song/performance/session", () => ({
  useSession: (_session: unknown, select: (state: unknown) => unknown) => select({ player: { names: mocks.names }, speed: mocks.speed }),
}));

const pcm = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4)] });
const session = { setSpeed: vi.fn() } as never;
const mix: Mix = {};

/** A split song with drums and bass, and a generated drums and bass track each. */
const split = () => {
  mocks.names = ["drums", "bass", "track1", "track2"];
  const stems = { drums: pcm(), bass: pcm() } as Stems;
  const tracks: Record<string, TrackInfo> = {
    drums: { kind: "stem", name: "drums" },
    bass: { kind: "stem", name: "bass" },
    track1: { kind: "user", name: "Drums (generated)" },
    track2: { kind: "user", name: "Bass (generated)" },
  };
  return { stems, tracks };
};

function renderMix(partChoices: PartChoices) {
  const { stems, tracks } = split();
  return render(
    <PerformanceMix
      session={session}
      stems={stems}
      tracks={tracks}
      mix={mix}
      onMix={vi.fn()}
      trackBuses={{}}
      onTrackBus={vi.fn()}
      onTrackInfo={vi.fn()}
      partChoices={partChoices}
    />,
  );
}

afterEach(cleanup);

describe("PerformanceMix: what plays", () => {
  it("marks the original drums as off when the generated drums play", () => {
    renderMix({ drums: "generated", bass: "original" });
    expect(within(screen.getByRole("group", { name: "Drums" })).getByText("Off: generated plays")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Drums (generated)" })).queryByText(/^Off:/)).toBeNull();
    expect(within(screen.getByRole("group", { name: "Bass" })).queryByText(/^Off:/)).toBeNull();
  });

  it("marks the generated bass as off when the original bass plays", () => {
    renderMix({ drums: "original", bass: "original" });
    expect(within(screen.getByRole("group", { name: "Bass (generated)" })).getByText("Off: original plays")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Drums (generated)" })).getByText("Off: original plays")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Bass" })).queryByText(/^Off:/)).toBeNull();
  });

  it("marks nothing when both play", () => {
    renderMix({ drums: "both", bass: "both" });
    expect(screen.queryByText(/^Off:/)).toBeNull();
  });

  it("names the split stems as the Stems tab does, not in lower case", () => {
    renderMix(ORIGINAL_PARTS);
    expect(screen.getByRole("group", { name: "Drums" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Bass" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "drums" })).toBeNull();
  });

  it("keeps each row's mute checkbox in its state, since the badge does not change the mute levels", () => {
    renderMix({ drums: "generated", bass: "original" });
    expect((screen.getByLabelText("Drums enabled") as HTMLInputElement).checked).toBe(true);
  });

  it("puts every row in one grid, so the columns line up, and offers mute groups only on user tracks", () => {
    renderMix(ORIGINAL_PARTS);
    const rows = screen.getByLabelText("Mixer rows");
    expect(rows.className).toContain("grid-cols-[");
    expect(rows.children).toHaveLength(4);
    for (const row of Array.from(rows.children)) expect(row.className).toContain("grid-cols-subgrid");
    expect(screen.queryByRole("group", { name: "Drums mute groups" })).toBeNull();
    expect(screen.getByRole("group", { name: "Drums (generated) mute groups" })).toBeTruthy();
  });
});

describe("PerformanceMix: practice mute", () => {
  afterEach(() => usePracticeMute.getState().clear());

  it("marks the drums rows as muted by the practice mute, and not the bass", () => {
    usePracticeMute.getState().set("drums", true);
    renderMix(ORIGINAL_PARTS);
    for (const name of ["Drums", "Drums (generated)"]) {
      const row = within(screen.getByRole("group", { name }));
      expect(row.getByText("Practice")).toBeTruthy();
      expect((row.getByLabelText(`${name} enabled`) as HTMLInputElement).checked).toBe(false);
    }
    expect(within(screen.getByRole("group", { name: "Bass" })).queryByText("Practice")).toBeNull();
  });

  it("turns that kind's practice mute off when its row is unmuted, and leaves the song's mix alone", () => {
    usePracticeMute.getState().set("drums", true);
    usePracticeMute.getState().set("bass", true);
    const onMix = vi.fn();
    const { stems, tracks } = split();
    render(
      <PerformanceMix session={session} stems={stems} tracks={tracks} mix={mix} onMix={onMix} trackBuses={{}} onTrackBus={vi.fn()} onTrackInfo={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Drums enabled"));
    expect(usePracticeMute.getState().kinds).toEqual(["bass"]);
    expect(onMix).not.toHaveBeenCalled();
  });

  it("lets an imported track choose what it counts as", () => {
    const onCountsAs = vi.fn();
    const { stems, tracks } = split();
    render(
      <PerformanceMix
        session={session}
        stems={stems}
        tracks={tracks}
        mix={mix}
        onMix={vi.fn()}
        trackBuses={{}}
        onTrackBus={vi.fn()}
        onTrackInfo={vi.fn()}
        onCountsAs={onCountsAs}
      />,
    );
    fireEvent.change(screen.getByLabelText("Drums (generated) counts as"), { target: { value: "none" } });
    expect(onCountsAs).toHaveBeenCalledWith("track1", "none");
  });
});
