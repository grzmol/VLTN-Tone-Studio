import { useEffect, useId, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { describeError } from "@/components/write/write-helpers";
import { notifySuccess } from "@/app/notify";
import { host, isElectron } from "@/host";
import type { CollectionInfo } from "@shared/host/files";
import { useLibrary } from "./store";

export type CollectionDialog =
  | { kind: "new"; then?: (collection: CollectionInfo) => void }
  | { kind: "rename"; collection: CollectionInfo }
  | { kind: "delete"; collection: CollectionInfo };

/** New / rename / delete a user collection (computer only, no pedal writes). */
export function CollectionDialogs({ dialog, onClose }: { dialog: CollectionDialog | null; onClose(): void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();

  useEffect(() => {
    setError(null);
    setTitle(dialog?.kind === "rename" ? dialog.collection.title : "");
  }, [dialog]);

  if (!dialog) return null;

  const run = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (dialog.kind === "delete") {
    const c = dialog.collection;
    return (
      <AlertDialog open onOpenChange={(o) => !o && !saving && onClose()}>
        <AlertDialogContent className="max-w-[440px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {c.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {c.count === 1 ? "preset is" : `${c.count} presets are`} {isElectron ? "moved to the Trash" : "removed from this computer"}.
              Nothing changes on the pedal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-led-fault">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={() =>
                void run(async () => {
                  await host.files.deleteCollection(c.id);
                  await useLibrary.getState().refreshCollections();
                  notifySuccess(isElectron ? `Moved ${c.title} to the Trash` : `Removed ${c.title}`);
                })
              }
            >
              Delete collection
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const isNew = dialog.kind === "new";
  const submit = () =>
    void run(async () => {
      const lib = useLibrary.getState();
      if (dialog.kind === "new") {
        const c = await host.files.createCollection(title);
        await lib.refreshCollections();
        if (dialog.then) dialog.then(c);
        else await lib.openCollection(c.id);
      } else {
        await host.files.renameCollection(dialog.collection.id, title);
        await lib.refreshCollections();
      }
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-[420px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "New collection" : "Rename collection"}</DialogTitle>
            <DialogDescription>{isNew ? "A setlist or a folder of presets on this computer." : "Only the name in Tone Studio changes."}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={inputId}>Name</FieldLabel>
            <Input id={inputId} value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} aria-invalid={error ? true : undefined} placeholder="Rehearsal set" />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {isNew ? "Create" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
