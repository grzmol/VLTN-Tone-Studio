import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Heart, LogOut, RefreshCw, Search, UserRound } from "lucide-react";
import type { T3kTone, ToneListKind } from "@shared/host/tones";
import { toneVerdict } from "@shared/tone3000";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { host, isElectron } from "@/host";
import { useDevice, usePedalName, usePedalNameOrBoth } from "@/state/device";
import { useNav } from "@/state/nav";
import { useCommand, useFileHandler, useStatusHints, useUi, type OpenFile } from "@/state/ui";
import { modKey } from "@/app/keys";
import { notifyError } from "@/app/notify";
import {
  browse,
  loadAccount,
  loadAllCounts,
  loadList,
  loadTab,
  type TonesTab,
  loadRecords,
  loadUsage,
  onSendProgress,
  openSheet,
  readSlots,
  signIn,
  signOut,
  TAB_ORDER,
  useTones,
} from "./store";
import { CreatorAvatar, DiscoverCard, ToneCard, ToneCardSkeleton } from "./ToneCard";
import { SearchBar } from "./SearchBar";
import { SlotPanel } from "./SlotPanel";
import { ToneSheet } from "./ToneSheet";
import { FlowDialog, LinkDialog, LocalIrDialog, SplashDialog } from "./T3kDialogs";
import { LocalNamDialog } from "./LocalNamDialog";

const TAB_LABEL: Record<ToneListKind, string> = { favorited: "Favorites", created: "Created", downloaded: "Downloaded", trending: "Trending", latest: "Latest" };
const EMPTY_COPY: Record<ToneListKind, { text: string; browse: boolean }> = {
  favorited: { text: "No favorites yet. Favorite a tone on TONE3000 and it appears here.", browse: true },
  created: { text: "You haven't uploaded tones to TONE3000.", browse: true },
  downloaded: { text: "Tones you download appear here.", browse: false },
  trending: { text: "Nothing is trending right now.", browse: true },
  latest: { text: "No new tones right now.", browse: true },
};
const SEARCH_EMPTY = "No tones match this search.";
const HINTS = [
  { keys: ["B"], label: "browse TONE3000" },
  { keys: ["Enter"], label: "open tone" },
  { keys: ["R"], label: "read slots again" },
];
const T3K_HOME = "https://www.tone3000.com";

/** "Browse TONE3000" on the desktop opens the Select flow; the web build can only link out. */
function browseOrLinkOut() {
  if (isElectron) browse();
  else host.app.openExternal(T3K_HOME).catch((e) => notifyError("Couldn't open TONE3000", e));
}

