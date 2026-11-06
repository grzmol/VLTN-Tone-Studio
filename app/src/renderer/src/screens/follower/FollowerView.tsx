import { useEffect, useState, type ReactNode } from "react";
import type { AudienceClock, AudienceLine, AudienceModel } from "@shared/audience";
import type { FollowerAction } from "@shared/band-sync";
import { audienceBlank, audienceIndex, audienceNextLine } from "@/song/performance/audience";
import { transpose } from "@/song/performance/chart";
import { formatted } from "@/screens/song/lyric-format";
import type { FollowerClient, FollowerState } from "./follower-client";

/** The text size steps a follower can take on this device, and the transpose limits, in semitones. */
const SIZE = { min: 0.6, max: 1.8, step: 0.1 } as const;
const SHIFT = 6;

/**
 * The song on a follower's device (spec 44). It draws the model the performer's app sends, runs the song's clock from the snapshots, and
 * puts the follower's own text size and transpose on top. Transpose changes only the chord names on this device; the words are unchanged.
 */
export function FollowerView({ client, state }: { client: FollowerClient; state: FollowerState }) {
  const [size, setSize] = useState(1);
  const [shift, setShift] = useState(0);
  const [chords, setChords] = useState(true);
  const model = state.model;
  const clock = state.clock;
  const index = useLineIndex(client, model, clock);
  const blank = !model || audienceBlank(model, clock);
  return (
    <main className="follower">
      <header className="follower-bar">
        <span className="follower-title">{model?.title || "VLTN band sync"}</span>
        <span role="status" className="follower-status">
          {state.message}
          {!state.synced && state.phase === "live" ? " Syncing clock…" : ""}
        </span>
      </header>
      <section className="follower-stage" aria-label="Song">
        {blank || !model ? (
          <p className="follower-blank">{model ? "" : "Waiting for the performer's song."}</p>
        ) : model.screen === "logo" ? (
          <p className="follower-blank">VLTN Tone Studio</p>
        ) : model.timed ? (
          <Timed model={model} index={index} size={size} shift={shift} chords={chords} />
        ) : (
          <Untimed model={model} size={size} shift={shift} />
        )}
      </section>
      <footer className="follower-controls">
        <button type="button" onClick={() => setSize((value) => Math.max(SIZE.min, +(value - SIZE.step).toFixed(2)))} aria-label="Smaller text">
          A−
        </button>
        <button type="button" onClick={() => setSize((value) => Math.min(SIZE.max, +(value + SIZE.step).toFixed(2)))} aria-label="Larger text">
          A+
        </button>
        <button type="button" onClick={() => setShift((value) => Math.max(-SHIFT, value - 1))} aria-label="Transpose down">
          ♭
        </button>
        <span aria-label="Transpose" className="follower-shift">
          {shift > 0 ? `+${shift}` : shift}
        </span>
        <button type="button" onClick={() => setShift((value) => Math.min(SHIFT, value + 1))} aria-label="Transpose up">
          ♯
        </button>
        <button type="button" aria-pressed={chords} onClick={() => setChords((value) => !value)}>
          Chords
        </button>
        {state.controlAllowed && <Transport client={client} />}
      </footer>
    </main>
  );
}

function Transport({ client }: { client: FollowerClient }) {
  const send = (action: FollowerAction) => () => client.control(action);
  return (
    <span className="follower-transport">
      <button type="button" onClick={send("transport.playPause")}>
        Play / pause
      </button>
      <button type="button" onClick={send("transport.stop")}>
        Stop
      </button>
    </span>
  );
}

/** The line on screen, read from the performer's clock once per frame. Only a change of line re-renders the page. */
function useLineIndex(client: FollowerClient, model: AudienceModel | null, clock: AudienceClock | null): number {
  const [index, setIndex] = useState(-1);
  useEffect(() => {
    if (!model) return;
    let frame = 0;
    const tick = () => {
      const next = audienceIndex(model, clock, client.leaderNow());
      setIndex((current) => (current === next ? current : next));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [client, model, clock]);
  return index;
}

/** A chord name moved by this device's transpose. The words never carry chords, so only the chord row changes. */
function shifted(chords: string[], shift: number): string[] {
  if (shift === 0) return chords;
  return chords.map((chord) => transpose(`[${chord}]`, shift).slice(1, -1));
}

function Timed({ model, index, size, shift, chords }: { model: AudienceModel; index: number; size: number; shift: number; chords: boolean }) {
  const current = index >= 0 ? model.lines[index] : undefined;
  const next = audienceNextLine(model, index);
  const scale = model.fontScale * size;
  const text = `calc(min(7vw, 12vh) * ${scale})`;
  return (
    <div className="follower-lines">
      {chords && current && current.chords.length > 0 && <ChordRow chords={shifted(current.chords, shift)} size={text} />}
      {current?.heading && (
        <p className="follower-heading" style={{ fontSize: `calc(${text} * 0.35)` }}>
          {current.heading}
        </p>
      )}
      <p className="follower-current" style={{ fontSize: text }}>
        {current ? formatted(current.text) : null}
      </p>
      {next && (
        <p className="follower-next" style={{ fontSize: `calc(${text} * 0.6)` }}>
          {formatted(next.text || next.heading || "")}
        </p>
      )}
    </div>
  );
}

function ChordRow({ chords, size }: { chords: string[]; size: string }) {
  return (
    <div aria-label="Chords" className="follower-chords" style={{ fontSize: `calc(${size} * 0.6)` }}>
      {chords.map((chord, i) => (
        <span key={i}>{chord}</span>
      ))}
    </div>
  );
}

/** An untimed chart is its text, from the top. It does not follow the song, so the follower scrolls it. */
function Untimed({ model, size, shift }: { model: AudienceModel; size: number; shift: number }) {
  return (
    <div className="follower-untimed" style={{ fontSize: `calc(min(4.5vw, 7vh) * ${model.fontScale * size})` }}>
      {model.lines.map((line, i) => (
        <UntimedRow key={i} line={line} shift={shift} />
      ))}
    </div>
  );
}

function UntimedRow({ line, shift }: { line: AudienceLine; shift: number }) {
  let body: ReactNode = null;
  if (line.heading) return <p className="follower-heading">{line.heading}</p>;
  if (!line.text) return <div className="follower-gap" />;
  body = formatted(line.text);
  return (
    <>
      {line.chords.length > 0 && <p className="follower-chords-inline">{shifted(line.chords, shift).join("  ")}</p>}
      <p>{body}</p>
    </>
  );
}
