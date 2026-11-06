import { describe, expect, it, vi } from "vitest";
import type { AudienceClock, AudienceModel, AudienceUpdate } from "@shared/audience";
import {
  AudienceFeed,
  AudienceSync,
  audienceBlank,
  audienceIndex,
  audienceModel,
  audienceNextLine,
  audienceTime,
  type AudienceSongInput,
  type ClockSample,
} from "./audience";

const settings = { showChords: true, fontScale: 1, rotation: 0 as const, blackout: false, blackBetweenSongs: false };

const chart = ["[00:01.00]Harbour [G]lights", "[00:05.00]# Chorus", "[00:06.00]Shine on [C]me", "[00:08.00]// a note", "[00:09.00]Last [N]line"].join("\n");

const song = (patch: Partial<AudienceSongInput> = {}): AudienceSongInput => ({
  songKey: "song-1",
  title: "Harbour Lights",
  nextTitle: "Kitchen Table",
  chart,
  lyrics: "",
  chords: [],
  macros: [],
  shift: 0,
  pdf: null,
  ...patch,
});

describe("audienceModel", () => {
  it("shows the logo while no song is on", () => {
    const model = audienceModel(null, settings);
    expect(model).toMatchObject({ screen: "logo", songKey: null, lines: [], timed: false, title: "" });
  });

  it("turns a timed chart into lines with transposed chords and the reader's heading rule", () => {
    const model = audienceModel(song({ shift: 2 }), settings);
    expect(model.screen).toBe("lyrics");
    expect(model.timed).toBe(true);
    expect(model.title).toBe("Harbour Lights");
    expect(model.nextTitle).toBe("Kitchen Table");
    expect(model.lines[0]).toEqual({ time: 1, heading: null, text: "Harbour lights", chords: ["A"] });
    // A chord held from the line before is carried onto the next line, as the reader does.
    expect(model.lines[1]).toEqual({ time: 5, heading: "Chorus", text: "", chords: ["A"] });
    expect(model.lines[2]).toEqual({ time: 6, heading: null, text: "Shine on me", chords: ["D"] });
    // The comment is not shown, and an N chord is not a name to show.
    expect(model.lines.find((line) => line.text.includes("a note"))).toBeUndefined();
    expect(model.lines[model.lines.length - 1]).toEqual({ time: 9, heading: null, text: "Last line", chords: [] });
  });

  it("drops the chord names when the audience does not show chords, not from the text", () => {
    const model = audienceModel(song(), { ...settings, showChords: false });
    expect(model.showChords).toBe(false);
    expect(model.lines[0].text).toBe("Harbour lights");
  });

  it("marks an untimed chart as untimed, with no times", () => {
    const model = audienceModel(song({ chart: "Verse one\nVerse two" }), settings);
    expect(model.timed).toBe(false);
    expect(model.lines.every((line) => line.time === null)).toBe(true);
    expect(audienceIndex(model, { songKey: "song-1", songPosition: 3, at: 0, rate: 1, playing: true }, 0)).toBe(-1);
  });

  it("shows the PDF screen with its page when the PDF is the chart on screen", () => {
    const model = audienceModel(song({ pdf: { url: "app://library/r1/chart.pdf", page: 2.7 } }), settings);
    expect(model.screen).toBe("pdf");
    expect(model.pdf).toEqual({ url: "app://library/r1/chart.pdf", page: 2 });
  });

  it("keeps the font size inside the audience range and passes the rotation and blackout on", () => {
    expect(audienceModel(song(), { ...settings, fontScale: 9 }).fontScale).toBe(2);
    expect(audienceModel(song(), { ...settings, fontScale: 0.1 }).fontScale).toBe(0.5);
    expect(audienceModel(song(), { ...settings, rotation: 90, blackout: true })).toMatchObject({ rotation: 90, blackout: true });
  });

  it("is the same model for the same inputs, so an unchanged song is not sent again", () => {
    expect(audienceModel(song(), settings)).toEqual(audienceModel(song(), settings));
  });
});

describe("the audience clock", () => {
  const clock: AudienceClock = { songKey: "song-1", songPosition: 10, at: 1000, rate: 1, playing: true };

  it("runs on from the snapshot while playing, at the snapshot's rate", () => {
    expect(audienceTime(clock, 1000)).toBe(10);
    expect(audienceTime(clock, 3000)).toBe(12);
    expect(audienceTime({ ...clock, rate: 0.5 }, 3000)).toBe(11);
  });

  it("holds still while paused, and never goes below zero", () => {
    expect(audienceTime({ ...clock, playing: false }, 9000)).toBe(10);
    expect(audienceTime({ ...clock, songPosition: 0, at: 5000 }, 1000)).toBe(0);
  });

  it("shows the last timed line that has started, and the next line with words after it", () => {
    const model: AudienceModel = audienceModel(song(), settings);
    expect(audienceIndex(model, { ...clock, songPosition: 0, playing: false }, 0)).toBe(-1);
    expect(audienceIndex(model, { ...clock, songPosition: 5.5, playing: false }, 0)).toBe(1);
    const index = audienceIndex(model, { ...clock, songPosition: 5.5, playing: false }, 0);
    expect(audienceNextLine(model, index)?.text).toBe("Shine on me");
    expect(audienceNextLine(model, model.lines.length - 1)).toBeNull();
  });
});