export function TonesScreen() {
  const account = useTones((s) => s.account);
  const tab = useTones((s) => s.tab);
  const status = useDevice((s) => s.status);
  const hasSlots = useDevice((s) => s.snapTones !== null && s.userIRs !== null);
  const device = useDevice((s) => s.device);
  const param = useNav((s) => s.param);
  const [localIr, setLocalIr] = useState<OpenFile | null>(null);
  const [localNam, setLocalNam] = useState<OpenFile | null>(null);
  const signedIn = account?.status === "signed-in";

  useEffect(() => {
    void loadAccount();
    void loadRecords();
    return host.tones.onEvent((ev) => onSendProgress(ev.toneId, ev.step, ev.received, ev.total));
  }, []);

  // "Used in" comes from a backup of this pedal model.
  useEffect(() => {
    void loadUsage();
  }, [device]);

  // Read the slot tables once per connection (the link step re-runs on every read).
  useEffect(() => {
    if (status === "connected" && !hasSlots) void readSlots();
  }, [status, hasSlots]);

  useEffect(() => {
    if (!signedIn) return;
    if (tab !== "search") void loadList(tab); // the search tab loads from its own bar
    loadAllCounts();
  }, [signedIn, tab]);

  // Entry from elsewhere (capture editor, Rig): ?screen=tones&param=<tone id> opens that tone.
  useEffect(() => {
    const id = Number(param);
    if (param && Number.isInteger(id) && id > 0) openSheet(id);
  }, [param]);

  useCommand("browse-tone3000", browseOrLinkOut);
  // A .wav opened or dropped anywhere goes to a User IR slot (Song takes it while Song is showing).
  useFileHandler("wav", (files) => setLocalIr(files[0] ?? null));
  // A .nam opened or dropped while Tones is showing becomes a SnapTone here (elsewhere it opens the capture editor).
  useFileHandler("nam", (files) => setLocalNam(files[0] ?? null));
  useStatusHints(HINTS);
  useShortcuts();

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_clamp(336px,34vw,448px)] gap-6 px-6 pb-4">
      <section aria-label="Your TONE3000 tones" className="@container flex min-h-0 min-w-0 flex-col gap-3.5">
        <Head />
        <ToneLists />
      </section>
      <SlotPanel onAddNam={setLocalNam} />
      <ToneSheet />
      <SplashDialog />
      <FlowDialog />
      <LinkDialog />
      <LocalIrDialog file={localIr} onClose={() => setLocalIr(null)} />
      <LocalNamDialog file={localNam} onClose={() => setLocalNam(null)} />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      const s = useTones.getState();
      if (s.sheet || s.splashOpen || s.flowOpen || s.linkChoice || useUi.getState().paletteOpen) return;
      if (modKey(e) && !e.altKey && !e.shiftKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        useTones.setState({ tab: [...TAB_ORDER, "search" as const][Number(e.key) - 1] });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        browseOrLinkOut();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void readSlots();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Head() {
  const account = useTones((s) => s.account);
  const user = account?.user;
  const pedal = usePedalName();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 pt-5 pb-1">
      <h1 className="col-start-1 row-start-1 text-[32px] leading-[1.1] font-bold tracking-[-0.02em] text-balance">Tones</h1>
      <p className="col-start-1 row-start-2 mt-1.5 text-[12px] text-pretty text-silkscreen-3 @max-[799px]:col-span-2">NAM captures and IRs from TONE3000, and what's on your {pedal}.</p>
      <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-3 @max-[799px]:row-span-1 @max-[799px]:self-center @max-[619px]:col-span-2 @max-[619px]:col-start-1 @max-[619px]:row-start-3 @max-[619px]:mt-2.5 @max-[619px]:flex-wrap">
        <span className="text-[12px] font-extrabold tracking-[0.02em] whitespace-nowrap text-silkscreen" aria-label="TONE3000">
          TONE3000
        </span>
        <Separator orientation="vertical" className="h-5 self-center" />
        {account?.status === "signed-in" && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`TONE3000 account ${user.username}`}>
                <CreatorAvatar username={user.username} url={user.avatar_url} className="size-6" />
                <b className="font-semibold text-silkscreen">{user.display_name ?? user.username}</b>
                <ChevronDown data-icon="inline-end" className="text-silkscreen-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => host.app.openExternal(user.url).catch((e) => notifyError("Couldn't open your profile", e))}>
                  <UserRound />
                  Open my TONE3000 profile
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void signOut().catch((e) => notifyError("Couldn't sign out", e))}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : account?.status === "expired" ? (
          <Button variant="ghost" size="sm" onClick={() => void signIn()}>
            Sign in again
          </Button>
        ) : (
          <span className="text-[12px] whitespace-nowrap text-silkscreen-3">Not signed in</span>
        )}
        <Button onClick={browseOrLinkOut}>
          <ExternalLink data-icon="inline-start" />
          Browse TONE3000
        </Button>
      </div>
    </div>
  );
}

