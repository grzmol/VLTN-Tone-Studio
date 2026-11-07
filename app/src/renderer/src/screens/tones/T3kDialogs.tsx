import { useEffect, useLayoutEffect, useState } from "react";
import { Cable, Filter, LogIn, X } from "lucide-react";
import type { ViewBounds } from "@shared/host/tones";
import { firstEmptySlot, sanitizeSlotName } from "@shared/tone3000";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { host } from "@/host";
import { useDevice, usePedalName, usePedalNameOrBoth } from "@/state/device";
import { pedalName, profileOrDefault } from "@/state/device-model";
import type { OpenFile } from "@/state/ui";
import { prepareUserIr, type UserIrFile } from "@/userir/convert";
import { notifyError, notifySuccess } from "@/app/notify";
import { SLOT_NAME_MAX } from "@/gp200/lib/session.mjs";
import { closeFlow, closeLinkChoice, closeRename, closeSplash, continueFromSplash, irSlotLabel, linkSlot, loadAccount, loadAllCounts, loadTab, readSlots, renameSlot, slotLabel, takePickedTone, useTones } from "./store";
import { ToneImage } from "./ToneImage";
import { irOccupant, irSummary, ReplaceIrNote, UserIrSlotPicker, useIrWriteBlocker } from "./UserIrParts";

