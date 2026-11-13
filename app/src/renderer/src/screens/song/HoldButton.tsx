import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FollowerGate, STOP_SECOND_PRESS_MS } from "@/song/performance/band-control";

/**
 * A button for something that must not happen by accident, such as stopping the song on stage. It acts after a hold of 0.6 s (a ring fills
 * while it is held), or on a second press within 0.6 s of the first, by the same rule as a band follower's stop. A first press only arms it.
 */
export function HoldButton({
  children,
  armedLabel,
  onConfirm,
  className,
}: {
  children: ReactNode;
  armedLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const gate = useRef(new FollowerGate());
  const [armed, setArmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const disarm = useRef<ReturnType<typeof setTimeout>>(undefined);
  const held = useRef(false);

  useEffect(
    () => () => {
      clearTimeout(hold.current);
      clearTimeout(disarm.current);
    },
    [],
  );

  const release = () => {
    clearTimeout(hold.current);
    setHolding(false);
  };
  const pressDown = () => {
    held.current = false;
    setHolding(true);
    hold.current = setTimeout(() => {
      held.current = true;
      setHolding(false);
      setArmed(false);
      onConfirm();
    }, STOP_SECOND_PRESS_MS);
  };
  const click = () => {
    // The click that ends a completed hold is not a second press.
    if (held.current) {
      held.current = false;
      return;
    }
    clearTimeout(disarm.current);
    if (gate.current.take("transport.stop").kind === "run") {
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    disarm.current = setTimeout(() => setArmed(false), STOP_SECOND_PRESS_MS);
  };

  return (
    <Button
      variant="outline"
      data-armed={armed || undefined}
      className={`relative min-h-14 text-lg ${armed ? "border-amber-400 text-amber-300" : "border-red-400/60 text-red-300"} ${className ?? ""}`}
      onPointerDown={pressDown}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onClick={click}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-6 -rotate-90">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray="62.8"
          strokeDashoffset={holding ? 0 : 62.8}
          style={{
            transition: holding ? `stroke-dashoffset ${STOP_SECOND_PRESS_MS}ms linear` : "none",
          }}
        />
      </svg>
      {armed ? armedLabel : children}
    </Button>
  );
}
