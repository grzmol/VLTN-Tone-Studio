// Accessible control layer over the gear art: transparent focusable
// controls positioned from the drawing's own coordinates. The art stays role="img".
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Loupe } from "./Loupe";
import { dragValue, formatValue, keyValue, parseTyped, valueText, wheelValue, type ValueSpec } from "./knob-math";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SliderControl extends Rect {
  kind: "slider";
  /** A fader moves its own drawing, so the loupe stays away from it */
  fader?: boolean;
  id: string;
  /** Accessible name, e.g. "Plustortion Gain" */
  label: string;
  value: number;
  spec: ValueSpec;
  onChange?: (value: number) => void;
}

export interface SwitchControl extends Rect {
  kind: "switch" | "fs";
  id: string;
  label: string;
  on: boolean;
  onToggle?: (on: boolean) => void;
}

export type Control = SliderControl | SwitchControl;

interface KnobHitProps {
  label: string;
  value: number;
  spec: ValueSpec;
  onChange?: (value: number) => void;
  disabled?: boolean;
  /** Called with true while focused or dragged (the drawing shows the halo and value bubble) */
  onActive?: (active: boolean) => void;
  /** Called with true while the knob is being turned (dragged, or just scrolled or stepped): the loupe */
  onTurning?: (turning: boolean) => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * role="slider" button: arrows ±1 step, PageUp/PageDown ±10, Home/End, drag vertically, or scroll to turn once it has focus
 * (click or Tab to it first; Shift fine), double-click to type a value.
 */
export function KnobHit({ label, value, spec, onChange, disabled, onActive, onTurning, className, style, children }: KnobHitProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; start: number; last: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  // a scroll or key step keeps the loupe up for a moment
  const [nudged, setNudged] = useState(false);
  const nudgeTimer = useRef<number>(undefined);
  const nudge = () => {
    setNudged(true);
    window.clearTimeout(nudgeTimer.current);
    nudgeTimer.current = window.setTimeout(() => setNudged(false), 900);
  };
  useEffect(() => () => window.clearTimeout(nudgeTimer.current), []);
  const latest = useRef({ value, spec, onChange, disabled, onActive, onTurning, nudge });
  latest.current = { value, spec, onChange, disabled, onActive, onTurning, nudge };
  const turning = dragging || nudged;
  useEffect(() => latest.current.onTurning?.(turning), [turning]);

  const isActive = focused || dragging || editing;
  useEffect(() => latest.current.onActive?.(isActive), [isActive]);

  // Wheel needs a non-passive listener to keep the page from scrolling while turning. Only a focused knob turns with the wheel,
  // so scrolling the page over an unfocused knob scrolls the page and leaves the value alone.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { value: v, spec: s, onChange: change, disabled: off } = latest.current;
      if (off || !change || document.activeElement !== el) return;
      e.preventDefault();
      const next = wheelValue(v, e.deltaY, s, e.shiftKey);
      if (next !== v) {
        change(next);
        latest.current.nudge();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const set = (next: number) => {
    if (next !== value) {
      onChange?.(next);
      nudge();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || !onChange) return;
    if (e.key === "Enter") {
      e.preventDefault();
      setEditing(true);
      return;
    }
    const next = keyValue(e.key, value, spec);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(next);
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || !onChange || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { y: e.clientY, start: value, last: value };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    // Re-anchor on Shift changes so switching to fine steps does not jump.
    const next = dragValue(d.start, e.clientY - d.y, spec, e.shiftKey);
    if (next !== d.last) {
      d.last = next;
      onChange?.(next);
    }
  };
  const endDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        aria-valuetext={valueText(value, spec)}
        aria-disabled={disabled || !onChange || undefined}
        className={cn("touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white", !disabled && onChange ? "cursor-ns-resize" : "cursor-default", className)}
        style={style}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => !disabled && onChange && setEditing(true)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {children}
      </button>
      {editing && (
        <ValueEditor
          label={label}
          initial={formatValue(value, spec)}
          style={style}
          onDone={(text) => {
            setEditing(false);
            if (text !== null) {
              const v = parseTyped(text, spec);
              if (v !== null) set(v);
            }
            ref.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ValueEditor({ label, initial, style, onDone }: { label: string; initial: string; style?: CSSProperties; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (t: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(t);
  };
  return (
    <span className="pointer-events-none absolute z-10 grid place-items-center" style={style}>
      <input
        autoFocus
        aria-label={`${label} value`}
        inputMode="decimal"
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(text);
          if (e.key === "Escape") finish(null);
        }}
        onBlur={() => finish(text)}
        className="pointer-events-auto h-8 w-16 rounded-pill bg-white text-center text-sm font-semibold text-black tabular-nums outline-none"
      />
    </span>
  );
}

const pct = (v: number, d: number) => `${((v / d) * 100).toFixed(3)}%`;

/** Transparent controls over a drawing with viewBox W×H. */
function ControlLayer({ view, controls, disabled, onActive, onTurning }: { view: [number, number]; controls: Control[]; disabled?: boolean; onActive: (id: string, active: boolean) => void; onTurning: (id: string, turning: boolean) => void }) {
  const [W, H] = view;
  return controls.map((c) => {
    const style: CSSProperties = { left: pct(c.x, W), top: pct(c.y, H), width: pct(c.w, W), height: pct(c.h, H) };
    if (c.kind === "slider")
      return (
        <KnobHit
          key={c.id}
          label={c.label}
          value={c.value}
          spec={c.spec}
          onChange={c.onChange}
          disabled={disabled}
          onActive={(a) => onActive(c.id, a)}
          onTurning={(t) => onTurning(c.id, t)}
          className="absolute rounded-full bg-transparent p-0"
          style={style}
        />
      );
    return (
      <button
        key={c.id}
        type="button"
        role="switch"
        aria-checked={c.on}
        aria-label={c.label}
        disabled={disabled || !c.onToggle}
        onClick={() => c.onToggle?.(!c.on)}
        className="absolute cursor-pointer rounded-pill bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default"
        style={style}
      />
    );
  });
}

export interface GearRender {
  art: ReactNode;
  controls: Control[];
}

interface GearFrameProps {
  view: [number, number];
  /** Accessible description of the drawing */
  label: string;
  interactive?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Draws the art for the given defs id and active (focused/dragged) control id; returns art + controls */
  render: (id: string, active: string | null) => GearRender;
}

/** Wrapper shared by every drawing: the role="img" SVG plus, when interactive, the control layer. */
export function GearFrame({ view, label, interactive, disabled, className, style, render }: GearFrameProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [active, setActive] = useState<string | null>(null);
  const [turning, setTurning] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const { art, controls } = render(id, active);
  const onActive = useRef((cid: string, a: boolean) => setActive((cur) => (a ? cid : cur === cid ? null : cur))).current;
  const onTurning = useRef((cid: string, t: boolean) => setTurning((cur) => (t ? cid : cur === cid ? null : cur))).current;
  const lens = turning === null ? undefined : controls.find((c): c is SliderControl => c.kind === "slider" && !c.fader && c.id === turning);
  return (
    <div ref={frame} className={cn("relative block leading-none", className)} style={style}>
      <svg viewBox={`0 0 ${view[0]} ${view[1]}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
        {art}
      </svg>
      {interactive && <ControlLayer view={view} controls={controls} disabled={disabled} onActive={onActive} onTurning={onTurning} />}
      {lens && frame.current && <Loupe art={art} view={view} control={lens} frame={frame.current} />}
    </div>
  );
}
