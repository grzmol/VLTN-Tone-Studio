import type { ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * A short explanation that stays closed until someone asks for it. The text is still in the page (for search and screen readers), just folded.
 */
export function HelpNote({ children, label = "How this works" }: { children: ReactNode; label?: string }) {
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <Info aria-hidden="true" className="size-3.5" />
        {label}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed">{children}</div>
    </details>
  );
}
