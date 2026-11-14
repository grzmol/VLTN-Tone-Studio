import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useUi } from "@/state/ui";
import { WHATS_NEW_VERSION, saveWhatsNewSeen } from "@/state/whats-new";
import songLibrary from "@/assets/whats-new/song-library.webp";
import stemMixer from "@/assets/whats-new/stem-mixer.webp";
import band from "@/assets/whats-new/band.webp";
import midiCues from "@/assets/whats-new/midi-cues.webp";
import stageMode from "@/assets/whats-new/stage-mode.webp";
import soloScales from "@/assets/whats-new/solo-scales.webp";
import { host } from "@/host";

interface Slide {
  title: string;
  text: string;
  image: string;
  /** A contributor to thank under the slide: a GitHub handle and what they did. */
  credit?: { handle: string; note: string };
}

const SLIDES: Slide[] = [
  {
    title: "A song library and live sets",
    text: "Save a song with its stems, chart, tempo, key and mix, then put songs in playlists and sets. A set plays from one song to the next with crossfades or gapless joins, a queue shows what comes next, and a library backup takes everything with it.",
    image: songLibrary,
  },
  {
    title: "Play along with the stems",
    text: "A split song plays in a mixer with solo, level and output for each stem. Add a metronome and a count-in, jump to or loop a section, change the speed or the key, and turn on Practice mute to take your own part out of every song.",
    image: stemMixer,
  },
  {
    title: "A band behind you",
    text: "The Band panel finds the beat and writes drums and bass that follow the song's chords and sections. Choose the original, the generated part or both, fix a wrong bass note, give the drums and bass a tone, or import a song map that sets it all at once.",
    image: band,
  },
  {
    title: "Your pedals follow the song",
    text: "Put MIDI cues on song times or sections and they go out over USB or Bluetooth MIDI while the song plays: program changes, CCs and named commands for the GP-150, GP-180 and other pedals. Preflight checks the setup before the show.",
    image: midiCues,
  },
  {
    title: "Stage mode, lyrics and chords",
    text: "Lyrics come from the vocals and chords from the stems, and the chart follows playback in large type. Stage mode locks editing, an audience window shows the words on a second screen, and bandmates can follow on their phones with Band sync.",
    image: stageMode,
  },
  {
    title: "Where to solo",
    text: "Solo scale shows the song's scale on the neck, for the key as you play it, with the pitch shift and capo taken in. It opens on the minor pentatonic, offers seven other scales, lights up one box position at a time, and writes fret numbers or note names.",
    image: soloScales,
  },
];

function SlideCredit({ credit }: { credit: NonNullable<Slide["credit"]> }) {
  return (
    <p className="text-[12px] text-pretty text-silkscreen-3">
      Contributed by{" "}
      <button type="button" className="text-silkscreen underline underline-offset-2" onClick={() => void host.app.openExternal(`https://github.com/${credit.handle}`)}>
        @{credit.handle}
      </button>
      , {credit.note}.
    </p>
  );
}

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
                {s.credit && <SlideCredit credit={s.credit} />}
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
