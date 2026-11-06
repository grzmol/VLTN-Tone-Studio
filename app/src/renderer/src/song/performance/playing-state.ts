// Whether a song is playing on the Performance screen. The Performance panel sets it while its session plays, and the Library reads it so a
// batch analysis (spec 72) never runs over the music. The session lives in the panel, so this is the one place the rest of the app can ask.

let playing = false;
const listeners = new Set<(playing: boolean) => void>();

/** Records whether a song is playing, and tells the listeners when it changes. */
export function setSongPlaying(value: boolean): void {
  if (value === playing) return;
  playing = value;
  for (const listener of listeners) listener(value);
}

/** Whether a song is playing right now. */
export function isSongPlaying(): boolean {
  return playing;
}

/** Calls `listener` when playback starts or stops. Returns the function that stops the listening. */
export function onSongPlayingChange(listener: (playing: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
