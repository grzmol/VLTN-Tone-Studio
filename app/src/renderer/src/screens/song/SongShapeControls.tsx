import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PcmAudio } from "@/song/types";
import { getSetting, readOptions, setSetting } from "@/song/performance/settings";
import { audibleRange, CROSSFADE_MAX_S } from "@/song/performance/transition";
import { END_BEHAVIOUR_LABELS, END_BEHAVIOURS, isEndBehaviour, shapeFromOptions, type StoredShape } from "@/song/performance/song-shape";
import type { SilenceEnds } from "@/song/analysis/silence";

const field = "rounded border border-seam bg-transparent p-2";

/** A number from a text box; an empty box means the value is not set. */
const parse = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text));

/**
 * The song's trim, fades and end behaviour. They are saved in the song's options, and the player takes them on the next change of
 * the song's settings. Auto trims to the audible part of the song, at −60 dBFS.
 */
export function SongShapeControls({
  songKey,
  audio,
  silence,
  onChange,
}: {
  songKey: string;
  audio: PcmAudio | null;
  /** The silence the analysis found at the ends of the song. Offered as a trim while no trim is set. */
  silence?: SilenceEnds | null;
  onChange: () => void;
}) {
  const [shape, setShape] = useState<StoredShape>(() => shapeFromOptions(getSetting(songKey, ":options")));
  const [note, setNote] = useState("");
  const save = (patch: Partial<StoredShape>) => {
    const next = { ...shape, ...patch };
    setShape(next);
    try {
      setSetting(songKey, ":options", JSON.stringify({ ...readOptions(songKey, {}), ...next }));
      onChange();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const auto = () => {
    const range = audio ? audibleRange(audio.channels, audio.sampleRate) : null;
    if (!range) {
      setNote("This song is silent, so there is no audible part to trim to.");
      return;
    }
    setNote("");
    save({ trimStart: range.start, trimEnd: range.end });
  };
  const duration = audio ? (audio.channels[0]?.length ?? 0) / audio.sampleRate : 0;
  const trailing = silence ? duration - silence.end : 0;
  const offer = silence && (silence.start > 0 || trailing > 0) && shape.trimStart === undefined && shape.trimEnd === undefined ? silence : null;
  const fade = (text: string) => Math.max(0, Math.min(CROSSFADE_MAX_S, Number(text) || 0));
  return (
    <div aria-label="Song shape" className="flex flex-wrap items-end gap-3 rounded border border-seam p-3">
      {offer && (
        <Button
          variant="outline"
          onClick={() => save({ trimStart: offer.start > 0 ? offer.start : undefined, trimEnd: trailing > 0 ? offer.end : undefined })}
        >
          Trim the silence ({offer.start > 0 ? `${offer.start.toFixed(1)} s at the start` : "none at the start"}
          {trailing > 0 ? `, ${trailing.toFixed(1)} s at the end` : ", none at the end"})
        </Button>
      )}
      <label className="flex flex-col gap-1">
        Trim start (s)
        <input
          type="number"
          min={0}
          step={0.1}
          className={field}
          value={shape.trimStart ?? ""}
          onChange={(e) => save({ trimStart: parse(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1">
        Trim end (s)
        <input type="number" min={0} step={0.1} className={field} value={shape.trimEnd ?? ""} onChange={(e) => save({ trimEnd: parse(e.target.value) })} />
      </label>
      <Button variant="outline" disabled={!audio} title="Trim to the audible part of the song (above −60 dBFS)." onClick={auto}>
        Auto
      </Button>
      <Button
        variant="outline"
        disabled={shape.trimStart === undefined && shape.trimEnd === undefined}
        onClick={() => save({ trimStart: undefined, trimEnd: undefined })}
      >
        Clear trim
      </Button>
      <label className="flex flex-col gap-1">
        Fade in (s)
        <input type="number" min={0} max={CROSSFADE_MAX_S} step={0.5} className={field} value={shape.fadeIn} onChange={(e) => save({ fadeIn: fade(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1">
        Fade out (s)
        <input type="number" min={0} max={CROSSFADE_MAX_S} step={0.5} className={field} value={shape.fadeOut} onChange={(e) => save({ fadeOut: fade(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1">
        At the end
        <select
          className={field}
          value={shape.endBehaviour}
          onChange={(e) => {
            if (isEndBehaviour(e.target.value)) save({ endBehaviour: e.target.value });
          }}
        >
          {END_BEHAVIOURS.map((behaviour) => (
            <option key={behaviour} value={behaviour}>
              {END_BEHAVIOUR_LABELS[behaviour]}
            </option>
          ))}
        </select>
      </label>
      {note && (
        <p role="status" className="w-full text-sm text-silkscreen-3">
          {note}
        </p>
      )}
    </div>
  );
}
