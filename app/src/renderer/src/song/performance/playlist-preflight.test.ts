import { expect, it } from "vitest";
import { playlistPreflight } from "./playlist-preflight";
import type { LibraryPreflightSong } from "@shared/song-library";
const config = { tempoOnStart: true, tempoChannel: 16, outputName: "GP-180", pedals: [{ name: "TimeLine", channel: 1 }] };
const saved: LibraryPreflightSong = {
  id: "one",
  errors: [],
  song: {
    id: "one",
    title: "Opening",
    artist: "",
    sourceName: "song",
    duration: 10,
    audio: [{ name: "source", sampleRate: 44100, frames: 441000, channels: 1 }],
    settings: { ":bpm": "120", ":options": '{"tempoSource":"manual","analysis":{"audioId":"x","version":1}}', "": "[00:01] {midi:pc 1 2}" },
    updated: "",
  },
};
it("preserves repeated entries and reports missing songs without changing cues", () => {
  const before = JSON.stringify(saved);
  const result = playlistPreflight(["one", "lost", "one"], [saved], config);
  expect(result.map((r) => r.entry)).toEqual([1, 2, 3]);
  expect(result[1].errors.length).toBe(1);
  expect(result[0].warnings).toEqual([]);
  expect(JSON.stringify(saved)).toBe(before);
});
it("reports malformed charts, incompatible BPM and conflicting clock settings per song", () => {
  const song = { ...saved.song!, settings: { ":bpm": "35", ":options": '{"clock":true}', "": "[00:00] {midi:pc 1}" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.errors.join(" ")).toContain("40–300");
  expect(result.errors.join(" ")).toContain("Chart cannot play");
  expect(result.warnings.join(" ")).toContain("alongside automatic tempo");
});
it("reuses cue/channel warnings and checks actual playback track duration", () => {
  const song = {
    ...saved.song!,
    duration: 999,
    settings: { ":bpm": "120", "": "[00:12] {label:TimeLine: Recall} {midi:pc 2 3}\n[00:00] {midi:note 1 60 100}" },
  };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings.join(" ")).toContain("beyond the 10.00");
  expect(result.warnings.join(" ")).toContain("no later note-off");
});

it("uses the first playback stem in player order, not the longest track or metadata duration", () => {
  const song = {
    ...saved.song!,
    audio: [
      ...saved.song!.audio,
      { name: "vocals", sampleRate: 44100, frames: 882000, channels: 1 },
      { name: "drums", sampleRate: 44100, frames: 220500, channels: 1 },
    ],
    settings: { ":bpm": "120", "": "[00:08] {midi:pc 1 2}" },
  };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings.join(" ")).toContain("beyond the 5.00");
  expect(result.warnings.join(" ")).toContain("different lengths");
});

it("checks the tempo the song plays at, and whether its speed render is ready", () => {
  const song = { ...saved.song!, settings: { ":bpm": "100", ":options": '{"speed":0.7,"tempoSource":"manual","analysis":{}}', "": "" } };
  const [slow] = playlistPreflight(["one"], [{ ...saved, song }], config);
  // 100 BPM at 70% is 70 BPM, which is inside the pedal range, so only the render warns
  expect(slow.errors).toEqual([]);
  const [warned] = playlistPreflight(["one"], [{ ...saved, song }], { ...config, renderReady: () => false });
  expect(warned.warnings.join(" ")).toContain("not rendered in advance");
  const [ready] = playlistPreflight(["one"], [{ ...saved, song }], { ...config, renderReady: () => true });
  expect(ready.warnings.join(" ")).not.toContain("not rendered in advance");
  // The first two songs are warnings, since the first renders as it loads and the second is prepared next; later songs are noted
  const three = [saved, { ...saved, id: "two" }, { ...saved, id: "three" }].map((e) => ({ ...e, song: { ...song } }));
  const checks = playlistPreflight(["one", "two", "three"], three, { ...config, renderReady: () => false });
  expect(checks[0].warnings.join(" ")).toContain("not rendered in advance");
  expect(checks[1].warnings.join(" ")).toContain("not rendered in advance");
  expect(checks[2].warnings).toEqual([]);
  expect(checks[2].notes.join(" ")).toContain("not rendered in advance");
  const fast = { ...saved.song!, settings: { ":bpm": "250", ":options": '{"speed":1.5,"tempoSource":"manual","analysis":{}}', "": "" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song: fast }], config);
  expect(result.errors.join(" ")).toContain("375 BPM");
});

it("refuses a song whose macro is missing, and names the MIDI file when the file is damaged", () => {
  const withSettings = (settings: Record<string, string>) => playlistPreflight(["one"], [{ ...saved, song: { ...saved.song!, settings } }], config)[0];
  expect(withSettings({ ":bpm": "120", "": "[00:01] {midi:$NOPE}" }).errors).toEqual([expect.stringMatching(/^Chart cannot play: Unknown macro \$NOPE/)]);
  const broken = JSON.stringify({ midiFile: { name: "broken.mid", data: btoa("nope") } });
  expect(withSettings({ ":bpm": "120", ":options": broken, "": "[00:01] {midi:pc 1 1}" }).errors).toEqual([
    expect.stringMatching(/^MIDI file cannot play: broken\.mid:/),
  ]);
  const macros = [{ code: "NOPE", label: "Nope", commands: ["pc 1 1"] }];
  const known = { ...saved, song: { ...saved.song!, settings: { ":bpm": "120", "": "[00:01] {midi:$NOPE}" } } };
  expect(playlistPreflight(["one"], [known], { ...config, macros })[0].errors).toEqual([]);
});

it("warns about a playlist song whose MIDI trigger another song shares, or a remote action answers", () => {
  const trigger = { type: "pc" as const, channel: 1, program: 4 };
  const songs = [
    { id: "one", title: "Opening", trigger },
    { id: "two", title: "Second", trigger },
  ];
  const [shared] = playlistPreflight(["one"], [saved], { ...config, songs });
  expect(shared.warnings).toContain("Its MIDI trigger is also used by Second. The first song in the library loads for that message.");
  const bindings = [{ action: "section.next" as const, source: "midi" as const, match: { status: 0xc0, channel: 1, data1: 4 } }];
  const [bound] = playlistPreflight(["one"], [saved], { ...config, songs: [songs[0]], bindings });
  expect(bound.warnings.join(" ")).toContain("A remote action answers its MIDI trigger (Ch 1 · Program 4), so the song does not load from it.");
  // A song with no trigger, or with one nothing else shares, gets no trigger warning.
  expect(playlistPreflight(["one"], [saved], { ...config, songs: [{ id: "one", title: "Opening", trigger: null }] })[0].warnings).toEqual([]);
});

it("warns about a 120 BPM that may be the old default, and about a song not analysed yet", () => {
  const song = { ...saved.song!, settings: { ":bpm": "120", "": "[00:01] {midi:pc 1 2}" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings).toEqual([
    "BPM may be the old 120 default. Open the song to detect it, or confirm the tempo.",
    "Song not analysed yet. Open it once so its tempo, key and parts are worked out.",
  ]);
});

it("does not warn about a 120 BPM the performer set", () => {
  const song = { ...saved.song!, settings: { ":bpm": "120", ":options": '{"tempoSource":"tap","analysis":{}}', "": "[00:01] {midi:pc 1 2}" } };
  const [result] = playlistPreflight(["one"], [{ ...saved, song }], config);
  expect(result.warnings).toEqual([]);
});
