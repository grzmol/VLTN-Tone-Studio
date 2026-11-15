/** Optional arrangement guidance stays visible on demand, separate from playback and MIDI problems. */
export function ArrangementAdvice({ items }: { items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <details aria-label="Arrangement advice" className="rounded border border-seam p-2">
      <summary className="cursor-pointer">Arrangement advice ({items.length})</summary>
      <p className="my-2 text-xs text-silkscreen-3">
        For section navigation and intentional trims. Advice does not change playback or require a change for a straight-through set.
      </p>
      <ul className="max-h-60 list-disc overflow-auto pl-5">
        {items.map((text, index) => (
          <li key={index}>{text}</li>
        ))}
      </ul>
    </details>
  );
}
