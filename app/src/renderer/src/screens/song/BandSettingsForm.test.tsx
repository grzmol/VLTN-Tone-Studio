import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BAND_SETTINGS, type BandSettings } from "@/song/band/arrangement";
import { Slider } from "@/components/ui/slider";
import { BandSettingsForm } from "./BandSettingsForm";

// jsdom has no layout: the Radix slider measures with this.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The track element of a band slider, found from its root (the slider carries the aria-label). */
function trackOf(container: HTMLElement, label: string): HTMLElement {
  const root = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  const track = root?.querySelector<HTMLElement>('[data-slot="slider-track"]');
  if (!track) throw new Error(`no track for ${label}`);
  return track;
}

function renderWith(settings: BandSettings) {
  return render(<BandSettingsForm settings={settings} followSources={["auto", "mix"]} onChange={vi.fn()} onStyle={vi.fn()} />);
}

describe("Band sliders", () => {
  it("show their full track at zero, as at any other value", () => {
    const zero: BandSettings = { ...DEFAULT_BAND_SETTINGS, swing: 0, complexity: 0, humanise: { ...DEFAULT_BAND_SETTINGS.humanise, amount: 0 } };
    const full: BandSettings = { ...DEFAULT_BAND_SETTINGS, swing: 0.75, complexity: 1, humanise: { ...DEFAULT_BAND_SETTINGS.humanise, amount: 1 } };
    for (const settings of [zero, full]) {
      const { container, unmount } = renderWith(settings);
      for (const label of ["Swing", "Complexity", "Humanise"]) {
        expect(trackOf(container, label).className).toContain("bg-white/15");
      }
      unmount();
    }
  });

  it("leaves the shared slider's track as the theme's, for every other slider", () => {
    const { container } = render(<Slider aria-label="Plain" min={0} max={100} value={[0]} />);
    const track = container.querySelector<HTMLElement>('[data-slot="slider-track"]');
    expect(track?.className).toContain("bg-muted");
    expect(track?.className).not.toContain("bg-white/15");
  });
});

describe("Bass notes from", () => {
  it("shows the original bass, the default, as the choice", () => {
    const { container } = renderWith(DEFAULT_BAND_SETTINGS);
    expect(container.querySelector('[aria-label="Bass notes from"]')?.textContent).toContain("Original bass");
  });

  it("shows chords when the song takes its bass from the chords", () => {
    const { container } = renderWith({ ...DEFAULT_BAND_SETTINGS, bassFrom: "chords" });
    expect(container.querySelector('[aria-label="Bass notes from"]')?.textContent).toContain("Chords");
  });
});
