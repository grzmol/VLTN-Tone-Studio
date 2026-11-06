import { describe, expect, it } from "vitest";
import { HostError } from "./ipc";
import { mergeAudienceState, parseAudienceUpdate, type AudienceModel } from "./audience";

const model = (patch: Partial<AudienceModel> = {}): AudienceModel => ({
  songKey: "song-1",
  screen: "lyrics",
  blackout: false,
  blackBetweenSongs: false,
  title: "Harbour Lights",
  nextTitle: "Kitchen Table",
  timed: true,
  lines: [{ time: 1.5, heading: null, text: "Ready to go", chords: ["G", "C"] }],
  showChords: true,
  fontScale: 1,
  rotation: 0,
  pdf: null,
  ...patch,
});

const clock = { songKey: "song-1", songPosition: 12.5, at: 1_700_000_000_000, rate: 1, playing: true };

describe("parseAudienceUpdate", () => {
  it("accepts a full update and a clock-only update", () => {
    expect(parseAudienceUpdate({ model: model(), clock })).toEqual({ model: model(), clock });
    expect(parseAudienceUpdate({ model: null, clock })).toEqual({ model: null, clock });
    expect(parseAudienceUpdate({ model: model(), clock: null })).toEqual({ model: model(), clock: null });
  });

  it("accepts a PDF page from the song library and from a blob address", () => {
    expect(parseAudienceUpdate({ model: model({ screen: "pdf", pdf: { url: "app://library/abc/chart.pdf", page: 3 } }), clock: null }).model?.pdf).toEqual({
      url: "app://library/abc/chart.pdf",
      page: 3,
    });
    expect(parseAudienceUpdate({ model: model({ pdf: { url: "blob:http://localhost/1", page: 1 } }), clock: null }).model?.pdf?.page).toBe(1);
  });

  it("refuses a PDF address that is not in the song library", () => {
    for (const url of ["file:///etc/passwd", "https://example.com/a.pdf", "app://bundle/index.html", "javascript:alert(1)"]) {
      const bad = { model: model({ pdf: { url, page: 1 } }), clock: null };
      expect(() => parseAudienceUpdate(bad), url).toThrow("song library");
    }
  });

  it("refuses a page outside 1 to 10000", () => {
    expect(() => parseAudienceUpdate({ model: model({ pdf: { url: "app://library/a/chart.pdf", page: 0 } }), clock: null })).toThrow(HostError);
    expect(() => parseAudienceUpdate({ model: model({ pdf: { url: "app://library/a/chart.pdf", page: 10001 } }), clock: null })).toThrow(HostError);
  });

  it("refuses an unknown rotation, screen or font size", () => {
    expect(() => parseAudienceUpdate({ model: model({ rotation: 45 as 0 }), clock: null })).toThrow("rotation");
    expect(() => parseAudienceUpdate({ model: { ...model(), screen: "browser" }, clock: null })).toThrow("screen");
    expect(() => parseAudienceUpdate({ model: model({ fontScale: 9 }), clock: null })).toThrow("font size");
    expect(() => parseAudienceUpdate({ model: model({ fontScale: Number.NaN }), clock: null })).toThrow("font size");
  });

  it("refuses too many lines, chords or a line that is too long", () => {
    const lines = Array.from({ length: 2001 }, () => ({ time: null, heading: null, text: "a", chords: [] }));
    expect(() => parseAudienceUpdate({ model: model({ lines }), clock: null })).toThrow("2000 lines");
    const chords = Array.from({ length: 13 }, () => "C");
    expect(() => parseAudienceUpdate({ model: model({ lines: [{ time: 0, heading: null, text: "", chords }] }), clock: null })).toThrow("chords");
    expect(() => parseAudienceUpdate({ model: model({ lines: [{ time: 0, heading: null, text: "x".repeat(401), chords: [] }] }), clock: null })).toThrow(
      "lyric line",
    );
  });

  it("refuses a clock with a position, rate or time that is not a finite number in range", () => {
    expect(() => parseAudienceUpdate({ model: null, clock: { ...clock, songPosition: -1 } })).toThrow("song position");
    expect(() => parseAudienceUpdate({ model: null, clock: { ...clock, songPosition: Number.POSITIVE_INFINITY } })).toThrow("song position");
    expect(() => parseAudienceUpdate({ model: null, clock: { ...clock, rate: 0 } })).toThrow("playback rate");
    expect(() => parseAudienceUpdate({ model: null, clock: { ...clock, at: "now" } })).toThrow("clock time");
    expect(() => parseAudienceUpdate({ model: null, clock: { ...clock, playing: "yes" } })).toThrow("playing");
  });

  it("refuses anything that is not an object", () => {
    for (const input of [null, "update", 3, []]) expect(() => parseAudienceUpdate(input)).toThrow(HostError);
    expect(() => parseAudienceUpdate({ model: "lyrics", clock: null })).toThrow("the model must be an object");
  });
});

describe("mergeAudienceState", () => {
  it("keeps the model when only the clock changes, and the clock when only the model changes", () => {
    const first = { model: model(), clock };
    const moved = mergeAudienceState(first, { model: null, clock: { ...clock, songPosition: 20 } });
    expect(moved.model).toEqual(model());
    expect(moved.clock?.songPosition).toBe(20);
    const restyled = mergeAudienceState(moved, { model: model({ fontScale: 1.5 }), clock: null });
    expect(restyled.model?.fontScale).toBe(1.5);
    expect(restyled.clock?.songPosition).toBe(20);
  });
});
