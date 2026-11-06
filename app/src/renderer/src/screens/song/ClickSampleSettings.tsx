import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useClickSamples, MAX_CLICK_SAMPLE_SECONDS } from "@/song/performance/click-samples";
import { AUDIO_ACCEPT } from "@/song/decode";
import type { ClickSampleSlot } from "@shared/host/click-samples";
import type { StemPlayer } from "@/song/stems/player";

const SLOTS: { slot: ClickSampleSlot; label: string }[] = [
  { slot: "down", label: "Downbeat" },
  { slot: "other", label: "Other beats" },
];

/** Reads the saved samples once and hands them to the player, so the "My samples" sound is ready before Play. */
export function useClickSampleSync(player: StemPlayer | null): void {
  const { down, other, load } = useClickSamples();
  useEffect(() => void load(), [load]);
  useEffect(() => {
    player?.setCustomClickSamples({ down: down?.audio ?? null, other: other?.audio ?? null });
  }, [player, down, other]);
}

/** The two slots of the "My samples" sound: a drum hit bounced from a plugin for the downbeat and one for the other beats. */
export function ClickSampleSettings() {
  const samples = useClickSamples();
  return (
    <fieldset className="space-y-2">
      <legend>My samples</legend>
      <p>
        Load a short hit (WAV, FLAC or MP3, at most {MAX_CLICK_SAMPLE_SECONDS} seconds) for each slot, then choose My samples as the sound. An empty slot uses
        the click.
      </p>
      {SLOTS.map(({ slot, label }) => (
        <div key={slot} className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <span className="w-24">{label}</span>
            <input
              type="file"
              aria-label={`${label} sample`}
              accept={AUDIO_ACCEPT}
              className="w-40 text-xs"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void samples.set(slot, file);
              }}
            />
          </label>
          <span className="truncate text-xs">{samples[slot]?.name ?? "Click"}</span>
          <Button type="button" size="sm" variant="outline" disabled={!samples[slot]} onClick={() => void samples.clear(slot)}>
            Clear
          </Button>
        </div>
      ))}
      {samples.notice && (
        <p role="status" className="text-xs">
          {samples.notice}
        </p>
      )}
    </fieldset>
  );
}
