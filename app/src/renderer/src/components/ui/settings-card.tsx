import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY_PREFIX = "vltn.card.";

/** The open state a card was left in, or the default when nothing (or something unreadable) was saved. */
function readOpen(storageKey: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(KEY_PREFIX + storageKey);
    if (stored === "open") return true;
    if (stored === "closed") return false;
  } catch {
    // Storage is unavailable: the card falls back to its default.
  }
  return fallback;
}

/** Remembers whether a card is open. Storage can be unavailable, in which case the choice is kept only for this session. */
function saveOpen(storageKey: string, open: boolean): void {
  try {
    localStorage.setItem(KEY_PREFIX + storageKey, open ? "open" : "closed");
  } catch {
    // Not saved: the card still opens and closes.
  }
}

/**
 * A settings card with one style for the Performance views. Its header shows the title, a one-line summary and any actions, and
 * the actions stay usable while the card is closed. The body is only hidden, never unmounted, because it holds listeners and effects.
 */
export function SettingsCard({
  title,
  summary,
  storageKey,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  /** One line that says the card's state, so it still reads when closed. */
  summary?: ReactNode;
  /** Saved per card as `vltn.card.<storageKey>`. */
  storageKey: string;
  defaultOpen?: boolean;
  /** Buttons that stay usable while the card is closed. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));
  const bodyId = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    saveOpen(storageKey, next);
  };
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border border-seam bg-black/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex min-w-0 items-center gap-2 font-semibold">
          <button type="button" aria-expanded={open} aria-controls={bodyId} onClick={toggle} className="flex items-center gap-2 text-left">
            <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")} />
            {title}
          </button>
        </h3>
        {summary && <span className="text-sm text-silkscreen-3">{summary}</span>}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div id={bodyId} hidden={!open}>
        <div className="flex flex-col gap-3">{children}</div>
      </div>
    </section>
  );
}
