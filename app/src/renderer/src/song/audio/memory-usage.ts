// Reads what the open song's audio takes (spec 127) and writes it to the session log once per song load.
import { host } from "@/host";
import { sessionLog } from "@/state/session-log";
import { useSong } from "../store";
import { useSongLibrary } from "../library";
import { liveAudio } from "../stems/player";
import type { Stems } from "../types";
import { bytesText, songFootprint, type Footprint, type HeldTrack } from "./memory-estimate";

const pcmTracks = (audio: { channels: Float32Array[] }[]): HeldTrack[] =>
  audio.filter((a) => a.channels.length).map((a) => ({ channels: a.channels.length, frames: a.channels[0].length, key: a.channels[0] }));
const stemList = (stems: Stems | null) => Object.values(stems ?? {}).filter((a): a is NonNullable<typeof a> => !!a);

/** The footprint right now. Reads array lengths only: it allocates no audio and cannot disturb playback. */
export function currentFootprint(): Footprint {
  const song = useSong.getState();
  const prepared = useSongLibrary.getState().prepared;
  const preparedPlayer = prepared?.player;
  const live = liveAudio();
  const heldBy = (pick: (l: (typeof live)[number]) => boolean) => live.filter(pick).flatMap((l) => l.tracks);
  return songFootprint({
    store: pcmTracks([...(song.source ? [song.source.audio] : []), ...stemList(song.stems)]),
    player: heldBy((l) => l.player !== preparedPlayer && l.rate === 1),
    prepared: [...(prepared ? pcmTracks([prepared.source.audio, ...stemList(prepared.stems)]) : []), ...heldBy((l) => l.player === preparedPlayer)],
    renders: heldBy((l) => l.player !== preparedPlayer && l.rate !== 1),
  });
}

const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

/** Logs the footprint, and the app's memory when the host can read it, a few seconds after a song loads or the next one is prepared. */
export function watchMemory(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const log = () => {
    timer = undefined;
    try {
      const f = currentFootprint();
      if (!f.total) return;
      const audio = `audio ${bytesText(f.total)} (store ${mb(f.store)}, player ${mb(f.player)}, next ${mb(f.prepared)}, renders ${mb(f.renders)})`;
      void host.app.memory().then(
        (m) => sessionLog("Memory", m ? `${audio}; app ${mb(m.workingSetKb * 1024)} (peak ${mb(m.peakWorkingSetKb * 1024)}), free ${mb(m.freeKb * 1024)}` : audio),
        () => sessionLog("Memory", audio),
      );
    } catch {
      // The log line is for the soak run; it never matters to the show.
    }
  };
  // The player is built after the stems arrive, so the line waits for it; many changes in a row give one line.
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(log, 3000);
  };
  useSong.subscribe((s, p) => {
    if (s.source !== p.source || s.stems !== p.stems) schedule();
  });
  useSongLibrary.subscribe((s, p) => {
    if (s.prepared !== p.prepared && s.prepared) schedule();
  });
}
