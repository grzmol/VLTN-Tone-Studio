import { useState, type CSSProperties } from "react";
import { ListIcon, PencilIcon, PlayIcon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { notifyError, notifySuccess, showToast } from "@/app/notify";
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
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Scene } from "@/gp200/lib/mod-service.mjs";
import { useDevice, usePedalName } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { useScenes } from "@/state/scenes";
import { SCENE_COLORS, SCENE_LETTERS, sceneNameError, sceneRows, scenesOf } from "@/state/scenes-model";
import type { ChangeRow } from "@/state/unsaved-diff";

const letter = (k: number) => SCENE_LETTERS[k];
/** `--scene`: the scene's colour on the pedal, for the classes below. */
const sceneColor = (k: number) => ({ "--scene": SCENE_COLORS[k] }) as CSSProperties;
/** Like the pedal's screen: the scene that plays is filled with its colour, a saved one is outlined in it. */
const FILLED = "bg-[var(--scene)] text-lamp-ink";
const OUTLINED = "bg-[color-mix(in_srgb,var(--scene)_14%,transparent)] text-[var(--scene)] shadow-[inset_0_0_0_1.5px_var(--scene)]";
const EMPTY = "text-silkscreen-4 shadow-[inset_0_0_0_1px_var(--seam-strong)]";

/** Save the Rig's sound as scene `k` and say what stayed out of it. */
async function saveScene(k: number) {
  try {
    const { dropped, scene } = await useScenes.getState().save(k);
    const body = `The pedal went back to the base; the scene plays when you select ${letter(k)} on it.`;
    if (dropped.length) showToast({ tone: "info", sticky: true, title: `Saved scene ${letter(k)} without some changes`, body: `A scene can't hold: ${dropped.join(", ")}. ${body}` });
    else notifySuccess(`Saved scene ${letter(k)} · ${scene.name}`, body);
  } catch (e) {
    notifyError(`Couldn't save scene ${letter(k)}`, e, () => saveScene(k));
  }
}

async function editScene(k: number) {
  try {
    await useScenes.getState().edit(k);
  } catch (e) {
    notifyError(`Couldn't play scene ${letter(k)}`, e);
  }
}

async function leaveScene() {
  try {
    await useScenes.getState().leave();
  } catch (e) {
    notifyError("Couldn't go back to the base", e);
  }
}

/**
 * Rig header "Scenes" (GP-200 running the GrooveGurus mod): the four scenes of the active preset in a side sheet, what
 * each changes from the saved preset, and the actions to play one on the Rig, save the Rig's sound into one, rename or
 * delete it.
 */
