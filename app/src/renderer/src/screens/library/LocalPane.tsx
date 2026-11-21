import { useMemo, useState, type DragEvent } from "react";
import {
  ArchiveIcon,
  ArrowDownToLineIcon,
  DownloadIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitCompareArrowsIcon,
  PinIcon,
  PinOffIcon,
  HistoryIcon,
  ImportIcon,
  InfoIcon,
  ListMusicIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MiniChain } from "@/components/write/MiniChain";
import { conversionFor, droppedSentence, isLossy, listConversionNote } from "@/components/write/conversion";
import { ampOrSnapTone, summarize } from "@/components/write/preset-summary";
import { notifyError } from "@/app/notify";
import { host } from "@/host";
import { cn } from "@/lib/utils";
import { usePedalName, useDevice } from "@/state/device";
import { pedalName, profileOrDefault, slotLabel } from "@/state/device-model";
import type { CollectionInfo, LocalPreset } from "@shared/host/files";
import { useLibraryActions } from "./actions";
import { ComparePedalDialog } from "./ComparePedalDialog";
import { useLibrary } from "./store";
import { matchesQuery, metaKey, useMeta, useTags } from "./tags";
import { formatDay, hasFiles, SLOTS_MIME, LOCAL_MIME, startDrag, endDrag } from "./dnd";

const ICONS = { backup: ArchiveIcon, imported: ImportIcon, replaced: HistoryIcon, collection: ListMusicIcon } as const;

function subtitle(c: CollectionInfo): string {
  switch (c.kind) {
    case "backup": {
      const all = c.count === profileOrDefault(c.device).slotCount;
      const time = new Date(c.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const amount = all ? `all ${c.count} slots` : `${c.count} ${c.count === 1 ? "slot" : "slots"}`;
      const when = `${formatDay(c.createdAt)} ${time}, ${amount}`;
      return c.pinned ? `Pinned · ${when}` : when;
    }
    case "imported":
      return ".prst files you added";
    case "replaced":
      return "Saved before a write";
    default:
      return "Collection";
  }
}

/** Collections that accept presets (everything but the read-only backups). */
export function writableCollections(collections: CollectionInfo[]) {
  return collections.filter((c) => c.kind !== "backup");
}

export function LocalPane() {
  const collections = useLibrary((s) => s.collections);
  const loaded = useLibrary((s) => s.collectionsLoaded);
  const currentId = useLibrary((s) => s.currentId);
  const actions = useLibraryActions();
  const [fileOver, setFileOver] = useState(false);

  const backups = collections.filter((c) => c.kind === "backup");
  const others = collections.filter((c) => c.kind !== "backup");

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFileOver(true);
  };
  const onDrop = (e: DragEvent) => {
    setFileOver(false);
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    void actions.importDropped(Array.from(e.dataTransfer.files));
  };

  return (
    <aside
      aria-label="On this computer"
      className={cn("flex min-h-0 flex-col gap-3 rounded-xl pt-1", fileOver && "bg-lamp-glow shadow-[inset_0_0_0_1.5px_var(--lamp)]")}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFileOver(false)}
      onDrop={onDrop}
    >
      <div className="flex min-h-8 items-center gap-1 pl-2.5">
        <h2 className="mr-auto text-[15px] font-[650] whitespace-nowrap text-silkscreen">On this computer</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => void actions.importFiles()}>
              <ImportIcon data-icon="inline-start" />
              Import
            </Button>
          </TooltipTrigger>
          <TooltipContent>Import .prst files, or drop them anywhere on this panel</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="New collection" onClick={() => actions.collectionDialog({ kind: "new" })}>
              <FolderPlusIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New collection</TooltipContent>
        </Tooltip>
      </div>

      <ul className="flex max-h-[38%] min-h-0 shrink-0 flex-col gap-0.5 overflow-auto" aria-label="Collections">
        {!loaded && <Skeleton className="mx-2.5 h-10" />}
        {backups.length > 0 && <li className="px-2.5 pb-0.5 text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase">Backups</li>}
        {backups.map((c) => (
          <CollectionItem key={c.id} c={c} current={c.id === currentId} />
        ))}
        {others.length > 0 && <li className="mt-2 px-2.5 pb-0.5 text-xs font-medium tracking-[0.04em] text-silkscreen-3 uppercase">Collections</li>}
        {others.map((c) => (
          <CollectionItem key={c.id} c={c} current={c.id === currentId} />
        ))}
      </ul>

      <PresetList />
    </aside>
  );
}

