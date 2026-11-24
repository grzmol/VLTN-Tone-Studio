import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmRhythmTransfer, rhythmTransferRecord, rhythmTransferStatus } from "@/song/band/rhythm-transfer";
import { readSettings, setSetting, flushSettings } from "@/song/performance/settings";
import { useSongSettingsRevision } from "@/song/performance/use-song-settings";
/** A file save does not prove what is stored on the pedal. Only the performer can confirm the converter transfer. */
export function RhythmTransferStatus({ songKey, locked = false }: { songKey: string; locked?: boolean }) {
  useSongSettingsRevision(songKey);
  const settings = readSettings(songKey);
  let options: Record<string, unknown> = {};
  try {
    const value = JSON.parse(settings[":options"] || "{}");
    options = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    /* Show Needs export. */
  }
  const automation = options.rhythmAutomation as { memory?: number } | undefined;
  const record = rhythmTransferRecord(settings);
  const [ownMemory, setOwnMemory] = useState(record?.confirmed?.memory ?? 1);
  const [userSlot, setUserSlot] = useState(record?.confirmed?.userSlot ?? 1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const memory = automation?.memory ?? ownMemory;
  const status = rhythmTransferStatus(settings, memory);
  const confirm = async () => {
    setSaving(true);
    setError("");
    try {
      const latest = readSettings(songKey);
      const value = JSON.parse(latest[":options"] || "{}");
      if ((value.rhythmAutomation?.memory ?? ownMemory) !== memory) throw new Error("The pedal memory changed. Check it again before confirming.");
      const rhythmTransfer = confirmRhythmTransfer(latest, memory, userSlot);
      setSetting(songKey, ":options", JSON.stringify({ ...value, rhythmTransfer }));
      await flushSettings();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section aria-label="RC-10R transfer status" className="space-y-2 rounded border border-seam p-3 text-sm">
      <p role="status">
        RC-10R rhythm: {status}
        {status === "Transfer confirmed" ? ` · phrase memory ${memory}, User rhythm ${record?.confirmed?.userSlot}` : ""}.
      </p>
      <p>
        Exported notes are separate from the pedal’s stored rhythm. After Import → Apply in Rhythm Converter, select the User rhythm and save its phrase memory
        on the pedal, then confirm here.
      </p>
      <fieldset disabled={locked || saving || status === "Needs export"} className="flex flex-wrap items-end gap-3">
        <label>
          Phrase memory
          <Input
            className="w-24"
            aria-label="Transferred phrase memory"
            type="number"
            min={1}
            max={99}
            value={memory}
            disabled={!!automation}
            onChange={(e) => setOwnMemory(e.target.valueAsNumber)}
          />
        </label>
        <label>
          User rhythm
          <Input
            className="w-24"
            aria-label="Transferred User rhythm"
            type="number"
            min={1}
            max={50}
            value={Number.isFinite(userSlot) ? userSlot : ""}
            onChange={(e) => setUserSlot(e.target.valueAsNumber)}
          />
        </label>
        <Button variant="outline" onClick={() => void confirm()}>
          Confirm transferred rhythm
        </Button>
      </fieldset>
      <p>Confirmation records your check; the app cannot read back the pedal’s stored rhythm.</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