export function ScenesControl({ preset, disabled }: { preset: PresetState; disabled: boolean }) {
  const current = useScenes((s) => s.current);
  const loading = useScenes((s) => s.loading);
  const error = useScenes((s) => s.error);
  const list = useScenes((s) => s.list);
  const editing = useScenes((s) => s.editing);
  const pedalState = useScenes((s) => s.pedal);
  const writing = useScenes((s) => s.writing);
  const canWrite = useDevice((s) => s.features.includes("modScenesWrite"));
  const base = useDevice((s) => s.saved);
  const unsaved = useDevice((s) => s.unsavedChanges);
  const pedal = usePedalName();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { kind: "edit" | "overwrite" | "delete"; k: number }>(null);

  const ready = current !== null && current.slot === preset.slot;
  const scenes = scenesOf(current?.record ?? null);
  const saved = scenes.filter(Boolean).length;
  const unreadable = ready && current.bytes !== null && current.record === null;
  const readOnly = disabled || !canWrite || unreadable || writing;

  const startEdit = (k: number) => {
    // Unsaved edits of the base would turn into the scene's: ask first (not when another scene is being edited).
    if (editing === null && unsaved > 0) return setConfirm({ kind: "edit", k });
    setOpen(false);
    void editScene(k);
  };
  const startSave = (k: number) => {
    if (scenes[k]) return setConfirm({ kind: "overwrite", k });
    void saveScene(k);
  };
  const runConfirmed = async () => {
    if (!confirm) return;
    const { kind, k } = confirm;
    setConfirm(null);
    if (kind === "edit") {
      setOpen(false);
      await editScene(k);
    } else if (kind === "overwrite") await saveScene(k);
    else {
      try {
        await useScenes.getState().remove(k);
        notifySuccess(`Deleted scene ${letter(k)}`);
      } catch (e) {
        notifyError(`Couldn't delete scene ${letter(k)}`, e);
      }
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <div role="group" aria-label="Scenes" className="flex shrink-0 items-center gap-1 rounded-[10px] p-1 shadow-[inset_0_0_0_1px_var(--seam-strong)]">
          <SceneChip
            label="Base"
            title={`Base · ${preset.name} as saved`}
            active={editing === null}
            playing={!!pedalState?.sceneMode && pedalState.activeScene === null}
            disabled={disabled || writing || editing === null}
            onClick={() => void leaveScene()}
          />
          {SCENE_LETTERS.map((l, k) => {
            const scene = scenes[k];
            return (
              <SceneChip
                key={l}
                label={l}
                title={!ready ? `Scene ${l}` : scene ? `Scene ${l} · ${scene.name}${base ? ` · ${sceneRows(base, scene).length} changes` : ""}` : `Scene ${l} · empty, starts from the base`}
                saved={!!scene}
                k={k}
                active={editing === k}
                playing={!!pedalState?.sceneMode && pedalState.activeScene === k}
                disabled={!ready || readOnly || editing === k}
                onClick={() => startEdit(k)}
              />
            );
          })}
          <SheetTrigger asChild>
            <Button variant="ghost" size="xs" className="ml-0.5 h-8 gap-1.5 px-2 text-xs font-normal text-silkscreen-3" aria-label={ready ? `Scenes: ${saved} of 4 saved` : "Scenes"}>
              <ListIcon aria-hidden />
              <span className="max-[1320px]:hidden">Scenes</span>
            </Button>
          </SheetTrigger>
        </div>
        <SheetContent side="right" className="w-[480px] gap-0 p-0 sm:max-w-[480px]">
          <SheetHeader className="border-b border-border py-5 pr-12 pl-6">
            <SheetTitle className="text-lg">Scenes of {preset.name}</SheetTitle>
            <SheetDescription className="text-pretty text-silkscreen-3">
              A scene is this preset as saved, plus what the scene changes. Play one here to edit it on the Rig, or save what the Rig plays now into
              one. On the {pedal}, scene mode plays them with the footswitches.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-5 pb-8">
            {!ready && (loading || !error) && (
              <p className="flex items-center gap-2 text-sm text-silkscreen-3">
                <Spinner /> Reading the scenes from the {pedal}
              </p>
            )}
            {error && (
              <div role="alert" className="flex flex-col items-start gap-2 text-sm text-led-fault">
                Couldn't read the scenes. {error}
                <Button size="sm" variant="outline" onClick={() => void useScenes.getState().refresh()}>
                  Try again
                </Button>
              </div>
            )}
            {unreadable && (
              <p className="text-sm text-pretty text-silkscreen-2">
                These scenes were saved by a newer version of the mod ({current.error}). Tone Studio shows that they exist and leaves them as they are; update
                Tone Studio to edit them.
              </p>
            )}
            {ready && !unreadable && base &&
              scenes.map((scene, k) => (
                <SceneCard
                  key={k}
                  k={k}
                  scene={scene}
                  base={base}
                  editing={editing === k}
                  playing={!!pedalState?.sceneMode && pedalState.activeScene === k}
                  readOnly={readOnly}
                  canSave={!readOnly}
                  onEdit={() => startEdit(k)}
                  onSave={() => startSave(k)}
                  onDelete={() => setConfirm({ kind: "delete", k })}
                />
              ))}
            {ready && !canWrite && <p className="text-xs text-silkscreen-3">This version of the mod lets Tone Studio read scenes only.</p>}
            {list && (
              <p className="mt-2 text-xs text-pretty text-silkscreen-3">
                {list.total - list.free} of {list.total} presets on the {pedal} have scenes.
                {list.free === 0 && !scenes.some(Boolean) && " There is no room for the scenes of another preset; delete the scenes of one first."}
                {list.orphans > 0 && ` ${list.orphans} scene ${list.orphans === 1 ? "record belongs" : "records belong"} to no preset.`}
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="w-[480px] max-w-[calc(100vw-48px)] sm:max-w-[480px]">
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-lg font-semibold text-balance">
                  {confirm.kind === "edit"
                    ? `Play scene ${letter(confirm.k)} over your unsaved changes?`
                    : confirm.kind === "overwrite"
                      ? `Replace scene ${letter(confirm.k)} · ${scenes[confirm.k]?.name}?`
                      : `Delete scene ${letter(confirm.k)} · ${scenes[confirm.k]?.name}?`}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-[13px] text-pretty text-silkscreen-2">
                  {confirm.kind === "edit"
                    ? `The ${unsaved === 1 ? "unsaved change" : `${unsaved} unsaved changes`} to ${preset.name} stop playing, and whatever you keep different from the saved preset goes into the scene when you save it.`
                    : confirm.kind === "overwrite"
                      ? `Scene ${letter(confirm.k)} becomes what the Rig plays now, as differences from the saved preset. The ${pedal} goes back to the base after the write.`
                      : `The ${pedal} forgets this scene. The preset and the other scenes stay as they are.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button variant={confirm.kind === "delete" ? "destructive" : "default"} onClick={() => void runConfirmed()}>
                  {confirm.kind === "edit" ? `Play scene ${letter(confirm.k)}` : confirm.kind === "overwrite" ? "Replace" : "Delete"}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ChipProps {
  label: string;
  title: string;
  saved?: boolean;
  /** Scene index for its colour; undefined = the base */
  k?: number;
  /** The Rig plays (and edits) it */
  active: boolean;
  /** The pedal plays it (scene mode) */
  playing: boolean;
  disabled: boolean;
  onClick(): void;
}

/** One scene (or the base) next to the preset name: click to play it on the Rig and edit it. */
function SceneChip({ label, title, saved = true, k, active, playing, disabled, onClick }: ChipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={disabled ? 0 : -1} className="rounded-md">
          <button
            type="button"
            aria-label={title}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            style={k === undefined ? { "--scene": "var(--silkscreen)" } as CSSProperties : sceneColor(k)}
            className={cn(
              "relative grid h-8 min-w-8 place-items-center rounded-md px-2 text-sm font-bold transition-colors",
              active ? FILLED : saved ? (k === undefined ? "text-silkscreen-2 shadow-[inset_0_0_0_1px_var(--seam-strong)]" : OUTLINED) : EMPTY,
              !active && "enabled:hover:bg-[color-mix(in_srgb,var(--scene)_28%,transparent)] enabled:hover:text-silkscreen",
              label === "Base" && "text-xs font-semibold",
              disabled && !active && "opacity-60",
            )}
          >
            {label}
            {playing && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[var(--scene)] ring-2 ring-background" aria-hidden />}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {title}
        {playing ? " · playing on the pedal" : ""}
      </TooltipContent>
    </Tooltip>
  );
}

interface CardProps {
  k: number;
  scene: Scene | null;
  base: PresetState;
  editing: boolean;
  playing: boolean;
  readOnly: boolean;
  canSave: boolean;
  onEdit(): void;
  onSave(): void;
  onDelete(): void;
}

function SceneCard({ k, scene, base, editing, playing, readOnly, canSave, onEdit, onSave, onDelete }: CardProps) {
  const [renaming, setRenaming] = useState(false);
  const rows = scene ? sceneRows(base, scene) : [];
  return (
    <section
      aria-label={`Scene ${letter(k)}`}
      style={sceneColor(k)}
      className={cn("flex flex-col gap-3 rounded-lg p-3.5 shadow-[inset_0_0_0_1px_var(--seam-strong)]", editing && "shadow-[inset_0_0_0_2px_var(--scene)]")}
    >
      <div className="flex items-center gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold", editing || playing ? FILLED : scene ? OUTLINED : EMPTY)}>
          {letter(k)}
        </span>
        <div className="min-w-0 flex-1">
          {renaming && scene ? (
            <RenameScene k={k} name={scene.name} onDone={() => setRenaming(false)} />
          ) : (
            <div className="truncate text-sm font-semibold text-silkscreen">{scene ? scene.name : "Empty"}</div>
          )}
          <div className="text-xs text-silkscreen-3">
            {editing ? "Playing on the Rig · edits go into this scene" : playing ? "Playing on the pedal" : scene ? (rows.length === 1 ? "1 change" : `${rows.length} changes`) : "Plays the base"}
          </div>
        </div>
        {scene && !renaming && (
          <Button variant="ghost" size="icon-sm" aria-label={`Rename scene ${letter(k)}`} disabled={readOnly} onClick={() => setRenaming(true)}>
            <PencilIcon aria-hidden />
          </Button>
        )}
        {scene && (
          <Button variant="ghost" size="icon-sm" aria-label={`Delete scene ${letter(k)}`} disabled={readOnly} onClick={onDelete}>
            <Trash2Icon aria-hidden />
          </Button>
        )}
      </div>
      {rows.length > 0 && <ChangesTable rows={rows} />}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={readOnly || editing} onClick={onEdit}>
          <PlayIcon aria-hidden />
          {scene ? "Play and edit" : "Start from the base"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canSave} onClick={onSave}>
          <SaveIcon aria-hidden />
          Save the Rig's sound here
        </Button>
      </div>
    </section>
  );
}

function RenameScene({ k, name, onDone }: { k: number; name: string; onDone(): void }) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const problem = sceneNameError(value);
  const commit = async () => {
    if (problem || saving) return;
    if (value.trim() === name) return onDone();
    setSaving(true);
    try {
      await useScenes.getState().rename(k, value);
      onDone();
    } catch (e) {
      notifyError(`Couldn't rename scene ${letter(k)}`, e);
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        aria-label={`Name of scene ${letter(k)}`}
        aria-invalid={!!problem}
        value={value}
        maxLength={16}
        disabled={saving}
        className="h-7 text-sm"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      {problem && <span className="text-xs text-led-fault">{problem}</span>}
    </div>
  );
}

function ChangesTable({ rows }: { rows: ChangeRow[] }) {
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="border-b border-seam text-left text-silkscreen-3">
          <th className="py-1 pr-3 font-medium">Block</th>
          <th className="py-1 pr-3 font-medium">Parameter</th>
          <th className="py-1 pr-3 text-right font-medium">Base</th>
          <th className="py-1 text-right font-medium">Scene</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-seam last:border-0">
            <td className="py-1.5 pr-3">
              {r.block ? (
                <span className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-pill" style={{ background: `var(--block-${r.block.code.toLowerCase()})` }} aria-hidden />
                  <b className="font-bold text-silkscreen-2">{r.block.code}</b>
                </span>
              ) : (
                <span className="text-silkscreen-3">Preset</span>
              )}
            </td>
            <td className="py-1.5 pr-3 text-silkscreen">{r.parameter}</td>
            <td className="py-1.5 pr-3 text-right text-silkscreen-3">{r.saved}</td>
            <td className="py-1.5 text-right font-semibold text-silkscreen">{r.now}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Under the Rig header while a scene is being edited: what the edits go into, Save and Back to the base. */
export function SceneEditBar() {
  const editing = useScenes((s) => s.editing);
  const writing = useScenes((s) => s.writing);
  const current = useScenes((s) => s.current);
  const changes = useDevice((s) => s.unsavedChanges);
  const busy = useDevice((s) => s.busy);
  if (editing === null) return null;
  const scene = scenesOf(current?.record ?? null)[editing];
  return (
    <div
      role="status"
      style={sceneColor(editing)}
      className="mx-7 mb-2 flex items-center gap-3 rounded-lg bg-[color-mix(in_srgb,var(--scene)_12%,transparent)] px-3.5 py-2 text-sm shadow-[inset_0_0_0_1px_var(--scene)]"
    >
      <span className={cn("grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold", FILLED)}>{letter(editing)}</span>
      <span className="min-w-0 flex-1 truncate text-silkscreen-2">
        <b className="font-semibold text-silkscreen">Editing scene {letter(editing)}{scene ? ` · ${scene.name}` : ""}.</b>{" "}
        {changes === 0 ? "It plays like the saved preset so far." : changes === 1 ? "1 difference from the saved preset goes into the scene." : `${changes} differences from the saved preset go into the scene.`}
      </span>
      <Button size="sm" variant="ghost" disabled={writing || !!busy} onClick={() => void leaveScene()}>
        <Undo2Icon aria-hidden />
        Back to the base
      </Button>
      <Button size="sm" disabled={writing || !!busy} onClick={() => void saveScene(editing)}>
        {writing ? <Spinner /> : <SaveIcon aria-hidden />}
        Save scene {letter(editing)}
      </Button>
    </div>
  );
}