function ToneLists() {
  const account = useTones((s) => s.account);
  const tab = useTones((s) => s.tab);
  const format = useTones((s) => s.format);
  const compatOnly = useTones((s) => s.compatOnly);
  const lists = useTones((s) => s.lists);
  const signedIn = account?.status === "signed-in";
  const model = usePedalNameOrBoth();

  return (
    <Tabs value={tab} onValueChange={(v) => useTones.setState({ tab: v as TonesTab })} className="min-h-0 flex-1 gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5 whitespace-nowrap">
        <TabsList aria-label="TONE3000 lists" className="max-w-full [&_[role=tab]]:flex-none [&_[role=tab]]:px-3 @max-[860px]:[&_[role=tab]]:px-2.5 @max-[860px]:[&_[role=tab]>span]:hidden">
          {TAB_ORDER.map((kind) => {
            const list = lists[kind];
            const count = kind !== "trending" && kind !== "latest" && list?.loaded ? list.total : null;
            return (
              <span key={kind} className="contents">
                {kind === "trending" && <span aria-hidden className="mx-1 h-3.5 w-px self-center bg-seam-strong" />}
                <TabsTrigger value={kind}>
                  {kind === "favorited" && <Heart />}
                  {TAB_LABEL[kind]}
                  {count !== null && <span className="font-medium text-silkscreen-3 tabular-nums">{count}</span>}
                </TabsTrigger>
              </span>
            );
          })}
          <span aria-hidden className="mx-1 h-3.5 w-px self-center bg-seam-strong" />
          <TabsTrigger value="search">
            <Search />
            Search
          </TabsTrigger>
        </TabsList>
        <ToggleGroup type="single" spacing={1.5} value={format} onValueChange={(v) => v && useTones.setState({ format: v as "all" | "nam" | "ir" })} aria-label="Format">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="nam">NAM</ToggleGroupItem>
          <ToggleGroupItem value="ir">IR</ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex h-8 items-center gap-2">
          <Switch id="gp5-compatible" checked={compatOnly} onCheckedChange={(v) => useTones.setState({ compatOnly: v })} aria-describedby="gp5-compatible-hint" />
          <Label htmlFor="gp5-compatible" className="text-[12px] font-normal text-silkscreen-2">
            {model} compatible only
          </Label>
          <span id="gp5-compatible-hint" className="sr-only">
            Hides tones the {model} can't load from the list already loaded
          </span>
        </div>
      </div>
      <TabsContent value={tab} className="flex min-h-0 flex-col gap-3">
        {account === null ? (
          <SkeletonGrid />
        ) : signedIn ? (
          <>
            {tab === "search" && <SearchBar />}
            <ToneGrid kind={tab} />
          </>
        ) : (
          <SignedOut desktopOnly={!isElectron} />
        )}
      </TabsContent>
    </Tabs>
  );
}

