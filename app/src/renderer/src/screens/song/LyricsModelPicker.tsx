import { useEffect, useState } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { downloadMegabytes, LYRICS_MODELS, type LyricsModelId } from "@/song/performance/lyrics-models";
import { hasWebGpuAdapter, LYRICS_QUALITIES, type LyricsChoice, type LyricsQualityId } from "@/song/performance/lyrics-options";

/** Whether the transcriber will run on WebGPU here, asked the same way the worker asks. */
export function useWebGpu(): boolean {
  const [webgpu, setWebgpu] = useState(false);
  useEffect(() => {
    let live = true;
    void hasWebGpuAdapter(typeof navigator === "undefined" ? undefined : navigator.gpu).then((ok) => {
      if (live) setWebgpu(ok);
    });
    return () => {
      live = false;
    };
  }, []);
  return webgpu;
}

/** Model and quality for the next transcription. Laid out like the stem split's pickers, so the two read as one family. */
export function LyricsModelPicker({ choice, disabled, onChange }: { choice: LyricsChoice; disabled: boolean; onChange: (next: LyricsChoice) => void }) {
  const webgpu = useWebGpu();
  const quality = LYRICS_QUALITIES.find((q) => q.id === choice.quality) ?? LYRICS_QUALITIES[0];
  return (
    <div className="flex flex-col gap-3 text-left">
      <RadioGroup
        aria-label="Lyrics model"
        value={choice.model}
        onValueChange={(v) => onChange({ ...choice, model: v as LyricsModelId })}
        disabled={disabled}
        className="gap-0 rounded-lg border border-seam"
      >
        {LYRICS_MODELS.map((m) => {
          const id = `lyrics-model-${m.id}`;
          return (
            <div key={m.id} className={cn("flex items-start gap-3 px-3 py-2.5 [&+&]:border-t [&+&]:border-seam", choice.model === m.id && "bg-faceplate")}>
              <RadioGroupItem id={id} value={m.id} className="mt-0.5" />
              <label htmlFor={id} className="flex min-w-0 grow cursor-pointer flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-silkscreen">{m.label}</span>
                <span className="text-[12px] text-pretty text-silkscreen-3">{m.description}</span>
                <span className="text-[11px] text-silkscreen-2 tabular-nums">Downloads about {downloadMegabytes(m, webgpu)} MB once</span>
              </label>
            </div>
          );
        })}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-3">
        <span id="lyrics-quality" className="text-[12px] font-semibold text-silkscreen-2">
          Quality
        </span>
        <ToggleGroup
          type="single"
          value={choice.quality}
          onValueChange={(v) => v && onChange({ ...choice, quality: v as LyricsQualityId })}
          aria-labelledby="lyrics-quality"
          disabled={disabled}
          className="gap-1"
        >
          {LYRICS_QUALITIES.map((q) => (
            <ToggleGroupItem key={q.id} value={q.id}>
              {q.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-[12px] text-silkscreen-3">{quality.description}</span>
      </div>
    </div>
  );
}
