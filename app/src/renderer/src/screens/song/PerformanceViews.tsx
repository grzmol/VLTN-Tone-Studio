import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** The views the Performance tab is split into. Only one is shown at a time; the others stay mounted. */
export type PerformanceView = "play" | "song" | "lyrics" | "midi" | "setup";

export const PERFORMANCE_VIEWS: { value: PerformanceView; label: string }[] = [
  { value: "play", label: "Play" },
  { value: "song", label: "This song" },
  { value: "lyrics", label: "Lyrics & chords" },
  { value: "midi", label: "MIDI" },
  { value: "setup", label: "Setup" },
];

const STORAGE_KEY = "vltn.performance.view";

/** The view the Performance tab opens on: the one chosen last time, or Play when nothing (or something unknown) was saved. */
export function readPerformanceView(): PerformanceView {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return PERFORMANCE_VIEWS.some((view) => view.value === stored) ? (stored as PerformanceView) : "play";
  } catch {
    return "play";
  }
}

/** Remembers the chosen view for the next launch. Storage can be unavailable, in which case the choice is simply not kept. */
export function savePerformanceView(view: PerformanceView): void {
  try {
    localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // Not saved: the tab still switches views for this session.
  }
}

/** The view switcher, styled like the Song screen's tabs. Left and right arrow keys move between views. */
export function PerformanceViewSwitcher({ view, onView }: { view: PerformanceView; onView: (view: PerformanceView) => void }) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, step: number) => {
    const next = (from + step + PERFORMANCE_VIEWS.length) % PERFORMANCE_VIEWS.length;
    onView(PERFORMANCE_VIEWS[next].value);
    tabs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowRight") move(index, 1);
    else if (event.key === "ArrowLeft") move(index, -1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      role="tablist"
      aria-label="Performance view"
      className="inline-flex w-fit items-center justify-center gap-0.5 rounded-pill bg-white/7 p-[3px] text-silkscreen-2"
    >
      {PERFORMANCE_VIEWS.map((item, index) => {
        const selected = item.value === view;
        return (
          <button
            key={item.value}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onView(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "relative inline-flex h-[30px] items-center justify-center rounded-pill border border-transparent px-3.5 text-[12.5px] font-medium whitespace-nowrap text-foreground/60 transition-all hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
              selected && "bg-white/17 text-silkscreen shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_2px_8px_rgb(0_0_0/0.3)]",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