describe("AudienceSync", () => {
  const sample = (patch: Partial<ClockSample> = {}): ClockSample => ({ songKey: "song-1", position: 10, playing: true, rate: 1, ...patch });

  it("sends the first sample, then nothing while the audience's clock agrees", () => {
    const sync = new AudienceSync();
    expect(sync.next(sample(), 1000)).not.toBeNull();
    expect(sync.next(sample({ position: 10.05 }), 1100)).toBeNull();
    expect(sync.next(sample({ position: 10.1 }), 1200)).toBeNull();
  });

  it("resyncs once a second while playing, and not while paused", () => {
    const sync = new AudienceSync();
    sync.next(sample(), 1000);
    expect(sync.next(sample({ position: 11 }), 1999)).toBeNull();
    expect(sync.next(sample({ position: 12 }), 2000)).toMatchObject({ songPosition: 12, at: 2000, playing: true });
    sync.next(sample({ playing: false }), 2100);
    expect(sync.next(sample({ playing: false }), 9000)).toBeNull();
  });

  it("resyncs on a seek, a jump and a loop: a position off the audience's clock", () => {
    const sync = new AudienceSync();
    sync.next(sample(), 1000);
    // A seek forwards, a jump back at a loop's end.
    expect(sync.next(sample({ position: 40 }), 1100)).toMatchObject({ songPosition: 40 });
    expect(sync.next(sample({ position: 12 }), 1200)).toMatchObject({ songPosition: 12 });
  });

  it("resyncs on play and pause, and on a speed swap", () => {
    const sync = new AudienceSync();
    sync.next(sample({ playing: false }), 1000);
    expect(sync.next(sample({ playing: true }), 1010)).not.toBeNull();
    expect(sync.next(sample({ rate: 0.9 }), 1100)).toMatchObject({ rate: 0.9 });
    expect(sync.next(sample({ rate: 0.9, playing: false }), 1200)).toMatchObject({ playing: false });
  });

  it("resyncs on a song change, including the hand-over of a gapless next song", () => {
    const sync = new AudienceSync();
    sync.next(sample(), 1000);
    expect(sync.next(sample({ songKey: "song-2", position: 0 }), 1020)).toMatchObject({ songKey: "song-2", songPosition: 0 });
    // The hand-over starts the next song with its own position, and it is one snapshot, not one per frame.
    expect(sync.next(sample({ songKey: "song-2", position: 0.01 }), 1036)).toBeNull();
  });

  it("does not send a snapshot for every frame, even while playing", () => {
    const sync = new AudienceSync();
    let sent = 0;
    for (let frame = 0; frame < 600; frame++) {
      const now = 1000 + frame * (1000 / 60);
      if (sync.next(sample({ position: 10 + (now - 1000) / 1000 }), now)) sent++;
    }
    // Ten seconds of 60 fps frames: the first snapshot plus one per second.
    expect(sent).toBeLessThanOrEqual(12);
  });
});

describe("AudienceFeed", () => {
  const model = audienceModel(song(), settings);
  const sample = (patch: Partial<ClockSample> = {}): ClockSample => ({ songKey: "song-1", position: 1, playing: true, rate: 1, ...patch });

  it("sends a model once, and sends it again only when its content changes", () => {
    const send = vi.fn<(update: AudienceUpdate) => void>();
    const feed = new AudienceFeed(send, () => 1000);
    feed.update(sample(), model);
    feed.update(sample(), { ...model });
    expect(send.mock.calls[0][0].model).toEqual(model);
    expect(send.mock.calls.filter(([update]) => update.model !== null)).toHaveLength(1);
    feed.update(sample(), audienceModel(song(), { ...settings, fontScale: 1.5 }));
    expect(send.mock.calls.at(-1)?.[0].model?.fontScale).toBe(1.5);
  });

  it("sends a clock only when the clock needs it, and leaves the model out of that message", () => {
    const send = vi.fn<(update: AudienceUpdate) => void>();
    let now = 1000;
    const feed = new AudienceFeed(send, () => now);
    feed.update(sample(), model);
    send.mockClear();
    now = 1100;
    feed.update(sample({ position: 1.1 }), null);
    expect(send).not.toHaveBeenCalled();
    now = 1200;
    feed.update(sample({ position: 5 }), null);
    expect(send).toHaveBeenCalledWith({ model: null, clock: expect.objectContaining({ songPosition: 5, at: 1200, playing: true }) });
  });

  it("stops the audience's clock where the song is when the performance screen goes", () => {
    const send = vi.fn<(update: AudienceUpdate) => void>();
    let now = 1000;
    const feed = new AudienceFeed(send, () => now);
    feed.update(sample({ position: 30 }), model);
    now = 1500;
    feed.stop();
    expect(send).toHaveBeenLastCalledWith({ model: null, clock: { songKey: "song-1", songPosition: 30, at: 1500, rate: 1, playing: false } });
  });
});

describe("audienceBlank", () => {
  const on = audienceModel(song(), { ...settings, blackBetweenSongs: true });
  const stopped = (songPosition: number): AudienceClock => ({ songKey: "song-1", songPosition, at: 0, rate: 1, playing: false });

  it("is black for a blackout, and before the first update", () => {
    expect(audienceBlank(audienceModel(song(), { ...settings, blackout: true }), null)).toBe(true);
    expect(audienceBlank(null, null)).toBe(true);
  });

  it("is black between songs while the song is stopped at its start, and not once it plays or has moved", () => {
    expect(audienceBlank(on, stopped(0))).toBe(true);
    expect(audienceBlank(on, null)).toBe(true);
    expect(audienceBlank(on, { ...stopped(0), playing: true })).toBe(false);
    expect(audienceBlank(on, stopped(3))).toBe(false);
  });

  it("is never black between songs unless the option is on", () => {
    expect(audienceBlank(audienceModel(song(), settings), stopped(0))).toBe(false);
  });
});
