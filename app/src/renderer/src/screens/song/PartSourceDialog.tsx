// Choosing a part tone's capture or IR (bass or drums): the TONE3000 browser's own search bar and tone grid, started on the role's gear, or a file
// on this computer. The browser's filters are put back when the dialog closes, so the Tones screen shows what it showed before.
import { useState } from "react";
import type { T3kGear, T3kTone } from "@shared/host/tones";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { host } from "@/host";
import type { PartToneFile, TonePart, ToneRole } from "@/song/band/arrangement";
import { SearchBar } from "@/screens/tones/SearchBar";
import { ToneGrid } from "@/screens/tones/TonesScreen";
import { loadAccount, loadRecords, useTones, type SearchFilters } from "@/screens/tones/store";

/** The gear a block can be: the TONE3000 search for it starts on that gear. */
export type PartSourceRole = ToneRole;
export type BassSourceRole = PartSourceRole;

/**
 * The search a bass block starts from, per role. TONE3000's metadata has no instrument field, so "bass" in the search and the gear of the
 * role are the closest the API can get. The user can change any of it.
 */
const ROLE_GEARS: Record<PartSourceRole, { format: "nam" | "ir"; gears: T3kGear[] }> = {
  pedal: { format: "nam", gears: ["pedal"] },
  preamp: { format: "nam", gears: ["outboard"] },
  amp: { format: "nam", gears: ["amp", "amp-cab"] },
  cab: { format: "ir", gears: ["cab"] },
  space: { format: "ir", gears: ["space"] },
  outboard: { format: "nam", gears: ["outboard"] },
};

/** The search a role starts from. The bass searches for "bass"; drums have no instrument word, so they start on the gear alone. */
function rolePreset(part: TonePart, role: PartSourceRole): { format: "nam" | "ir"; search: SearchFilters } {
  const { format, gears } = ROLE_GEARS[role];
  return { format, search: { query: part === "bass" ? "bass" : "", sort: "trending", gears, architecture: null } };
}
const TITLE: Record<PartSourceRole, string> = {
  pedal: "Choose a bass pedal",
  preamp: "Choose a preamp",
  amp: "Choose a bass amp",
  cab: "Choose a cab IR",
  space: "Choose a space IR",
  outboard: "Choose an outboard capture",
};
const KIND_NAME: Record<PartSourceRole, string> = {
  pedal: "pedal",
  preamp: "preamp",
  amp: "amp",
  cab: "cab IR",
  space: "space IR",
  outboard: "outboard capture",
};
const KIND_PLURAL: Record<PartSourceRole, string> = {
  pedal: "pedals",
  preamp: "preamps",
  amp: "amps",
  cab: "cab IRs",
  space: "space IRs",
  outboard: "outboard captures",
};

let savedSearch: { format: "all" | "nam" | "ir"; search: SearchFilters } | null = null;

/** Starts the browser on the role's preset, keeping what it had to put back on close. Call before the dialog opens, so its search is the first. */
export function presetPartSearch(part: TonePart, role: PartSourceRole): void {
  const before = useTones.getState();
  savedSearch ??= { format: before.format, search: before.search };
  useTones.setState(rolePreset(part, role));
  if (before.account === null) void loadAccount();
}

/** Puts back the browser's filters from before presetPartSearch. */
export function restorePartSearch(): void {
  if (savedSearch) useTones.setState(savedSearch);
  savedSearch = null;
}

/** The bass names of the search helpers. */
export const presetBassSearch = (role: PartSourceRole) => presetPartSearch("bass", role);
export const restoreBassSearch = restorePartSearch;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The model a capture uses: A2 first, then A1, as the capture editor opens a tone. An IR has one model. */
function modelFor(format: "nam" | "ir", models: { id: number; architecture_version: string | null }[]) {
  if (format === "ir") return models[0];
  return models.find((m) => m.architecture_version === "2") ?? models.find((m) => m.architecture_version === "1");
}

export interface PartSourceDialogProps {
  part: TonePart;
  role: PartSourceRole;
  open: boolean;
  onClose(): void;
  /** The chosen capture or cab IR. The dialog is closed by the caller. */
  onPick(file: PartToneFile): void;
}

export function PartSourceDialog({ part, role, open, onClose, onPick }: PartSourceDialogProps) {
  const format = ROLE_GEARS[role].format;
  const account = useTones((s) => s.account);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedIn = account?.status === "signed-in";

  /** Downloads the tone's model into the tone folder, then hands it to the picker. */
  const pickTone = async (toneId: number, tone: T3kTone) => {
    setError(null);
    if (tone.format !== format) {
      setError(`${tone.title} is ${tone.format === "ir" ? "an IR" : "a NAM capture"}, not a${part === "bass" ? " bass" : "n"} ${KIND_NAME[role]}.`);
      return;
    }
    setBusy(`Downloading ${tone.title}…`);
    try {
      const model = modelFor(format, await host.tones.models(toneId));
      if (!model) throw new Error(`${tone.title} has no model that can be used.`);
      const { record } = await host.tones.downloadModel(toneId, model.id);
      void loadRecords();
      const older = model.architecture_version === "1" ? { older: true } : {};
      onPick({ source: "tone3000", toneId, modelId: model.id, name: record.title, ...older });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async () => {
    setError(null);
    try {
      const picked = await host.tones.chooseLocalFile(format);
      if (picked) onPick({ source: "file", path: picked.path, name: picked.name });
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] min-w-0 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{TITLE[role]}</DialogTitle>
          <DialogDescription>
            Search TONE3000 for one, or open a file from this computer. The choice is used the next time you press Generate.
          </DialogDescription>
        </DialogHeader>
        {signedIn ? (
          <div className="flex h-[50vh] min-h-64 flex-col gap-3 [&>div:last-child]:min-h-0 [&>div:last-child]:flex-1">
            <SearchBar />
            <ToneGrid kind="search" onOpen={(toneId, tone) => void pickTone(toneId, tone)} />
          </div>
        ) : (
          <p className="text-silkscreen-2">Sign in to TONE3000 on the Tones screen to search its {KIND_PLURAL[role]} here.</p>
        )}
        {busy && <p role="status">{busy}</p>}
        {error && (
          <p role="alert" className="text-led-fault">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-seam pt-3">
          <Button variant="outline" onClick={() => void chooseFile()} disabled={busy !== null}>
            {format === "nam" ? "Open a .nam file…" : "Open a .wav file…"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
