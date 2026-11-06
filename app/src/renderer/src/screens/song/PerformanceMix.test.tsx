import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mix } from "@/song/stems/mix";
import type { Stems, PcmAudio } from "@/song/types";
import type { TrackInfo } from "@/song/tracks";
import { PerformanceMix } from "./PerformanceMix";

const mocks = vi.hoisted(() => ({ names: [] as string[], speed: { followsPitch: {}, rate: 1 } as Record<string, unknown> }));
vi.mock("@/song/performance/session", () => ({
  useSession: (_session: unknown, select: (state: unknown) => unknown) => select({ player: { names: mocks.names }, speed: mocks.speed }),
}));

const pcm = (): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(4)] });
const session = { setSpeed: vi.fn() } as never;
const mix: Mix = {};

/** A split song with drums and bass, and two imported tracks. */
const split = () => {
  mocks.names = ["drums", "bass", "track1", "track2"];
  const stems = { drums: pcm(), bass: pcm() } as Stems;
  const tracks: Record<string, TrackInfo> = {
    drums: { kind: "stem", name: "drums" },
    bass: { kind: "stem", name: "bass" },
    track1: { kind: "user", name: "Backing" },
    track2: { kind: "user", name: "Guide" },
  };
  return { stems, tracks };
};

function renderMix() {
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
    />,
  );
}

afterEach(cleanup);

describe("PerformanceMix", () => {
  it("names the split stems as the Stems tab does, not in lower case", () => {
    renderMix();
    expect(screen.getByRole("group", { name: "Drums" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Bass" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "drums" })).toBeNull();
  });

  it("puts every row in one grid, so the columns line up, and offers mute groups only on user tracks", () => {
    renderMix();
    const rows = screen.getByLabelText("Mixer rows");
    expect(rows.className).toContain("grid-cols-[");
    expect(rows.children).toHaveLength(4);
    for (const row of Array.from(rows.children)) expect(row.className).toContain("grid-cols-subgrid");
    expect(screen.queryByRole("group", { name: "Drums mute groups" })).toBeNull();
    expect(screen.getByRole("group", { name: "Backing mute groups" })).toBeTruthy();
  });
});
