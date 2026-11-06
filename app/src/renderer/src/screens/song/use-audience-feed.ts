import { useEffect, useMemo } from "react";
import type { AudienceModel } from "@shared/audience";
import { host } from "@/host";
import { AudienceFeed, type ClockSample } from "@/song/performance/audience";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import type { PerformanceSession } from "@/song/performance/session";

/**
 * Sends the audience display the song's model, and the song's position whenever the audience's own clock would be wrong (spec 43).
 * It runs beside playback and never waits for it: a failed send is dropped, and the audience window is optional. When the performance
 * screen goes, the audience clock is stopped where the song is; playback is not touched.
 */
export function useAudienceFeed(session: PerformanceSession, songKey: string, model: AudienceModel): void {
  const feed = useMemo(
    () =>
      new AudienceFeed((update) => {
        void host.audience?.publish(update)?.catch(() => {});
      }),
    [],
  );
  useEffect(() => {
    feed.update(sampleOf(session, songKey), model);
  }, [feed, session, songKey, model]);
  useEffect(() => {
    const onChange = () => feed.update(sampleOf(session, songKey), null);
    const unsubscribeClock = usePlaybackClock.subscribe(onChange);
    const unsubscribeSession = session.store.subscribe(onChange);
    onChange();
    return () => {
      unsubscribeClock();
      unsubscribeSession();
      feed.stop();
    };
  }, [feed, session, songKey]);
}

/** The state the feed samples: the position on the displayed clock, and the playing state and speed from the session's player. */
function sampleOf(session: PerformanceSession, songKey: string): ClockSample {
  const state = session.state;
  return { songKey, position: usePlaybackClock.getState().position, playing: state.playing, rate: state.player?.playbackRate ?? 1 };
}
