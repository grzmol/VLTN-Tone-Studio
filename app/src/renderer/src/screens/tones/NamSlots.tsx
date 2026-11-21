import { useRef, useState } from "react";
import { namTextToNamb } from "@/gp150/lib/namb.mjs";
import { SLOTS } from "@/gp150/lib/protocol.mjs";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useDevice } from "@/state/device";
import type { SlotName } from "@/state/device-types";
import { useStageActivity } from "@/state/stage-activity";

/** NAM names are a separate bank from SnapTones; changing the preset mode does not upload or replace a model. */
export function NamSlots() {
  const supported = useDevice((s) => s.features.includes("nam") && s.status === "connected");
  const connectedAt = useDevice((s) => s.connectedAt);
  return supported ? <NamSlotsPanel key={connectedAt} /> : null;
}

function NamSlotsPanel() {
  const connected = useDevice((s) => s.status === "connected");
  const busy = useDevice((s) => s.busy);
  const nams = useDevice((s) => s.nams);
  const preset = useDevice((s) => s.preset);
  const playing = useStageActivity((s) => s.busy);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SlotName | null>(null);
  const [name, setName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSlot = useRef<SlotName | null>(null);
  const [upload, setUpload] = useState<{ slot: SlotName; file: Uint8Array } | null>(null);
  const [uploadName, setUploadName] = useState("");
  const disabled = !connected || !!busy || working || playing;
  const validName = /^[\x20-\x7e]{1,15}$/.test(name) && !!name.trim();
  const run = async (job: () => Promise<void>) => {
    setWorking(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  };
  const pickFile = async (file: File | undefined) => {
    const slot = uploadSlot.current;
    if (!file || !slot) return;
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Refuse unsupported files before asking for confirmation.
      namTextToNamb(new TextDecoder().decode(bytes));
      setUploadName(
        file.name
          .replace(/\.nam$/i, "")
          .replace(/[^\x20-\x7e]/g, "")
          .slice(0, 15),
      );
      setUpload({ slot, file: bytes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const validUploadName = /^[\x20-\x7e]{1,15}$/.test(uploadName) && !!uploadName.trim();
  return (
    <section aria-label="NAM slots" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold">NAM models</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            void run(async () => {
              await useDevice.getState().readNams();
            })
          }
        >
          {nams ? "Read NAM slots again" : "Read NAM slots"}
        </Button>
      </div>
      {preset && preset.namMode !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span>This preset uses: {preset.namMode === 1 ? "NAM" : "SnapTone"}</span>
          <Switch
            aria-label="Use NAM for this preset"
            checked={preset.namMode === 1}
            disabled={disabled}
            onCheckedChange={(on) => {
              setError(null);
              try {
                useDevice.getState().setNamMode(on ? 1 : 0);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          <p className="w-full text-silkscreen-3">Save the preset to keep its mode.</p>
        </div>
      )}
      {playing && <p className="text-[12px] text-silkscreen-3">Stop the performance to manage NAM slots.</p>}
      {error && !editing && !upload && (
        <p role="alert" className="text-[12px] text-destructive">
          {error}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".nam"
        aria-label="NAM file"
        className="hidden"
        onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {nams && (
        <Collapsible>
          <CollapsibleTrigger className="text-[12px] font-semibold underline underline-offset-4">
            NAM slots 1–{SLOTS.NAMS} · {nams.filter((s) => s.kind !== "empty").length} used
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 max-h-72 space-y-1 overflow-auto">
            {nams.map((slot) => (
              <div key={slot.slot} className="flex items-center gap-2 rounded-md bg-well px-2 py-1 text-[12px]">
                <span className="w-8 shrink-0 tabular-nums">{slot.slot}</span>
                <span className="min-w-0 grow truncate">
                  {slot.name || "Unnamed"}
                  {slot.kind === "empty" ? " · Empty" : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Rename NAM slot ${slot.slot}`}
                  onClick={() => {
                    setEditing(slot);
                    setName(slot.name);
                    setError(null);
                  }}
                >
                  Rename…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Upload NAM to slot ${slot.slot}`}
                  onClick={() => {
                    uploadSlot.current = slot;
                    fileInput.current?.click();
                  }}
                >
                  Upload NAM…
                </Button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
      <Dialog
        open={!!upload}
        onOpenChange={(open) => {
          if (!open && !working) setUpload(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload NAM to slot {upload?.slot.slot}</DialogTitle>
            <DialogDescription>
              This replaces the model in slot {upload?.slot.slot}
              {upload?.slot.kind !== "empty" && upload?.slot.name ? ` ("${upload.slot.name}")` : ""}. The replaced model cannot be read back from the pedal, so keep your own copy of it
              first.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled || !validUploadName || !upload) return;
              const { slot, file } = upload;
              void run(async () => {
                await useDevice.getState().uploadNam(slot.slot, uploadName, file);
                setUpload(null);
              });
            }}
          >
            <Input aria-label="New NAM name" maxLength={15} value={uploadName} disabled={working} onChange={(e) => setUploadName(e.target.value)} />
            <p className="mt-2 text-xs text-silkscreen-3">1–15 plain text characters. Only A2 Lite NAM files work on the GP-180.</p>
            {working && (
              <p role="status" className="mt-2 text-sm">
                Uploading…
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" disabled={working} onClick={() => setUpload(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || !validUploadName}>
                {working ? "Uploading…" : "Replace model"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !working) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename NAM slot {editing?.slot}</DialogTitle>
            <DialogDescription>Changes the slot name on the pedal. Its model and the active preset stay unchanged.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (disabled || !validName || !editing) return;
              const slot = editing.slot;
              void run(async () => {
                await useDevice.getState().renameNam(slot, name);
                setEditing(null);
              });
            }}
          >
            <Input aria-label="NAM name" maxLength={15} value={name} disabled={working} onChange={(e) => setName(e.target.value)} />
            <p className="mt-2 text-xs text-silkscreen-3">1–15 plain text characters.</p>
            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" disabled={working} onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={disabled || !validName}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
