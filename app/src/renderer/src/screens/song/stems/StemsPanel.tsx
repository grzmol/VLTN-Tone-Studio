import { useEffect, useRef, useState } from "react";
import { AudioLines, FileUp, RotateCcw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useSong } from "@/song/store";
import { findModel, missingBytes, type SeparationModel } from "@shared/host/song";
import { StemMixer } from "./StemMixer";
import { megabytes, SplitOptions, useDownloadedFiles } from "./SplitOptions";

const PANEL = "glass rounded-xl min-w-0 min-h-0";
const SPLIT_DETAIL = {
  starting: "Starting the separation model.",
  webgpu: "Runs on this computer, on the graphics card.",
  wasm: "Runs on this computer's processor: this can take several minutes.",
} as const;

/** "drums, bass, guitar, piano, vocals and everything else" for the stems `model` makes. */
function stemList(model: SeparationModel | undefined): string {
  const named = (model?.stems ?? []).filter((s) => s !== "other");
  return named.length ? `${named.join(", ")} and everything else` : "stems";
}

/** The Stems tab: pick a song, choose the model and quality, follow the split, then play and export the stems. */
export function StemsPanel({ onPick }: { onPick: () => void }) {
  const source = useSong((s) => s.source);
  const stems = useSong((s) => s.stems);
  const status = useSong((s) => s.status);
  const model = findModel(useSong((s) => s.choice.model));
  const { downloaded } = useDownloadedFiles();
  const missing = model && downloaded ? megabytes(missingBytes(model, downloaded)) : 0;
  // The split button follows the options in a roomy window and moves to a bar under them when the options have to scroll.
  const scroller = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [source, stems, status.kind]);
  const splitButton = <Button onClick={() => void useSong.getState().split()}>{missing ? `Download ${missing} MB and split` : "Split into stems"}</Button>;

  if (stems && source) return <StemMixer key={source.libraryId ?? source.name} stems={stems} songName={source.name} />;

  if (status.kind === "decoding") return <Working title="Reading the song" />;
  if (status.kind === "model") {
    const mb = megabytes(status.bytes);
    return (
      <Working
        title={`Downloading the ${model?.label ?? "separation"} model`}
        detail={`First split with it only: ${Math.round(status.fraction * mb)} of ${mb} MB. It is kept for next time.`}
        fraction={status.fraction}
      />
    );
  }
  if (status.kind === "splitting")
    return (
      <Working
        title={status.passes > 1 ? `Splitting into stems, pass ${status.pass} of ${status.passes}` : "Splitting into stems"}
        detail={SPLIT_DETAIL[status.backend ?? "starting"]}
        fraction={status.fraction}
      />
    );

  if (status.kind === "error")
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>{source ? "The split didn't finish" : "This song can't be opened"}</AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            <div className="mt-3 flex gap-2">
              {source && (
                <Button size="sm" onClick={() => void useSong.getState().split()}>
                  <RotateCcw data-icon="inline-start" />
                  Try again
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={onPick}>
                <FileUp data-icon="inline-start" />
                Open a song…
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );

  if (source)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col items-center justify-center gap-4 py-4">
            <Empty className="max-w-xl flex-none">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="[@media(max-height:760px)]:hidden">
                  <AudioLines />
                </EmptyMedia>
                <EmptyTitle>{source.name}</EmptyTitle>
                <EmptyDescription>Split it into {stemList(model)}.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent className="max-w-xl gap-4">
                <SplitOptions className="w-full" />
              </EmptyContent>
            </Empty>
            <div className={cn("flex justify-center", over && "invisible")}>{splitButton}</div>
          </div>
        </div>
        {over && <div className="flex shrink-0 justify-center border-t border-seam py-3">{splitButton}</div>}
      </div>
    );

  return (
    <div className={cn(PANEL, "grid flex-1 place-items-center border border-dashed border-seam-strong p-6")}>
      <Empty className="max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AudioLines />
          </EmptyMedia>
          <EmptyTitle>Split a song into stems</EmptyTitle>
          <EmptyDescription>
            Drop an audio file here (WAV, MP3, FLAC, M4A or OGG) or choose one. Tone Studio separates it on this computer into {stemList(model)}.
            {missing > 0 && ` The first split with the ${model?.label} model downloads it (${missing} MB) once.`}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button onClick={onPick}>
            <FileUp data-icon="inline-start" />
            Open a song…
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

function Working({ title, detail, fraction }: { title: string; detail?: string; fraction?: number }) {
  const percent = fraction === undefined ? null : Math.round(fraction * 100);
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div role="status" className={cn(PANEL, "flex w-full max-w-md flex-col gap-3 px-5 py-4")}>
        <div className="flex items-center gap-2.5 text-[13px]">
          <Spinner />
          <b className="font-semibold">{title}</b>
          {percent !== null && <span className="ml-auto text-silkscreen-2 tabular-nums">{percent}%</span>}
        </div>
        {percent !== null && <Progress value={percent} aria-label={title} />}
        <div className="flex items-center gap-3">
          {detail && <p className="text-[12px] text-pretty text-silkscreen-3">{detail}</p>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => useSong.getState().cancel()}>
            <X data-icon="inline-start" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
