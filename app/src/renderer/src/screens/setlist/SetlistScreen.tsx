import { useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, ImportIcon, PlayIcon, PlusIcon, PresentationIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { notifyError, notifySuccess } from "@/app/notify";
import { requestPresetSwitch } from "@/app/preset-switch";
import { cn } from "@/lib/utils";
import { isEmptyName } from "@/screens/library/store";
import { useDevice } from "@/state/device";
import { DEFAULT_DEVICE, pedalName, profileOrDefault } from "@/state/device-model";
import type { SlotName } from "@/state/device-types";
import { drift, parseImport, serialize, type Setlist, type SetlistItem } from "./setlist";
import { useSetlists } from "./store";

/** Setlists: ordered pedal presets for a gig, with a stage mode that steps through them. */
export function SetlistScreen() {
  const device = useDevice((s) => s.device) ?? DEFAULT_DEVICE;
  const all = useSetlists((s) => s.setlists);
  const currentId = useSetlists((s) => s.currentId);
  const lists = all.filter((l) => l.device === device);
  const current = lists.find((l) => l.id === currentId) ?? lists[0];
  const fileInput = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    try {
      const imported = parseImport(await file.text());
      useSetlists.getState().importAll(imported);
      notifySuccess("Setlists imported", `${imported.length} ${imported.length === 1 ? "setlist" : "setlists"} added.`);
    } catch (e) {
      notifyError("Couldn't import the setlists", e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 px-7 pt-4 pb-3">
        <h1 className="m-0 mr-auto text-[32px] leading-[1.05] font-bold tracking-[-0.02em]">Setlists</h1>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const input = e.target;
            const file = input.files?.[0];
            if (file) void importFile(file).then(() => (input.value = ""));
          }}
        />
        <Button variant="ghost" onClick={() => fileInput.current?.click()}>
          <ImportIcon data-icon="inline-start" />
          Import
        </Button>
        <Button onClick={() => useSetlists.getState().create("New setlist", device)}>
          <PlusIcon data-icon="inline-start" />
          New setlist
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 px-7 pb-4">
        <ul aria-label={`${pedalName(device)} setlists`} className="flex min-h-0 flex-col gap-1 overflow-auto">
          {lists.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                aria-current={l.id === current?.id || undefined}
                onClick={() => useSetlists.getState().select(l.id)}
                className={cn("flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-white/6", l.id === current?.id && "bg-white/14")}
              >
                <span className="truncate font-[650] text-silkscreen">{l.name}</span>
                <span className="text-xs text-silkscreen-3">{l.items.length === 1 ? "1 preset" : `${l.items.length} presets`}</span>
              </button>
            </li>
          ))}
        </ul>
        {current ? (
          <Detail key={current.id} list={current} />
        ) : (
          <Empty className="self-start">
            <EmptyHeader>
              <EmptyTitle>No setlists for the {pedalName(device)} yet</EmptyTitle>
              <EmptyDescription>Make one for a gig, add the presets you need in the order you play them, then step through them in Stage mode.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  );
}

