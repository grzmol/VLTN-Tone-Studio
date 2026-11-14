import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { host } from "@/host";
import { readOptions, setSetting } from "@/song/performance/settings";
import {
  assembleRhythmPart,
  parseRhythmSetup,
  RHYTHM_LABELS,
  RHYTHM_METERS,
  RHYTHM_ROLES,
  MAX_RHYTHM_BARS,
  rhythmExportFiles,
  rhythmPreview,
  rhythmSources,
  type RhythmMeter,
  type RhythmRole,
  type RhythmSetup,
  type RhythmSnapshot,
} from "@/song/band/rhythm-export";
import { currentRhythmAutomation } from "@/song/performance/rhythm-automation";
import { recordRhythmExport } from "@/song/band/rhythm-transfer";
import { readSettings } from "@/song/performance/settings";
import { RhythmTransferStatus } from "./RhythmTransferStatus";
import { playRhythmPreview } from "@/song/band/rhythm-preview";

interface RhythmExportDialogProps {
  snapshot: RhythmSnapshot;
  songKey: string;
  disabled: boolean;
  onClose(): void;
}

/** A setup is kept separately from generation settings, so export choices do not invalidate the song's generated audio. */
export function RhythmExportDialog({ snapshot, songKey, disabled, onClose }: RhythmExportDialogProps) {
  const [setup, setSetup] = useState(() => {
    const setup = parseRhythmSetup(readOptions<Record<string, unknown>>(songKey, {}).rhythmExport, snapshot);
    const plan = currentRhythmAutomation({ key: songKey, title: snapshot.name, duration: snapshot.duration, settings: readSettings(songKey) });
    if (plan) setup.bpm = plan.draft.bpm / RHYTHM_METERS[setup.meter].quarters;
    return setup;
  });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<RhythmRole | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  const previewRequest = useRef(0);
  const mounted = useRef(true);
  const stopCurrentPreview = () => {
    previewRequest.current++;
    const stop = stopPreview.current;
    stopPreview.current = null;
    stop?.();
    if (mounted.current) setPreviewing(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopCurrentPreview();
    };
  }, []);
  useEffect(() => {
    if (disabled) {
      stopCurrentPreview();
    }
  }, [disabled]);
  const sources = useMemo(() => rhythmSources(snapshot), [snapshot]);
  const rows = RHYTHM_ROLES.map((role) => {
    try {
      return { role, part: assembleRhythmPart(snapshot, setup, role), error: "" };
    } catch (error) {
      return { role, part: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const blocked = disabled || saving;

  const update = (next: RhythmSetup) => {
    stopCurrentPreview();
    setSetup(next);
    setMessage("");
    if (!Number.isFinite(next.bpm)) return;
    try {
      setSetting(songKey, ":options", JSON.stringify({ ...readOptions<Record<string, unknown>>(songKey, {}), rhythmExport: next }));
    } catch (error) {
      setMessage(`Could not save these choices: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const edit = (role: RhythmRole, patch: Partial<RhythmSetup["parts"][RhythmRole]>) =>
    update({
      ...setup,
      parts: { ...setup.parts, [role]: { ...setup.parts[role], ...patch } },
    });
  const preview = async (role: RhythmRole) => {
    stopCurrentPreview();
    const request = ++previewRequest.current;
    setMessage("");
    try {
      const audio = rhythmPreview(assembleRhythmPart(snapshot, setup, role), setup);
      setPreviewing(role);
      const playing = playRhythmPreview(audio.notes, audio.duration, () => {
        if (mounted.current && previewRequest.current === request) {
          setPreviewing(null);
          stopPreview.current = null;
        }
      });
      stopPreview.current = playing.stop;
      await playing.ready;
    } catch (error) {
      if (mounted.current && previewRequest.current === request) {
        setPreviewing(null);
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
  };
  const exportFiles = async () => {
    stopCurrentPreview();
    setSaving(true);
    setMessage("");
    try {
      const startingOptions = { ...readOptions<Record<string, unknown>>(songKey, {}), rhythmExport: setup };
      const exported = recordRhythmExport({ ...readSettings(songKey), ":options": JSON.stringify(startingOptions) });
      const where = await host.song.saveFiles(rhythmExportFiles(snapshot, setup), "Export BOSS RC-10R rhythm");
      if (where) {
        const value = { ...readOptions<Record<string, unknown>>(songKey, {}), rhythmExport: setup };
        setSetting(songKey, ":options", JSON.stringify({ ...value, rhythmTransfer: exported }));
      }
      if (mounted.current) setMessage(where ? "Saved the RC0 rhythm, MIDI and import guide." : "Export cancelled. Your choices are kept.");
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  let startBar = 1;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl"
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Export for BOSS RC-10R</DialogTitle>
          <DialogDescription>
            Choose six reusable drum passages. Export a complete RC0 rhythm with all six assignments, plus a MIDI file and import guide.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              Meter
              <Select value={setup.meter} disabled={blocked} onValueChange={(value) => update({ ...setup, meter: value as RhythmMeter })}>
                <SelectTrigger aria-label="Export meter" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(RHYTHM_METERS).map((meter) => (
                    <SelectItem key={meter} value={meter}>
                      {meter}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              {setup.meter === "6/8" ? "Dotted-quarter BPM" : "BPM"}
              <Input
                aria-label="Export BPM"
                type="number"
                min={40}
                max={350}
                step="any"
                className="w-28"
                disabled={blocked}
                value={Number.isFinite(setup.bpm) ? setup.bpm : ""}
                onChange={(event) => update({ ...setup, bpm: event.target.valueAsNumber })}
              />
            </label>
          </div>
          <p className="text-muted-foreground">
            One steady tempo, with the selected notes’ swing and velocities. First bar counts within the chosen source; MIDI bar counts within the exported
            file.
          </p>
          {setup.meter === "6/8" && <p>6/8 uses two dotted-quarter grid beats per bar. Check this meter in your converter on the first import.</p>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="text-muted-foreground">
                <tr>
                  {["Part", "Source", "First bar", "Bars", "MIDI bar", "Listen"].map((text) => (
                    <th key={text} className="p-2 font-normal">
                      {text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ role, part, error }) => {
                  const selection = setup.parts[role],
                    label = RHYTHM_LABELS[role],
                    exportedBar = startBar;
                  startBar += selection.bars;
                  return (
                    <tr key={role} className="border-t border-seam align-top">
                      <th scope="row" className="p-2 font-medium">
                        {label}
                      </th>
                      <td className="max-w-64 p-2">
                        <Select
                          value={selection.source ?? "unassigned"}
                          disabled={blocked}
                          onValueChange={(value) => {
                            const available = sources.find((source) => source.id === value)?.bars.length ?? 1;
                            edit(role, { source: value === "unassigned" ? null : value, firstBar: 1, bars: Math.min(selection.bars, available) });
                          }}
                        >
                          <SelectTrigger aria-label={`${label} source`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Choose a passage</SelectItem>
                            {sources.map((source) => (
                              <SelectItem key={source.id} value={source.id} disabled={!source.bars.length}>
                                {source.name} ({source.bars.length} bars)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {error && <p className="mt-1 text-xs text-led-warn">{error}</p>}
                        {part?.warnings.map((warning) => (
                          <p key={warning} className="mt-1 text-xs text-muted-foreground">
                            {warning}
                          </p>
                        ))}
                      </td>
                      <td className="w-24 p-2">
                        <Input
                          aria-label={`${label} first bar`}
                          type="number"
                          min={1}
                          disabled={blocked}
                          value={Number.isFinite(selection.firstBar) ? selection.firstBar : ""}
                          onChange={(event) => edit(role, { firstBar: event.target.valueAsNumber })}
                        />
                      </td>
                      <td className="w-24 p-2">
                        <Input
                          aria-label={`${label} bars`}
                          type="number"
                          min={1}
                          max={role === "fill1" || role === "fill2" ? 1 : MAX_RHYTHM_BARS}
                          disabled={blocked}
                          value={Number.isFinite(selection.bars) ? selection.bars : ""}
                          onChange={(event) => edit(role, { bars: event.target.valueAsNumber })}
                        />
                      </td>
                      <td className="p-2">{Number.isFinite(exportedBar) ? exportedBar : "—"}</td>
                      <td className="p-2">
                        <Button size="sm" variant="outline" disabled={blocked || !part} aria-label={`Preview ${label}`} onClick={() => void preview(role)}>
                          Preview
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground">
            The preview uses VLTN’s clean drum kit. The pedal uses its selected kit; tone effects are not included. Start with Studio. Check the converter’s
            part-length limits before your first transfer.
          </p>
          <p className="text-muted-foreground">
            In RC-10R Rhythm Converter choose File → Import and open the .RC0 file. All six ranges are already assigned. Choose an available user rhythm for
            transfer. Import replaces the converter’s working list, so export a backup first to keep existing rhythms. The pedal switches between Pattern 1 and
            Pattern 2 during your performance.
          </p>
          <RhythmTransferStatus songKey={songKey} locked={blocked} />
          {disabled && <p role="alert">Stop playback and generate drums again if the song or beat grid changed.</p>}
          {message && <p role="status">{message}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {previewing && (
            <>
              <span role="status">Previewing {RHYTHM_LABELS[previewing]}…</span>
              <Button variant="outline" onClick={stopCurrentPreview}>
                Stop preview
              </Button>
            </>
          )}
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Close export
          </Button>
          <Button disabled={blocked || rows.some((row) => !row.part)} onClick={() => void exportFiles()}>
            {saving ? "Saving…" : "Export rhythm files…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
