import { CLICK_SOUND_GROUPS } from "@/song/performance/click-sound";

/** The click sounds as grouped menu options: Click, Drummer, Patterns and your own samples. */
export function ClickSoundOptions() {
  return (
    <>
      {CLICK_SOUND_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.sounds.map((sound) => (
            <option key={sound.id} value={sound.id}>
              {sound.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
