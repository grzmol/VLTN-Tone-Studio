import { useEffect, useState, type ReactNode } from "react";
import type { AudienceClock, AudienceLine, AudienceModel } from "@shared/audience";
import { audienceBlank, audienceIndex, audienceNextLine } from "@/song/performance/audience";
import { formatted } from "@/screens/song/lyric-format";
import { subscribeAudience } from "./audience-source";
import { AudiencePdf } from "./AudiencePdf";
import { rotationStyle } from "./layout";
import { useAudienceState } from "./use-audience-state";

/**
 * The audience display (spec 43): the page the second window shows. It has no controls and no store of its own. It draws the latest model,
 * and runs the song's clock between the snapshots the performance screen sends, so the lines change on time without a message per frame.
 */
export function AudienceView() {
  const state = useAudienceState(subscribeAudience);
  const model = state.model;
  const index = useLineIndex(model, state.clock);
  if (!model || audienceBlank(model, state.clock)) return <Screen />;
  if (model.screen === "logo") {
    return (
      <Screen rotation={model.rotation}>
        <div className="flex h-full items-center justify-center">
          <p className="text-[9vmin] font-semibold tracking-wide text-silkscreen-3">VLTN Tone Studio</p>
        </div>
      </Screen>
    );
  }
  if (model.screen === "pdf" && model.pdf) {
    return (
      <Screen rotation={model.rotation}>
        <AudiencePdf key={model.pdf.url} url={model.pdf.url} page={model.pdf.page} />
      </Screen>
    );
  }
  return (
    <Screen rotation={model.rotation}>
      {model.timed ? <TimedLyrics model={model} index={index} /> : <UntimedLyrics model={model} />}
      <Footer model={model} />
    </Screen>
  );
}

/** The index of the line on screen, read from the clock once per animation frame. It only re-renders when the line changes. */
function useLineIndex(model: AudienceModel | null, clock: AudienceClock | null): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!model) return;
    let frame = 0;
    const tick = () => {
      const next = audienceIndex(model, clock, Date.now());
      setIndex((current) => (current === next ? current : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [model, clock]);
  return index;
}

/** The black frame that every screen sits on. The screen is always dark, so the room stays dark around a projector. */
function Screen({ rotation = 0, children }: { rotation?: AudienceModel["rotation"]; children?: ReactNode }) {
  return (
    <main aria-label="Audience display" className="fixed inset-0 overflow-hidden bg-black text-white">
      <div style={rotationStyle(rotation)} className="bg-black">
        {children}
      </div>
    </main>
  );
}

function TimedLyrics({ model, index }: { model: AudienceModel; index: number }) {
  const current = index >= 0 ? model.lines[index] : undefined;
  const next = audienceNextLine(model, index);
  // The text size is set from the screen's smaller side, so a tall projector and a wide one read the same.
  const size = `calc(min(7vw, 12vh) * ${model.fontScale})`;
  return (
    <div className="flex h-full flex-col justify-center px-[6%] pb-[10vh] text-center">
      {model.showChords && current && current.chords.length > 0 && <ChordRow chords={current.chords} size={size} />}
      {current?.heading && (
        <p className="mb-[2vh] uppercase tracking-[0.2em] text-silkscreen-3" style={{ fontSize: `calc(${size} * 0.35)` }}>
          {current.heading}
        </p>
      )}
      <p className="text-balance leading-tight font-semibold" style={{ fontSize: size }}>
        {current ? formatted(current.text) : null}
      </p>
      {next && (
        <p className="mt-[5vh] text-balance leading-tight text-white/40" style={{ fontSize: `calc(${size} * 0.6)` }}>
          {formatted(next.text || next.heading || "")}
        </p>
      )}
    </div>
  );
}

function ChordRow({ chords, size }: { chords: string[]; size: string }) {
  return (
    <div
      aria-label="Chords"
      className="mb-[3vh] flex flex-wrap justify-center gap-x-[4vw] font-semibold text-sky-300"
      style={{ fontSize: `calc(${size} * 0.6)` }}
    >
      {chords.map((chord, i) => (
        <span key={i}>{chord}</span>
      ))}
    </div>
  );
}

/** An untimed chart is shown as its text, from the top, without following the song. */
function UntimedLyrics({ model }: { model: AudienceModel }) {
  return (
    <div className="h-full overflow-hidden px-[6%] py-[6vh] text-left leading-snug" style={{ fontSize: `calc(min(4.5vw, 7vh) * ${model.fontScale})` }}>
      {model.lines.map((line, i) => (
        <UntimedRow key={i} line={line} />
      ))}
    </div>
  );
}

function UntimedRow({ line }: { line: AudienceLine }) {
  if (line.heading) return <p className="mt-[0.9em] uppercase tracking-[0.2em] text-silkscreen-3">{line.heading}</p>;
  if (!line.text) return <div className="h-[0.7em]" />;
  return <p>{formatted(line.text)}</p>;
}

function Footer({ model }: { model: AudienceModel }) {
  return (
    <div className="absolute inset-x-[4%] bottom-[3vh] flex items-end justify-between gap-[3vw] text-[2.6vh] text-white/50">
      <span className="truncate">{model.title}</span>
      {model.nextTitle && <span className="truncate">Next: {model.nextTitle}</span>}
    </div>
  );
}
