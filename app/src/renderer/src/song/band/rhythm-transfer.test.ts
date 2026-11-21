import { expect, it } from "vitest";
import { recordRhythmExport, confirmRhythmTransfer, rhythmTransferStatus } from "./rhythm-transfer";
const song = () => ({
  ":bpm": "140",
  ":options": JSON.stringify({ firstBeat: 0, beats: 4, rhythmExport: { version: 1, bpm: 140, meter: "4/4" }, mix: { drums: { mute: false } } }),
});
function exported() {
  const settings = song();
  const options = JSON.parse(settings[":options"]);
  settings[":options"] = JSON.stringify({ ...options, rhythmTransfer: recordRhythmExport(settings, "export-one") });
  return settings;
}
it("requires export, then explicit confirmation tied to memory and User rhythm", () => {
  const settings = song();
  expect(rhythmTransferStatus(settings, 1)).toBe("Needs export");
  const saved = exported();
  expect(rhythmTransferStatus(saved, 1)).toBe("Needs transfer confirmation");
  saved[":options"] = JSON.stringify({ ...JSON.parse(saved[":options"]), rhythmTransfer: confirmRhythmTransfer(saved, 1, 8) });
  expect(rhythmTransferStatus(saved, 1)).toBe("Transfer confirmed");
  expect(rhythmTransferStatus(saved, 2)).toBe("Needs transfer confirmation");
  expect(() => confirmRhythmTransfer(saved, 1, 51)).toThrow("1–50");
});
it("invalidates musical edits and a new export, but keeps confirmation through mix and trim-only edits", () => {
  const settings = exported();
  const record = confirmRhythmTransfer(settings, 1, 8);
  settings[":options"] = JSON.stringify({ ...JSON.parse(settings[":options"]), rhythmTransfer: record, mix: { drums: { mute: true } }, trimStart: 2 });
  expect(rhythmTransferStatus(settings, 1)).toBe("Transfer confirmed");
  settings[":bpm"] = "100";
  expect(rhythmTransferStatus(settings, 1)).toBe("Needs export");
  expect(() => confirmRhythmTransfer(settings, 1, 8)).toThrow("Export");
  settings[":bpm"] = "140";
  settings[":options"] = JSON.stringify({ ...JSON.parse(settings[":options"]), rhythmTransfer: recordRhythmExport(settings, "export-two") });
  expect(rhythmTransferStatus(settings, 1)).toBe("Needs transfer confirmation");
});