function SignedOut({ desktopOnly }: { desktopOnly?: boolean }) {
  const account = useTones((s) => s.account);
  const go = useNav((s) => s.go);
  let text = "Sign in to TONE3000 to see your favorites, uploads and downloads here.";
  if (desktopOnly) text = "TONE3000 sign-in, lists and downloads need the desktop app. The slot map on the right works here too.";
  else if (account && !account.configured) text = "No TONE3000 app key is set, so Tone Studio can't sign in. Enter one in Settings. The slot map on the right still works.";
  else if (account?.status === "expired") text = "Your TONE3000 sign-in expired. Sign in again to see your tones.";
  return (
    <Empty className="flex-1 rounded-lg shadow-[inset_0_0_0_1px_var(--seam)]">
      <EmptyHeader>
        <span className="text-[15px] font-extrabold tracking-[0.02em] text-silkscreen">TONE3000</span>
        <EmptyTitle className="sr-only">TONE3000 tones</EmptyTitle>
        <EmptyDescription className="max-w-sm text-pretty">{text}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {desktopOnly ? (
          <Button variant="outline" onClick={browseOrLinkOut}>
            <ExternalLink data-icon="inline-start" />
            Open TONE3000 in your browser
          </Button>
        ) : account?.configured ? (
          <Button onClick={() => void signIn()}>{account.status === "expired" ? "Sign in again" : "Sign in to TONE3000"}</Button>
        ) : account ? (
          <Button variant="outline" onClick={() => go("device", "settings")}>
            Open Settings
          </Button>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3" aria-busy="true" aria-label="Loading tones">
      {Array.from({ length: 8 }, (_, i) => (
        <ToneCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * The tone cards of a list or the search results, with infinite scroll. `onOpen` takes a tone's card instead of the tone sheet, so the
 * Band panel's picker can reuse the grid.
 */
export function ToneGrid({ kind, onOpen = openSheet }: { kind: TonesTab; onOpen?: (toneId: number, tone: T3kTone) => void }) {
  const list = useTones((s) => (kind === "search" ? s.found : s.lists[kind]));
  const records = useTones((s) => s.records);
  const format = useTones((s) => s.format);
  const compatOnly = useTones((s) => s.compatOnly);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const tones = useMemo(
    () =>
      (list?.tones ?? []).filter((t) => {
        if (format !== "all" && t.format !== format) return false;
        return !compatOnly || toneVerdict(t, records[t.id]).kind !== "not-loadable";
      }),
    [list, format, compatOnly, records],
  );

  // Infinite scroll: 20 per page.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !list || list.error || list.page >= list.totalPages) return; // after an error only Retry loads again
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadTab(kind, { more: true }), { root: gridRef.current, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [kind, list]);

  // Roving tabindex across the grid: arrows move by one card or one row.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const cards = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-tone-card]") ?? []);
      const i = cards.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      const cols = getComputedStyle(gridRef.current!).gridTemplateColumns.split(" ").length;
      const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
      const next = e.key === "Home" ? 0 : e.key === "End" ? cards.length - 1 : step[e.key] !== undefined ? i + step[e.key] : -1;
      if (next < 0 || next >= cards.length) return;
      e.preventDefault();
      setFocusIndex(next);
      cards[next].focus();
    },
    [],
  );

  const stale = list?.error && list.loaded;
  const fetchedAt = list?.fetchedAt ? new Date(list.fetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
  const rateLimited = list?.error?.startsWith("TONE3000 asks us to slow down");

  return (
    <>
      {list?.error && (
        <Alert className="flex items-center gap-3">
          <AlertDescription className="grow">
            {rateLimited ? list.error : stale ? `Can't reach TONE3000. Showing tones from ${fetchedAt}.` : list.error}
          </AlertDescription>
          {kind === "search" && (
            <Button variant="outline" size="sm" onClick={browseOrLinkOut}>
              <ExternalLink data-icon="inline-start" />
              Browse TONE3000
            </Button>
          )}
          <RetryButton onRetry={() => loadTab(kind, { refresh: true })} />
        </Alert>
      )}
      {!list?.loaded && list?.loading !== false ? (
        <SkeletonGrid />
      ) : (
        <div
          ref={gridRef}
          onKeyDown={onKeyDown}
          className="-m-0.5 grid min-h-0 auto-rows-max grid-cols-[repeat(auto-fill,minmax(176px,1fr))] content-start gap-3 overflow-auto p-0.5"
        >
          {tones.map((t, i) => (
            <ToneCard
              key={t.id}
              tone={t}
              record={records[t.id]}
              tabIndex={i === Math.min(focusIndex, tones.length - 1) ? 0 : -1}
              onFocus={() => setFocusIndex(i)}
              onOpen={() => onOpen(t.id, t)}
            />
          ))}
          {list?.loaded && tones.length === 0 && (list?.tones.length ?? 0) === 0 && (
            <div className="col-span-full flex items-center gap-3 py-2 text-[13px] text-silkscreen-2">
              <span>{kind === "search" ? SEARCH_EMPTY : EMPTY_COPY[kind].text}</span>
            </div>
          )}
          {list?.loaded && tones.length === 0 && (list?.tones.length ?? 0) > 0 && (
            <p className="col-span-full py-2 text-[13px] text-silkscreen-2">No tones in this list match the filters.</p>
          )}
          {list?.loading && list.loaded && Array.from({ length: 4 }, (_, i) => <ToneCardSkeleton key={`s${i}`} />)}
          {kind !== "search" && (!list || list.page >= list.totalPages) && (EMPTY_COPY[kind].browse || tones.length > 0) && <DiscoverCard onBrowse={browseOrLinkOut} />}
          <div ref={sentinelRef} className="col-span-full h-px" aria-hidden />
        </div>
      )}
    </>
  );
}

/** Rate limit: the retry stays disabled for 5 s after use. */
function RetryButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const [cool, setCool] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={cool}
      onClick={() => {
        setCool(true);
        window.setTimeout(() => setCool(false), 5000);
        void onRetry();
      }}
    >
      <RefreshCw data-icon="inline-start" />
      Retry
    </Button>
  );
}