function CollectionItem({ c, current }: { c: CollectionInfo; current: boolean }) {
  const actions = useLibraryActions();
  const drag = useLibrary((s) => s.drag);
  const [over, setOver] = useState(false);
  const Icon = ICONS[c.kind];
  const accepts = c.kind !== "backup" && drag?.kind === "slots";

  const [comparing, setComparing] = useState(false);
  const refreshCollections = useLibrary((s) => s.refreshCollections);
  const reveal = () => host.files.revealCollection(c.id).catch((e) => notifyError("Couldn't show the folder", e));
  const togglePin = () =>
    host.files
      .setBackupPinned(c.id, !c.pinned)
      .then(() => refreshCollections())
      .catch((e) => notifyError("Couldn't change the pin", e));

  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            aria-current={current || undefined}
            onClick={() => void useLibrary.getState().openCollection(c.id)}
            onDragOver={(e) => {
              if (!accepts || !e.dataTransfer.types.includes(SLOTS_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              setOver(false);
              if (!accepts || drag?.kind !== "slots") return;
              e.preventDefault();
              e.stopPropagation();
              void actions.addSlotsToCollection(drag.slots, c.id);
            }}
            className={cn(
              "grid h-10 w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-sm px-2.5 text-left text-silkscreen-2 hover:bg-accent hover:text-silkscreen",
              current && "bg-lamp-glow text-silkscreen shadow-[inset_0_0_0_1px_var(--seam-strong)] hover:bg-lamp-glow",
              over && "bg-lamp-glow shadow-[inset_0_0_0_1.5px_var(--lamp)]",
            )}
          >
            <Icon className={cn("size-4", current && "text-lamp")} aria-hidden />
            <span className="flex min-w-0 flex-col leading-tight">
              <b className="truncate font-semibold">{c.title}</b>
              <span className="truncate text-xs text-silkscreen-3">{subtitle(c)}</span>
            </span>
            <span className="text-sm text-silkscreen-3 tabular-nums">{c.count}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuGroup>
            {host.kind === "electron" && (
              <ContextMenuItem onSelect={() => void reveal()}>
                <FolderOpenIcon />
                Reveal in folder
              </ContextMenuItem>
            )}
            {c.kind === "collection" && (
              <ContextMenuItem onSelect={() => actions.collectionDialog({ kind: "rename", collection: c })}>
                <PencilIcon />
                Rename
              </ContextMenuItem>
            )}
            {c.kind === "backup" && (
              <>
                <ContextMenuItem onSelect={() => setComparing(true)}>
                  <GitCompareArrowsIcon />
                  Compare with pedal
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void togglePin()}>
                  {c.pinned ? <PinOffIcon /> : <PinIcon />}
                  {c.pinned ? "Unpin backup" : "Pin backup"}
                </ContextMenuItem>
              </>
            )}
            {c.kind !== "collection" && host.kind !== "electron" && <ContextMenuItem disabled>{c.kind === "backup" ? "Backups are read-only" : "Built-in collection"}</ContextMenuItem>}
          </ContextMenuGroup>
          {c.kind === "collection" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuGroup>
                <ContextMenuItem variant="destructive" onSelect={() => actions.collectionDialog({ kind: "delete", collection: c })}>
                  <Trash2Icon />
                  Delete
                </ContextMenuItem>
              </ContextMenuGroup>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      <ComparePedalDialog collection={comparing ? c : null} onOpenChange={(open) => !open && setComparing(false)} />
    </li>
  );
}

function PresetList() {
  const collections = useLibrary((s) => s.collections);
  const currentId = useLibrary((s) => s.currentId);
  const presets = useLibrary((s) => s.presets);
  const loading = useLibrary((s) => s.presetsLoading);
  const query = useLibrary((s) => s.localQuery);
  const meta = useTags((s) => s.meta);
  const actions = useLibraryActions();
  const pedal = usePedalName();
  const device = useDevice((s) => s.device);
  const current = collections.find((c) => c.id === currentId);
  // What converting changes is the same for every preset of one model, so it is said once above the list.
  const conversionNotes = useMemo(() => {
    if (!device) return [];
    const models = new Set(presets.flatMap((p) => summarize(p.prst)?.device ?? []));
    return [...models].flatMap((from) => listConversionNote(from, device) ?? []);
  }, [presets, device]);

  const visible = useMemo(() => {
    if (!query.trim()) return presets;
    return presets.filter((p) => {
      const models = summarize(p.prst)?.blocks.flatMap((b) => (b.enabled && b.model ? [b.model.title] : [])) ?? [];
      const m = meta[metaKey(p)] ?? { tags: [], stars: 0 };
      return matchesQuery(query, [p.name, p.fileName, ...m.tags, ...models], m);
    });
  }, [presets, query, meta]);

  if (!current) {
    return (
      <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-3">
        <Empty className="flex-1 justify-start pt-10 md:pt-10">
          <EmptyHeader>
            <EmptyTitle>Nothing on this computer yet</EmptyTitle>
            <EmptyDescription>Back up the {pedal}, or import .prst files you downloaded.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => void actions.importFiles()}>
              <ImportIcon data-icon="inline-start" />
              Import
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-border pt-3">
      <InputGroup className="h-8">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={current.kind === "backup" ? "Filter this backup" : `Filter ${current.title.toLowerCase()}: name, tag, model, stars:4`}
          aria-label={`Filter ${current.title}`}
          value={query}
          onChange={(e) => useLibrary.setState({ localQuery: e.target.value })}
        />
      </InputGroup>
      {conversionNotes.map((note) => (
        <p key={note} className="flex items-start gap-1.5 px-1 text-xs text-pretty text-silkscreen-3">
          <RefreshCwIcon className="mt-px size-3 shrink-0" aria-hidden />
          {note}
        </p>
      ))}
      <div role="listbox" aria-label={current.title} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto pb-1">
        {loading && !presets.length && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-[76px] shrink-0 rounded-lg" />)}
        {!loading && !presets.length && (
          <Empty className="flex-1 p-4">
            <EmptyHeader>
              <EmptyTitle>No presets here yet</EmptyTitle>
              <EmptyDescription>Drag slots from the {pedal} list, or import .prst files.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={() => void actions.importFiles()}>
                <ImportIcon data-icon="inline-start" />
                Import
              </Button>
            </EmptyContent>
          </Empty>
        )}
        {presets.length > 0 && !visible.length && (
          <p className="px-2 py-3 text-sm text-silkscreen-3">
            No presets match “{query}”.{" "}
            <button type="button" className="text-silkscreen underline underline-offset-2" onClick={() => useLibrary.setState({ localQuery: "" })}>
              Clear filter
            </button>
          </p>
        )}
        {visible.map((p) => (
          <PresetCard key={p.id} p={p} collection={current} />
        ))}
      </div>
    </div>
  );
}

function PresetCard({ p, collection }: { p: LocalPreset; collection: CollectionInfo }) {
  const selected = useLibrary((s) => s.localSelected === p.id);
  const lifted = useLibrary((s) => s.drag?.kind === "local" && s.drag.preset.id === p.id && s.drag.preset.collectionId === p.collectionId);
  const collections = useLibrary((s) => s.collections);
  const snapTones = useDevice((s) => s.snapTones);
  const connected = useDevice((s) => s.status === "connected");
  const device = useDevice((s) => s.device);
  const pedal = usePedalName();
  const actions = useLibraryActions();
  const s = summarize(p.prst);
  // The list says once what converting changes; cards only name the blocks this preset loses.
  const conversion = s ? conversionFor(s, device) : null;
  const lossy = conversion && isLossy(conversion) ? conversion : null;
  const dropped = lossy ? droppedSentence(lossy) : "";
  const lead = s ? ampOrSnapTone(s, snapTones) : null;
  const targets = writableCollections(collections).filter((c) => c.id !== collection.id);
  const meta = useMeta(p);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          role="option"
          aria-selected={selected}
          draggable
          onDragStart={(e) => startDrag(e, { kind: "local", preset: p }, LOCAL_MIME)}
          onDragEnd={endDrag}
          onClick={() => useLibrary.getState().selectLocal(p.id)}
          onDoubleClick={() => connected && actions.writeLocal(p)}
          className={cn(
            "relative flex shrink-0 cursor-grab flex-col gap-1.5 rounded-lg bg-faceplate px-3 pt-2 pb-2.5 text-left shadow-[0_0_0_1px_var(--seam)] hover:bg-faceplate-raised",
            selected && "bg-faceplate-raised shadow-[0_0_0_1px_var(--seam-strong)]",
            lifted && "bg-transparent opacity-45 shadow-[inset_0_0_0_1px_var(--seam-strong)]",
          )}
        >
          <span className="flex items-center gap-2">
            {p.slot !== null && <span className="text-xs font-semibold text-silkscreen-3 tabular-nums">{slotLabel(s?.device ?? collection.device, p.slot)}</span>}
            <span className="truncate font-[650] text-silkscreen">{p.name}</span>
            {s && (
              <Badge variant={lossy ? "warn" : "outline"} className="ml-auto">
                {pedalName(s.device)}
              </Badge>
            )}
          </span>
          <MiniChain chain={s} />
          <span className="flex min-w-0 items-center gap-2 text-xs text-silkscreen-3">
            {lead && <span className="truncate">{lead.title}</span>}
            <span className="truncate">{p.fileName}</span>
          </span>
          {(meta.stars > 0 || meta.tags.length > 0) && (
            <span className="flex min-w-0 items-center gap-2 text-xs text-silkscreen-3">
              {meta.stars > 0 && <span aria-label={`${meta.stars} stars`}>{"★".repeat(meta.stars)}</span>}
              <span className="truncate">{meta.tags.map((t) => `#${t}`).join(" ")}</span>
            </span>
          )}
          {dropped && (
            <span className="flex items-start gap-1.5 text-xs text-pretty text-silkscreen-3">
              <RefreshCwIcon className="mt-px size-3 shrink-0" aria-hidden />
              {dropped}
            </span>
          )}
          {!s && (
            <span className="flex items-start gap-1.5 text-xs text-led-fault">
              <InfoIcon className="mt-px size-3 shrink-0" aria-hidden />
              This file can't be read as a preset.
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem disabled={!connected || !s} onSelect={() => actions.writeLocal(p)}>
            <ArrowDownToLineIcon />
            {connected ? (p.slot !== null && collection.kind === "backup" ? `Restore to slot ${slotLabel(collection.device, p.slot)}…` : "Write to slot…") : `Write to slot (needs the ${pedal})`}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void actions.exportLocal([p])}>
            <DownloadIcon />
            Export .prst
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderPlusIcon />
              Add to collection
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuGroup>
                {targets.map((c) => (
                  <ContextMenuItem key={c.id} onSelect={() => void actions.addLocalToCollection([p], c.id)}>
                    {c.title}
                  </ContextMenuItem>
                ))}
                <ContextMenuItem onSelect={() => actions.collectionDialog({ kind: "new", then: (c) => void actions.addLocalToCollection([p], c.id) })}>New collection…</ContextMenuItem>
              </ContextMenuGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        {collection.kind !== "backup" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              <ContextMenuItem variant="destructive" onSelect={() => void actions.removeLocal(p)}>
                <Trash2Icon />
                Remove from {collection.title}
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