/** TONE3000 partnership splash, before the first sign-in from any entry point. */
export function SplashDialog() {
  const open = useTones((s) => s.splashOpen);
  const model = usePedalNameOrBoth();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSplash()}>
      <DialogContent className="max-w-[460px] gap-5 p-7" showCloseButton={false}>
        <DialogHeader className="gap-4">
          <DialogTitle className="flex items-center gap-3 text-[15px]">
            <span className="flex items-center gap-2 font-semibold">
              <Cable className="size-4" aria-hidden />
              VLTN Tone Studio
            </span>
            <span className="text-silkscreen-3" aria-label="and">
              ×
            </span>
            <span className="text-[12px] font-extrabold tracking-[0.02em] text-silkscreen">TONE3000</span>
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.5] text-pretty text-silkscreen-2">
            VLTN Tone Studio has partnered with TONE3000 to give you access to a massive library of Neural Amp Modeler (NAM) captures and IRs of real analog gear, created by a
            global community of musicians.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2.5 text-[12px] text-silkscreen-2">
          <li className="flex gap-2.5">
            <LogIn className="size-4 flex-none text-silkscreen-3" aria-hidden />
            Sign in on TONE3000 with your email and a 6-digit code.
          </li>
          <li className="flex gap-2.5">
            <Filter className="size-4 flex-none text-silkscreen-3" aria-hidden />
            NAM A1 and A2 captures both work: Tone Studio turns them into {model} SnapTones.
          </li>
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={closeSplash}>
            Not now
          </Button>
          <Button onClick={continueFromSplash} autoFocus>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function boundsOf(el: HTMLElement): ViewBounds {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/**
 * The sign-in / Select / Load Tone flow: TONE3000 renders in a native WebContentsView that main lays over the
 * area of the host element; the dialog frame (title, Close) stays outside it so the app can always cancel.
 */
export function FlowDialog() {
  const open = useTones((s) => s.flowOpen);
  const req = useTones((s) => s.flow);
  // Callback ref: the dialog portal mounts its content one render after `open` flips.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useLayoutEffect(() => {
    if (!open || !req || !el) return;
    setError(null);
    setRunning(true);
    let live = true;
    void host.tones.beginFlow(req, boundsOf(el)).then(
      async (result) => {
        if (!live) return;
        setRunning(false);
        if (result.status === "error") {
          setError(result.message);
          return;
        }
        closeFlow();
        if (result.status === "connected") {
          await loadAccount();
          loadAllCounts();
          void loadTab(useTones.getState().tab, { refresh: true });
          if (result.toneId) takePickedTone(result.toneId);
        }
      },
      (e) => {
        if (!live) return;
        setRunning(false);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    // Track the frame: dialog open animation, window resizes.
    const sync = () => void host.tones.setFlowBounds(boundsOf(el));
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    const settle = window.setTimeout(sync, 260);
    return () => {
      live = false;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.clearTimeout(settle);
      void host.tones.cancelFlow();
    };
  }, [open, req, el]);

  const title = !req?.prompt || req.prompt === "load_tone" ? "Sign in to TONE3000" : req.format === "ir" ? "Browse TONE3000 IRs" : "Browse TONE3000";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeFlow()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-96px)] w-[min(960px,calc(100vw-96px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        aria-describedby={undefined}
        onEscapeKeyDown={() => closeFlow()}
      >
        <DialogHeader className="flex-row items-center gap-3 border-b border-border py-2 pr-2 pl-5">
          <span className="text-[12px] font-extrabold tracking-[0.02em] text-silkscreen">TONE3000</span>
          <DialogTitle className="grow text-[13px] font-semibold text-silkscreen-2">{title}</DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label="Close TONE3000" onClick={closeFlow}>
            <X />
          </Button>
        </DialogHeader>
        <div ref={setEl} className="relative min-h-0 flex-1 bg-well">
          {(running || error) && (
            <div className="absolute inset-0 grid place-items-center p-8 text-center">
              {error ? (
                <div className="flex max-w-sm flex-col items-center gap-3">
                  <p role="alert" className="text-[13px] text-pretty text-silkscreen-2">
                    {error}
                  </p>
                  <Button variant="outline" onClick={closeFlow}>
                    Close
                  </Button>
                </div>
              ) : (
                <Spinner aria-label="Loading TONE3000" />
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Slot context menu: pick the downloaded tone a slot holds. */
export function LinkDialog() {
  const choice = useTones((s) => s.linkChoice);
  const records = useTones((s) => s.records);
  const snapTones = useDevice((s) => s.snapTones);
  const userIRs = useDevice((s) => s.userIRs);
  const [busy, setBusy] = useState(false);

  const link = async (toneId: number) => {
    if (!choice) return;
    setBusy(true);
    try {
      await linkSlot(toneId, choice.kind, choice.slot);
    } catch (e) {
      notifyError("Couldn't link the slot", e);
    } finally {
      setBusy(false);
    }
  };

  const list = choice ? Object.values(records).filter((r) => (choice.kind === "snaptone" ? r.format === "nam" : r.format === "ir")) : [];
  const slotName = choice ? ((choice.kind === "snaptone" ? snapTones : userIRs)?.find((s) => s.slot === choice.slot)?.name ?? "") : "";
  const title = choice ? `Link ${slotLabel(choice.kind, choice.slot)} ${slotName} to a TONE3000 tone` : "";

  return (
    <Dialog open={choice !== null} onOpenChange={(o) => !o && closeLinkChoice()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pick the downloaded tone this slot holds. Linking only adds a note in Tone Studio; nothing changes on the pedal.</DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-80 flex-col gap-1 overflow-auto">
          {list.map((r) => (
            <li key={r.tone_id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void link(r.tone_id)}
                className="flex w-full items-center gap-3 rounded-sm p-1.5 text-left hover:bg-accent disabled:opacity-50"
              >
                <ToneImage url={r.image_url} gear={r.gear} format={r.format} alt="" square caption={false} className="w-10 [&_svg]:size-4" />
                <span className="flex min-w-0 flex-col">
                  <b className="truncate text-[13px] font-semibold">{r.title}</b>
                  <span className="text-[12px] text-silkscreen-3">{r.creator.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={closeLinkChoice}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Printable ASCII the pedal shows, upper case like the names Tone Studio sends, at most SLOT_NAME_MAX characters. */
const slotRenameText = (text: string) =>
  Array.from(text.toUpperCase())
    .filter((c) => c >= " " && c <= "~")
    .join("")
    .slice(0, SLOT_NAME_MAX);

/** Slot context menu: rename a stored SnapTone or User IR on the pedal (only the name changes). */
export function RenameSlotDialog() {
  const choice = useTones((s) => s.renameChoice);
  const snapTones = useDevice((s) => s.snapTones);
  const userIRs = useDevice((s) => s.userIRs);
  const current = choice ? ((choice.kind === "snaptone" ? snapTones : userIRs)?.find((s) => s.slot === choice.slot)?.name ?? "") : "";
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The pedal may keep trailing spaces ("IR ORANGE 4X12 "); the field starts without them
    if (choice) setName(slotRenameText(current.trim()));
    // Fill in the slot's name each time the dialog opens for a slot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice]);

  const next = name.trim();
  const ready = next !== "" && next !== current.trim() && !busy;

  const rename = async () => {
    if (!choice || !ready) return;
    setBusy(true);
    try {
      await renameSlot(choice.kind, choice.slot, next);
    } catch (e) {
      notifyError("Couldn't rename the slot", e);
    } finally {
      setBusy(false);
    }
  };

  const label = choice ? slotLabel(choice.kind, choice.slot) : "";
  return (
    <Dialog open={choice !== null} onOpenChange={(o) => !o && !busy && closeRename()}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Rename {label}</DialogTitle>
          <DialogDescription>Changes only the name the pedal shows, up to {SLOT_NAME_MAX} characters. The sound and the presets that use it stay as they are.</DialogDescription>
        </DialogHeader>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input autoFocus aria-label={`New name for ${label}`} value={name} maxLength={SLOT_NAME_MAX} disabled={busy} onChange={(e) => setName(slotRenameText(e.target.value))} />
          <span className="flex-none text-[12px] text-silkscreen-3">
            {name.length}/{SLOT_NAME_MAX}
          </span>
        </form>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={closeRename}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void rename()}>
            {busy ? <Spinner /> : null}
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bytes of an opened or dropped file: the File when there is one, else main reads it by path. */
async function readOpenFile(file: OpenFile): Promise<Uint8Array> {
  if (file.file) return new Uint8Array(await file.file.arrayBuffer());
  if (file.path) return host.tones.readLocalIr(file.path);
  throw new Error(`Couldn't read ${file.name}.`);
}

/**
 * A WAV opened, dropped or made by Tone Match: convert it for the pedal and write it to the User IR slot the user
 * picks. The Write button is the confirmation; an occupied slot says what it replaces.
 */
export function LocalIrDialog({ file, onClose }: { file: OpenFile | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<number | null>(null);
  const [ir, setIr] = useState<UserIrFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);
  const connected = useDevice((s) => s.status === "connected");
  const userIRs = useDevice((s) => s.userIRs);
  const device = useDevice((s) => s.device);
  const busy = useDevice((s) => s.busy);
  const blocker = useIrWriteBlocker(slot);
  const replacing = irOccupant(userIRs, slot);
  const pedal = usePedalName();

  useEffect(() => {
    if (!file) return;
    let current = true;
    setName(sanitizeSlotName(file.name.replace(/\.wav$/i, "").toUpperCase()));
    setSlot(null);
    setIr(null);
    setError(null);
    setProgress(0);
    readOpenFile(file)
      .then((bytes) => current && setIr(prepareUserIr(bytes, profileOrDefault(useDevice.getState().device).userIr.samples)))
      .catch((e) => current && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      current = false;
    };
  }, [file]);

  // The slot list comes from the pedal; propose the first empty slot once it is known.
  useEffect(() => {
    if (file && connected && !userIRs && !busy) void readSlots();
  }, [file, connected, userIRs, busy]);
  useEffect(() => {
    if (file && slot === null && userIRs) setSlot(firstEmptySlot("ir", userIRs, device));
  }, [file, slot, userIRs, device]);

  const write = async () => {
    if (!file || !ir || slot === null) return;
    setWriting(true);
    setError(null);
    setProgress(0);
    try {
      const stored = await useDevice.getState().uploadUserIr(slot, name, ir.data, { onProgress: setProgress });
      notifySuccess(`Wrote ${irSlotLabel(slot)} on your ${pedalName(useDevice.getState().device)}`, `${file.name} is in the slot as ${stored}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(false);
    }
  };

  const slotText = slot === null ? "a User IR slot" : irSlotLabel(slot);
  return (
    <Dialog open={file !== null} onOpenChange={(o) => !o && !writing && onClose()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Write {file?.name} to a User IR slot</DialogTitle>
          <DialogDescription>Tone Studio converts the WAV for the {pedal} and writes it over USB. Nothing changes on the pedal until you press Write.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-[12px]">
          {ir ? <p className="text-pretty text-silkscreen-3">{irSummary(ir)}</p> : !error && <Spinner aria-label="Checking the file" />}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-silkscreen-2">
              Name on the pedal
              <Input value={name} maxLength={10} disabled={writing} onChange={(e) => setName(sanitizeSlotName(e.target.value.toUpperCase()))} className="h-8 w-36" />
            </label>
            <span className="text-[11px] text-silkscreen-3">{name.length}/10</span>
            <UserIrSlotPicker value={slot} onChange={setSlot} disabled={writing} />
          </div>
          {replacing && !writing && <ReplaceIrNote name={replacing} />}
          {writing && <Progress value={progress * 100} className="w-56" aria-label="User IR write progress" />}
          {error && (
            <p role="alert" className="text-pretty text-led-fault">
              {error}
            </p>
          )}
          {blocker && !writing && <p className="text-[11px] text-silkscreen-3">{blocker}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={writing} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ir || !name || writing || blocker !== null} onClick={() => void write()}>
            {writing && <Spinner data-icon="inline-start" />}
            {replacing ? `Replace ${replacing} in ${slotText}` : `Write to ${slotText}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