function Detail({ list }: { list: Setlist }) {
  const names = useDevice((s) => s.names);
  const slot = useDevice((s) => s.slot);
  const connected = useDevice((s) => s.status === "connected");
  const { slotLabel } = profileOrDefault(list.device);
  const [picker, setPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [title, setTitle] = useState(list.name);
  const s = useSetlists.getState();

  const rename = () => {
    s.rename(list.id, title);
    setTitle(useSetlists.getState().setlists.find((l) => l.id === list.id)?.name ?? title);
  };

  const exportList = () => {
    const url = URL.createObjectURL(new Blob([serialize([list])], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${list.name.replace(/[^\w.-]+/g, "_") || "setlist"}.setlist.json` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label={list.name} className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input aria-label="Setlist name" className="h-9 max-w-xs text-base font-[650]" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        <span className="flex-1" />
        <Button variant="outline" onClick={() => setPicker(true)}>
          <PlusIcon data-icon="inline-start" />
          Add preset
        </Button>
        <Button disabled={list.items.length === 0} onClick={() => s.setStage(true)}>
          <PresentationIcon data-icon="inline-start" />
          Stage mode
        </Button>
        <Button variant="ghost" size="icon" aria-label="Export setlist" onClick={exportList}>
          <DownloadIcon aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Delete setlist" onClick={() => setDeleting(true)}>
          <Trash2Icon aria-hidden />
        </Button>
      </div>

      {list.items.length === 0 ? (
        <p className="text-sm text-silkscreen-3">Empty. Add presets in the order you play them.</p>
      ) : (
        <ol className="flex min-h-0 flex-col gap-1.5 overflow-auto pb-1">
          {list.items.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              index={i}
              last={i === list.items.length - 1}
              slotLabel={slotLabel}
              playing={connected && slot === item.slot}
              names={names}
              listId={list.id}
              onDragStart={() => setDragFrom(i)}
              onDrop={() => dragFrom !== null && s.moveItem(list.id, dragFrom, i)}
              onDragEnd={() => setDragFrom(null)}
            />
          ))}
        </ol>
      )}

      <CommandDialog open={picker} onOpenChange={setPicker} title="Add a preset" description="Pick a pedal preset to add to the setlist">
        <CommandInput placeholder="Find a preset by number or name" />
        <CommandList className="max-h-[360px]">
          <CommandEmpty>No preset matches</CommandEmpty>
          <CommandGroup heading="Presets on the pedal">
            {names
              .filter((n) => !isEmptyName(n.name))
              .map((n) => (
                <CommandItem
                  key={n.slot}
                  value={`${slotLabel(n.slot)} ${n.name}`}
                  onSelect={() => {
                    s.addItem(list.id, n.slot, n.name.trim());
                    setPicker(false);
                  }}
                >
                  <span className="min-w-6 shrink-0 font-semibold whitespace-nowrap text-silkscreen-3 tabular-nums">{slotLabel(n.slot)}</span>
                  <span className="flex-1 truncate">{n.name}</span>
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{list.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The presets stay on the pedal; only this list is removed. Export it first if you want to keep a copy.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => s.remove(list.id)}>Delete setlist</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface RowProps {
  item: SetlistItem;
  index: number;
  last: boolean;
  slotLabel(slot: number): string;
  playing: boolean;
  names: SlotName[];
  listId: string;
  onDragStart(): void;
  onDrop(): void;
  onDragEnd(): void;
}

function Row({ item, index, last, slotLabel, playing, names, listId, onDragStart, onDrop, onDragEnd }: RowProps) {
  const s = useSetlists.getState();
  const d = drift(item, names);
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => (e.preventDefault(), onDrop())}
      onDragEnd={onDragEnd}
      className={cn("flex cursor-grab items-center gap-3 rounded-lg bg-faceplate px-3 py-2 shadow-[0_0_0_1px_var(--seam)]", playing && "shadow-[0_0_0_1.5px_var(--lamp)]")}
    >
      <span className="w-5 text-right text-xs font-semibold text-silkscreen-3 tabular-nums">{index + 1}</span>
      <span className="min-w-8 text-xs font-semibold text-silkscreen-3 tabular-nums">{slotLabel(item.slot)}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-[650] text-silkscreen">{item.name || "Unnamed"}</span>
        {d.kind !== "ok" && (
          <span className="flex items-center gap-1.5 text-xs text-led-warn">
            <TriangleAlertIcon className="size-3 shrink-0" aria-hidden />
            {d.kind === "moved" ? `This preset is now in slot ${slotLabel(d.slot)}.` : `This slot now holds “${d.now}”.`}
            <button type="button" className="underline underline-offset-2" onClick={() => s.relink(listId, item.id, d.kind === "moved" ? { slot: d.slot, name: item.name } : { slot: item.slot, name: d.now })}>
              {d.kind === "moved" ? "Follow it" : "Use it"}
            </button>
          </span>
        )}
      </div>
      <Input aria-label={`Note for ${item.name}`} className="h-8 w-56 text-sm" placeholder="Note (capo, tuning…)" value={item.note} onChange={(e) => s.setNote(listId, item.id, e.target.value)} />
      <Button variant="ghost" size="icon-sm" aria-label={`Play ${item.name}`} onClick={() => void requestPresetSwitch(item.slot)}>
        <PlayIcon aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={index === 0} onClick={() => s.moveItem(listId, index, index - 1)}>
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={last} onClick={() => s.moveItem(listId, index, index + 1)}>
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.name}`} onClick={() => s.removeItem(listId, item.id)}>
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}
