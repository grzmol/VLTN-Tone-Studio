import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUi } from "@/state/ui";
import { WHATS_NEW_VERSION, saveWhatsNewSeen } from "@/state/whats-new";
import setlist from "@/assets/whats-new/setlist.webp";
import tuner from "@/assets/whats-new/tuner.webp";
import rigTools from "@/assets/whats-new/rig-tools.webp";
import songPart from "@/assets/whats-new/song-part.webp";
import { host } from "@/host";

const SLIDES = [
  { title: "Setlists and a stage mode", text: "Put a gig's presets in order, with a note on each song. Stage mode fills the window with the current preset and the next one, and follows the footswitch. If a slot is overwritten, the list tells you and offers to follow the preset.", image: setlist },
  {
    title: "Split just the part of a song you want",
    text: "Drag across the song's waveform to pick a riff or a solo, hear it, and split only that part. It splits faster, uses less memory, and Tone Match reads that one tone instead of the whole song's average.",
    image: songPart,
    credit: { handle: "carlosadrianosousa", note: "who also fixed the IR match recorder in packaged builds and a crash in Tones search" },
  },
  { title: "A tuner, with a mute switch", text: "A chromatic tuner on the pedal's USB audio or any input. A Mute switch sets Out to 0 while you tune and puts it back when you close the tuner.", image: tuner },
  { title: "A metronome, Randomize and Morph", text: "Click at the preset's tempo through the pedal's sound card, with its own volume. The shuffle button nudges every knob, or morphs the sound toward another preset. Both can be undone.", image: rigTools },
];

/** Help › What's new: a scroll-snap carousel of the release's headline features. Opens once after an upgrade (app/whats-new.ts). */
export function WhatsNewDialog() {
  const open = useUi((s) => s.whatsNewOpen);
  const setOpen = useUi((s) => s.setWhatsNewOpen);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);
  const goTo = (i: number) => track.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  const onScroll = () => {
    const el = track.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) saveWhatsNewSeen();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[720px] max-w-[calc(100vw-48px)] gap-4 sm:max-w-[720px]">
        <DialogTitle className="text-lg font-semibold tracking-[-0.012em]">What's new in {WHATS_NEW_VERSION}</DialogTitle>
        <DialogDescription className="sr-only">Highlights of this release.</DialogDescription>
        <div className="relative">
          <div ref={track} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SLIDES.map((s, i) => (
              <section key={s.title} aria-label={`${i + 1} of ${SLIDES.length}`} className="flex w-full shrink-0 snap-start flex-col gap-3">
                <img src={s.image} alt="" draggable={false} className="aspect-[3/2] max-h-[max(120px,calc(100vh-270px))] w-full rounded-sm border border-white/10 object-cover object-top" />
                <h3 className="text-[15px] font-semibold">{s.title}</h3>
                <p className="text-[13px] text-pretty text-silkscreen-2">{s.text}</p>
                {s.credit && (
                  <p className="text-[12px] text-pretty text-silkscreen-3">
                    Contributed by{" "}
                    <button type="button" className="text-silkscreen underline underline-offset-2" onClick={() => void host.app.openExternal(`https://github.com/${s.credit.handle}`)}>
                      @{s.credit.handle}
                    </button>
                    , {s.credit.note}.
                  </p>
                )}
              </section>
            ))}
          </div>
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous" disabled={index === 0} onClick={() => goTo(index - 1)}>
              <ChevronLeft />
            </Button>
            {SLIDES.map((s, i) => (
              <button key={s.title} type="button" aria-label={`Slide ${i + 1}`} aria-current={i === index} onClick={() => goTo(i)} className="grid size-5 place-items-center">
                <span className={`size-2 rounded-full ${i === index ? "bg-brand" : "bg-white/25"}`} />
              </button>
            ))}
            <Button variant="ghost" size="icon" aria-label="Next" disabled={index === SLIDES.length - 1} onClick={() => goTo(index + 1)}>
              <ChevronRight />
            </Button>
          </div>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
