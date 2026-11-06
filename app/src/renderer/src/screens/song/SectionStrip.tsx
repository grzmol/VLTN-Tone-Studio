import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/song/stems/mix";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { useSession, type PerformanceSession, type SessionState } from "@/song/performance/session";
import { sectionIndexAt, sortedSections, type Section } from "@/song/performance/sections";

/**
 * The sentence under the strip: what is armed, or what is decided and when it lands. Pure, so the wording can be tested.
 * `position` is the song time now, in seconds.
 */
export function sectionStatus(
  sections: readonly Section[],
  live: SessionState["sectionLive"],
  next: SessionState["sectionNext"],
  position: number,
): string {
  const ordered = sortedSections(sections);
  const current = ordered[sectionIndexAt(ordered, position)];
  const name = (id: string | null) => ordered.find((s) => s.id === id)?.name ?? "";
  const countdown = (at: number) => `${formatTime(at)} (in ${Math.max(0, at - position).toFixed(1)} s)`;
  if (next?.kind === "pause") return `Pauses at ${countdown(next.at)}.`;
  if (next?.kind === "jump") return `Jumps to ${name(next.target) || "the next section"} at ${countdown(next.at)}.`;
  if (live.jump) {
    const landing = current ? `at the end of ${current.name}` : "at the next section start";
    return `${name(live.jump)} is armed. It lands ${landing}. Tap Cancel jump to stop it.`;
  }
  return "";
}

/** The status line. It reads the playback clock on its own, so the section buttons do not re-render every frame. */
function SectionStatus({ session }: { session: PerformanceSession }) {
  const sections = useSession(session, (s) => s.sections);
  const live = useSession(session, (s) => s.sectionLive);
  const next = useSession(session, (s) => s.sectionNext);
  const position = usePlaybackClock((s) => Math.round(s.position * 10) / 10);
  const text = sectionStatus(sections, live, next, position);
  return text ? <p role="status">{text}</p> : null;
}

/**
 * The section buttons: above the transport in Performance, in place of the seek bar in Stage. A tap arms a jump to the section for
 * the next boundary; a double tap jumps now. While stopped a tap moves the playhead to the section's start.
 */
export function SectionStrip({ session, onSaveDefaults }: { session: PerformanceSession; onSaveDefaults?: () => void }) {
  const sections = useSession(session, (s) => s.sections);
  const live = useSession(session, (s) => s.sectionLive);
  const ordered = useMemo(() => sortedSections(sections), [sections]);
  const current = usePlaybackClock((s) => sectionIndexAt(ordered, s.position));
  if (!ordered.length) return null;
  const playing = ordered[current];
  const looping = !!playing && (live.loop === playing.id || (playing.mode === "loop" && !live.released.includes(playing.id)));
  return (
    <div aria-label="Song sections" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {ordered.map((section, i) => {
          const armed = live.jump === section.id;
          return (
            <Button
              key={section.id}
              size="sm"
              variant={i === current ? "default" : "outline"}
              aria-pressed={i === current}
              aria-label={`${section.name}, ${formatTime(section.start)} to ${formatTime(section.end)}${armed ? ", jump armed" : ""}`}
              style={section.color ? { borderColor: section.color } : undefined}
              onClick={() => session.tapSection(section.id)}
              onDoubleClick={() => session.jumpSectionNow(section.id)}
            >
              {section.name}
              {armed ? " (armed)" : ""}
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {playing &&
          (looping ? (
            <Button variant="outline" size="sm" onClick={session.releaseSectionLoop}>
              Exit loop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => session.toggleSectionLoop(playing.id)}>
              Loop {playing.name}
            </Button>
          ))}
        {live.jump && (
          <Button variant="outline" size="sm" onClick={session.cancelSectionJump}>
            Cancel jump
          </Button>
        )}
        {onSaveDefaults && (
          <Button variant="outline" size="sm" onClick={onSaveDefaults}>
            Save as default
          </Button>
        )}
      </div>
      <SectionStatus session={session} />
    </div>
  );
}
