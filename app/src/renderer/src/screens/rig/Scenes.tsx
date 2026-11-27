import { useRef, useState, type CSSProperties } from "react";
import { ChevronDownIcon, Layers2Icon, PencilIcon, PlayIcon, SaveIcon, Trash2Icon, Undo2Icon } from "lucide-react";
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
import { keyLabel } from "@/app/keys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { defaultSceneName, type Scene } from "@/gp200/lib/mod-service.mjs";
import { useDevice, usePedalName } from "@/state/device";
import type { PresetState } from "@/state/device-types";
import { useScenes } from "@/state/scenes";
import { useCommand } from "@/state/ui";
import { SCENE_COLORS, SCENE_CTRL_SWITCHES, SCENE_LETTERS, ctrlLabel, sceneName, sceneNameError, sceneRows, scenesOf } from "@/state/scenes-model";
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
    const body = `It stays on the Rig; on the pedal it plays when you select ${letter(k)}.`;
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
        <Tooltip>
          <TooltipTrigger asChild>
            <SheetTrigger asChild>
              <Button variant="outline" aria-label={ready ? `Scenes: ${saved} of 4 saved` : "Scenes"} className="max-[1320px]:w-[34px] max-[1320px]:px-0">
                <Layers2Icon aria-hidden />
                <span className="max-[1320px]:hidden">Scenes</span>
              </Button>
            </SheetTrigger>
          </TooltipTrigger>
          <TooltipContent className="min-[1321px]:hidden">Scenes{ready ? ` · ${saved} of 4 saved` : ""}</TooltipContent>
        </Tooltip>
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

/**
 * In the Rig title, after the preset name in scene mode: the scene the Rig plays (edited here, or the one the pedal
 * plays), as "Preset | Scene name" in the scene's colour.
 */
export function SceneTitle({ preset }: { preset: PresetState }) {
  const mode = useScenes((s) => s.mode);
  const editing = useScenes((s) => s.editing);
  const pedalState = useScenes((s) => s.pedal);
  const current = useScenes((s) => s.current);
  const k = editing ?? (pedalState?.sceneMode ? pedalState.activeScene : null);
  if (mode !== "scene" || k === null) return null;
  const scene = current?.slot === preset.slot ? scenesOf(current.record)[k] : null;
  return (
    <>
      <Separator orientation="vertical" className="mx-4 inline-block align-middle data-[orientation=vertical]:h-[0.8em] data-[orientation=vertical]:w-0.5" />
      <span style={sceneColor(k)} className="text-[var(--scene)]">
        {scene?.name ?? defaultSceneName(k)}
      </span>
    </>
  );
}

/** The pedal's LED colours for the CTRL footswitches in scene mode (cenas 0.8.4) and the TAP footswitch. */
const LED = { on: "#ffc400", off: "#ff1f4b", tap: "#2a72ee" } as const;

/**
 * Under the Rig header while the pedal is in scene mode (or a scene is edited here): the footswitches as on the pedal.
 * Top row: BANK−, BANK+, CTRL 1 and TAP are CTRL 1-4 of the scene (TAP only with Tap Tempo Disabled), lit yellow when
 * on and red when off. Bottom row: scenes A-D; click one to play it on the Rig and edit it, click it again for the base
 * (the pedal's fifth scene). On the right: what the edits go into and Back to the base (Save is the header's button).
 */
