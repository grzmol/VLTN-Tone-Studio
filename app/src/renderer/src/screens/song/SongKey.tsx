import { useEffect, useState } from "react";
import { KEY_NAMES, SONG_KEYS, effectiveSongKey } from "@/song/performance/key";
import { readOptions, setSetting } from "@/song/performance/settings";
import { HelpNote } from "@/components/ui/help-note";

/** The song's key, set by hand. It is the key the chord names are spelled by, so the panel's screens follow the same key. */
export function SongKey({
  storageKey,
  shift = 0,
  libraryKey,
  onSpellingKey,
}: {
  storageKey: string;
  shift?: number;
  /** The key saved on the song's library entry, used when no key has been chosen here */
  libraryKey?: string;
  onSpellingKey?: (key: string | undefined) => void;
}) {
  const [key, setKey] = useState(() => {
    const saved = readOptions<{ songKey?: string }>(storageKey, {}).songKey;
    return saved && SONG_KEYS.includes(saved) ? saved : "";
  });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      setSetting(storageKey, ":options", JSON.stringify({ ...readOptions(storageKey, {}), songKey: key }));
      setError("");
    } catch {
      setError("Could not save the song key.");
    }
  }, [storageKey, key]);
  const spellingKey = effectiveSongKey(key, libraryKey);
  useEffect(() => onSpellingKey?.(spellingKey), [spellingKey, onSpellingKey]);
  const root = spellingKey ? KEY_NAMES.indexOf(spellingKey.split(" ")[0]) : -1;
  const displayed = root < 0 ? "" : `${KEY_NAMES[(((root + shift) % 12) + 12) % 12]} ${spellingKey!.split(" ")[1]}`;
  return (
    <section aria-label="Song key" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2 text-sm">
      <strong>Song key: {spellingKey ?? "Unknown"}</strong>
      <label>
        Key{" "}
        <select aria-label="Song key override" className="rounded border border-seam bg-background p-2" value={key} onChange={(e) => setKey(e.target.value)}>
          <option value="">{libraryKey ? "From the song details" : "Not set"}</option>
          {SONG_KEYS.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      {displayed && shift !== 0 && (
        <span>
          Displayed chords: {displayed} ({shift > 0 ? "+" : ""}
          {shift} semitones)
        </span>
      )}
      <div className="w-full">
        <HelpNote>
          <p>Choose the key so chord names are spelled with sharps or flats to suit it. It is saved with the song. Key and chord transposition do not change audio or MIDI.</p>
        </HelpNote>
      </div>
      {error && (
        <p role="alert" className="w-full text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
