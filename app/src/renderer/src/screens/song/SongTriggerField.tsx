import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { LibrarySong } from "@shared/song-library";
import { useSongLibrary } from "@/song/library";
import { describeBinding, startLearn, stopLearn } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";
import { bindingClaiming, describeTrigger, sanitizeTrigger, songEntries, triggerClashes, type SongTrigger } from "@/song/performance/song-triggers";
import { LearnStatus } from "./RemoteControlSettings";

const field = "rounded border border-seam bg-transparent p-2";

/** A whole number from a text box, or undefined when it is empty or out of range. */
const whole = (text: string): number | undefined => {
  const value = Number(text);
  return text.trim() !== "" && Number.isInteger(value) ? value : undefined;
};

/**
 * The MIDI trigger that loads this song: learned from the selected input, or typed in. It is saved with the song. A clash with another
 * song, or with a remote binding that already answers the same message, is named here so the performer can fix it before the set.
 */
export function SongTriggerField({ songId, songs: library, inputReady }: { songId: string | undefined; songs: readonly LibrarySong[]; inputReady: boolean }) {
  const songs = songEntries(library);
  const bindings = useMidiConfiguration((s) => s.bindings);
  const [type, setType] = useState<"pc" | "songselect">("pc");
  const [channel, setChannel] = useState("1");
  const [number, setNumber] = useState("0");
  const [bank, setBank] = useState({ msb: "", lsb: "" });
  const [note, setNote] = useState("");
  const current = songs.find((song) => song.id === songId);
  if (!songId || !current) {
    return (
      <section aria-label="Song trigger" className="glass rounded-xl p-4 text-[13px] text-silkscreen-3">
        Save the song to the library to load it from MIDI.
      </section>
    );
  }
  const trigger = current.trigger;
  const clashes = triggerClashes(songs, songId);
  const bound = trigger ? bindingClaiming(trigger, bindings) : undefined;
  const save = (next: SongTrigger | null) => {
    try {
      useSongLibrary.getState().setSongTrigger(songId, next);
      stopLearn();
      setNote(next ? `Saved ${describeTrigger(next)}.` : "Trigger removed.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };
  const saveTyped = () => {
    const candidate =
      type === "songselect"
        ? { type, number: whole(number) }
        : {
            type,
            channel: whole(channel),
            program: whole(number),
            bankMsb: bank.msb.trim() ? whole(bank.msb) : undefined,
            bankLsb: bank.lsb.trim() ? whole(bank.lsb) : undefined,
          };
    const parsed = sanitizeTrigger(candidate);
    if (!parsed) {
      setNote("Use channel 1 to 16 and a number from 0 to 127. A bank is 0 to 127 for each of MSB and LSB.");
      return;
    }
    save(parsed);
  };
  return (
    <section aria-label="Song trigger" className="glass flex flex-col gap-3 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Song trigger</h3>
          <p className="text-[12px] text-silkscreen-3 tabular-nums">
            {trigger ? `Loads on ${describeTrigger(trigger)}.` : "No MIDI trigger. Learn one, or type it below."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={!inputReady} onClick={() => startLearn({ source: "song", songId })}>
            Learn trigger
          </Button>
          {trigger && (
            <Button variant="ghost" size="sm" onClick={() => save(null)}>
              Remove trigger
            </Button>
          )}
        </div>
      </div>
      {clashes.length > 0 && (
        <p role="status" className="text-[12px] text-silkscreen-2">
          Same trigger as {clashes.map((song) => song.title).join(", ")}. The first song in the library loads.
        </p>
      )}
      {bound && (
        <p role="status" className="text-[12px] text-silkscreen-2">
          {describeBinding(bound)} runs a remote action on this message, so this song does not load.
        </p>
      )}
      <LearnStatus />
      <div className="flex flex-wrap items-end gap-3 text-[13px]">
        <label className="flex flex-col gap-1">
          Trigger
          <select aria-label="Trigger type" className={field} value={type} onChange={(e) => setType(e.target.value as "pc" | "songselect")}>
            <option value="pc">Program change</option>
            <option value="songselect">Song Select</option>
          </select>
        </label>
        {type === "pc" && (
          <label className="flex flex-col gap-1">
            Channel
            <input aria-label="Trigger channel" type="number" min={1} max={16} className={`${field} w-20`} value={channel} onChange={(e) => setChannel(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          {type === "pc" ? "Program" : "Song Select number"}
          <input aria-label="Trigger number" type="number" min={0} max={127} className={`${field} w-24`} value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
        {type === "pc" && (
          <>
            <label className="flex flex-col gap-1">
              Bank MSB
              <input
                aria-label="Bank MSB"
                type="number"
                min={0}
                max={127}
                placeholder="Any"
                className={`${field} w-24`}
                value={bank.msb}
                onChange={(e) => setBank({ ...bank, msb: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              Bank LSB
              <input
                aria-label="Bank LSB"
                type="number"
                min={0}
                max={127}
                placeholder="Any"
                className={`${field} w-24`}
                value={bank.lsb}
                onChange={(e) => setBank({ ...bank, lsb: e.target.value })}
              />
            </label>
          </>
        )}
        <Button variant="outline" onClick={saveTyped}>
          Save trigger
        </Button>
      </div>
      {note && <p role="status" className="text-[12px] text-silkscreen-3">{note}</p>}
    </section>
  );
}