export function SceneFootswitches({ preset, disabled }: { preset: PresetState; disabled: boolean }) {
  const current = useScenes((s) => s.current);
  const editing = useScenes((s) => s.editing);
  const pedalState = useScenes((s) => s.pedal);
  const writing = useScenes((s) => s.writing);
  const ctrlOn = useScenes((s) => s.ctrlOn);
  const tapTempo = useScenes((s) => s.tapTempo);
  const canWrite = useDevice((s) => s.features.includes("modScenesWrite"));
  const unsaved = useDevice((s) => s.unsavedChanges);
  const busy = useDevice((s) => s.busy);
  const pedal = usePedalName();
  const [confirm, setConfirm] = useState<number | null>(null);

  const mode = useScenes((s) => s.mode);
  if (mode !== "scene") return null;

  const ready = current !== null && current.slot === preset.slot;
  const scenes = scenesOf(current?.record ?? null);
  const unreadable = ready && current.bytes !== null && current.record === null;
  const readOnly = disabled || !canWrite || unreadable || writing || !!busy;
  /** What the Rig plays: the scene edited here, else the one the pedal plays; null = the base. */
  const selected = editing ?? (pedalState?.sceneMode ? pedalState.activeScene : null);
  const scene = editing === null ? null : scenes[editing];

  const pick = (k: number) => {
    if (selected === k) return void leaveScene(); // the scene that plays again: the base, like the pedal
    // Unsaved edits of the base would turn into the scene's: ask first (not when another scene is being edited).
    if (editing === null && unsaved > 0) return setConfirm(k);
    void editScene(k);
  };

  return (
    <div
      role="group"
      aria-label="Footswitches"
      className="mx-7 mb-2 flex items-center gap-6 rounded-lg px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--seam-strong)] max-[1320px]:gap-4 [@media(max-height:820px)]:py-1.5"
    >
      <div className="grid min-w-0 flex-1 grid-cols-4 gap-x-4 gap-y-1.5">
        {SCENE_CTRL_SWITCHES.map((sw, n) => {
          const tap = n === 3 && tapTempo !== "disabled";
          const label = tap ? null : ctrlLabel(preset, n);
          const on = !!ctrlOn[n];
          return tap ? (
            <Footswitch
              key={sw}
              caption="TAP"
              label="Tap tempo"
              color={LED.tap}
              lit="dim"
              disabled
              title={`TAP taps the tempo. It becomes CTRL 4 when the mod's Tap Tempo is set to Disabled (GLOBAL › Footswitch on the ${pedal}).`}
            />
          ) : (
            <Footswitch
              key={sw}
              caption={`${sw} · CTRL ${n + 1}`}
              label={label ?? "No blocks"}
              color={label ? (on ? LED.on : LED.off) : undefined}
              lit={label ? "full" : "off"}
              pressed={on}
              disabled={disabled || !label}
              title={label ? `CTRL ${n + 1} on ${sw}: ${on ? "on" : "off"}. Click to switch its blocks, like the footswitch.` : `CTRL ${n + 1} has no blocks in this scene (CTRL Settings).`}
              onClick={() => useScenes.getState().toggleCtrl(n)}
            />
          );
        })}
        {SCENE_LETTERS.map((l, k) => {
          const s = scenes[k];
          const active = selected === k;
          const playing = !!pedalState?.sceneMode && pedalState.activeScene === k;
          return (
            <Footswitch
              key={l}
              caption={`Scene ${l}${playing && editing !== k ? " · on the pedal" : ""}`}
              label={s?.name ?? (ready ? "Empty" : defaultSceneName(k))}
              color={SCENE_COLORS[k]}
              lit={active ? "full" : s ? "ring" : "off"}
              pressed={active}
              disabled={!ready || readOnly}
              title={active ? `Scene ${l} plays. Click again for the base.` : s ? `Play scene ${l} · ${s.name} and edit it` : `Scene ${l} is empty: start it from the base`}
              onClick={() => pick(k)}
            />
          );
        })}
      </div>

      <div className="flex w-[360px] shrink-0 flex-col items-end gap-1.5 border-l border-seam pl-6 max-[1320px]:w-[280px] max-[1320px]:pl-4">
        <span role="status" className="w-full truncate text-right text-sm text-silkscreen-2">
          {editing !== null ? (
            <>
              <b className="font-semibold text-silkscreen" style={sceneColor(editing)}>
                <span className="text-[var(--scene)]">●</span> Editing scene {letter(editing)}
                {scene ? ` · ${scene.name}` : ""}
              </b>
              <span className="block text-xs text-silkscreen-3">
                {unsaved === 0 ? "Plays like the saved preset so far" : unsaved === 1 ? "1 difference from the saved preset" : `${unsaved} differences from the saved preset`}
              </span>
            </>
          ) : (
            <>
              <b className="font-semibold text-silkscreen">{selected === null ? "Base" : `Scene ${letter(selected)} on the ${pedal}`}</b>
              <span className="block text-xs text-silkscreen-3">Click a scene to play and edit it here</span>
            </>
          )}
        </span>
        {editing !== null && (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={writing || !!busy} onClick={() => void leaveScene()}>
              <Undo2Icon aria-hidden />
              Back to the base
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="w-[480px] max-w-[calc(100vw-48px)] sm:max-w-[480px]">
          {confirm !== null && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-lg font-semibold text-balance">Play scene {letter(confirm)} over your unsaved changes?</AlertDialogTitle>
                <AlertDialogDescription className="text-[13px] text-pretty text-silkscreen-2">
                  The {unsaved === 1 ? "unsaved change" : `${unsaved} unsaved changes`} to {preset.name} stop playing, and whatever you keep different from the
                  saved preset goes into the scene when you save it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button
                  onClick={() => {
                    const k = confirm;
                    setConfirm(null);
                    void editScene(k);
                  }}
                >
                  Play scene {letter(confirm)}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface FootswitchProps {
  /** The footswitch on the pedal (small, above) */
  caption: string;
  /** What it does now: the CTRL's effect, the scene's name */
  label: string;
  /** LED colour; undefined = unlit grey */
  color?: string;
  /** full: lit in its colour; ring: outlined in it (a saved scene); dim: faint; off: unlit */
  lit: "full" | "ring" | "dim" | "off";
  pressed?: boolean;
  disabled?: boolean;
  title: string;
  onClick?(): void;
}

/** One footswitch: the round LED and what it does, side by side. */
function Footswitch({ caption, label, color, lit, pressed, disabled, title, onClick }: FootswitchProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={disabled ? 0 : -1} className="min-w-0 rounded-md">
          <button
            type="button"
            aria-label={`${caption}: ${label}`}
            aria-pressed={onClick ? !!pressed : undefined}
            disabled={disabled}
            onClick={onClick}
            style={{ "--led": color ?? "var(--led-off)" } as CSSProperties}
            className="group flex w-full min-w-0 items-center gap-2.5 rounded-md py-0.5 pr-1.5 text-left enabled:cursor-pointer"
          >
            <span
              aria-hidden
              className={cn(
                "size-6 shrink-0 rounded-full transition-[background-color,box-shadow,transform] duration-150 group-enabled:group-active:scale-95 motion-reduce:transition-none [@media(max-height:820px)]:size-5",
                lit === "full" && "bg-[var(--led)] shadow-[0_0_10px_color-mix(in_srgb,var(--led)_55%,transparent)]",
                lit === "ring" && "bg-[color-mix(in_srgb,var(--led)_18%,transparent)] shadow-[inset_0_0_0_2px_var(--led)]",
                lit === "dim" && "bg-[color-mix(in_srgb,var(--led)_35%,transparent)]",
                lit === "off" && "bg-led-off",
                "group-enabled:group-hover:ring-2 group-enabled:group-hover:ring-[color-mix(in_srgb,var(--led)_40%,transparent)]",
              )}
            />
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[11px] text-silkscreen-3">{caption}</span>
              <span className={cn("block truncate text-sm font-semibold", lit === "off" || disabled ? "text-silkscreen-3" : "text-silkscreen")}>{label}</span>
            </span>
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[320px] text-pretty">{title}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The Rig header's Save split button while a scene is edited: save the Rig's sound into the scene (Mod S), rename it
 * (F2) or delete it. Replaces "Save to slot", which would store the scene as the base.
 */
export function SceneSaveSplit({ preset, disabled }: { preset: PresetState; disabled: boolean }) {
  const editing = useScenes((s) => s.editing);
  const current = useScenes((s) => s.current);
  const writing = useScenes((s) => s.writing);
  const canWrite = useDevice((s) => s.features.includes("modScenesWrite"));
  const busy = useDevice((s) => s.busy);
  const pedal = usePedalName();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A menu item opens a dialog: the menu must not take the focus back when it closes, or the dialog closes with it. */
  const opensDialog = useRef(false);
  const ready = current !== null && current.slot === preset.slot;
  const unreadable = ready && current.bytes !== null && current.record === null;
  const readOnly = disabled || !ready || !canWrite || unreadable || writing || !!busy;
  const k = editing ?? 0;
  const scene = scenesOf(current?.record ?? null)[k];

  useCommand("save-to-slot", () => void saveScene(k), editing !== null && !readOnly);
  useCommand("rename-slot", () => setRenaming(true), editing !== null && !readOnly && !!scene);
  if (editing === null) return null;

  const remove = async () => {
    setDeleting(false);
    try {
      await useScenes.getState().remove(k);
      notifySuccess(`Deleted scene ${letter(k)}`, "The scene stays selected and plays the base until you save it again.");
    } catch (e) {
      notifyError(`Couldn't delete scene ${letter(k)}`, e);
    }
  };

  return (
    <div className="flex" style={sceneColor(k)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={readOnly ? 0 : -1}>
            <Button disabled={readOnly} onClick={() => void saveScene(k)} className="rounded-r-none pr-3">
              {writing ? <Spinner /> : <SaveIcon aria-hidden />}
              {writing ? `Saving scene ${letter(k)}` : `Save scene ${letter(k)}`}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {unreadable ? "These scenes were saved by a newer mod" : !canWrite ? "This version of the mod can't write scenes" : `What the Rig plays now goes into scene ${letter(k)} · ${keyLabel(["Mod", "S"])}`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label="More scene options" className="rounded-l-none border-l border-black/15 px-2.5">
            <ChevronDownIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(e) => {
            if (opensDialog.current) e.preventDefault();
            opensDialog.current = false;
          }}
        >
          <DropdownMenuItem disabled={readOnly} onSelect={() => void saveScene(k)}>
            Save scene {letter(k)}
            <DropdownMenuShortcut>{keyLabel(["Mod", "S"])}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={readOnly || !scene}
            onSelect={() => {
              opensDialog.current = true;
              setRenaming(true);
            }}
          >
            Rename scene {letter(k)}…
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={readOnly || !scene}
            onSelect={() => {
              opensDialog.current = true;
              setDeleting(true);
            }}
          >
            Delete scene {letter(k)}…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename scene {letter(k)}</DialogTitle>
            <DialogDescription>The {pedal} shows it on the scene footswitch, up to 16 characters.</DialogDescription>
          </DialogHeader>
          {renaming && scene && <RenameSceneForm k={k} name={scene.name} onDone={() => setRenaming(false)} />}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent className="w-[480px] max-w-[calc(100vw-48px)] sm:max-w-[480px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold text-balance">
              Delete scene {letter(k)}
              {scene ? ` · ${scene.name}` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-pretty text-silkscreen-2">
              The {pedal} forgets this scene. The preset and the other scenes stay as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void remove()}>
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The rename dialog's form: Enter or Save writes the name, Esc or Cancel leaves it (no commit on blur, unlike the card). */
function RenameSceneForm({ k, name, onDone }: { k: number; name: string; onDone(): void }) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const problem = sceneNameError(value);
  const submit = async () => {
    if (problem || saving) return;
    if (value.trim() === name) return onDone();
    setSaving(true);
    try {
      await useScenes.getState().rename(k, value);
      notifySuccess(`Renamed scene ${letter(k)}`, sceneName(value, k));
      onDone();
    } catch (e) {
      notifyError(`Couldn't rename scene ${letter(k)}`, e);
      setSaving(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <Input autoFocus aria-label={`Name of scene ${letter(k)}`} aria-invalid={!!problem} value={value} maxLength={16} disabled={saving} onChange={(e) => setValue(e.target.value)} />
        <span className={cn("text-xs", problem ? "text-led-fault" : "text-silkscreen-3")}>{problem ?? `${value.length} of 16`}</span>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={saving} onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!!problem || saving}>
          {saving && <Spinner />}
          Rename
        </Button>
      </div>
    </form>
  );
}
