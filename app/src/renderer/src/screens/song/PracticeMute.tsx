import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRACTICE_KINDS, PRACTICE_LABEL, practiceSet, practiceSummary, usePracticeMute } from "@/song/performance/practice-mute";

/**
 * Says which instruments are muted in every song, with a button to turn them back on. Shown in the Performance tab and in stage mode
 * whenever any practice mute is on. `note` is the song-specific line, such as a muted kind the song has no track for.
 */
export function PracticeMuteBanner({ note }: { note?: string | null }) {
  const kinds = usePracticeMute((s) => s.kinds);
  const summary = practiceSummary(practiceSet(kinds));
  if (!summary) return null;
  return (
    <p role="status" aria-label="Practice mute" className="flex flex-wrap items-center gap-2 rounded-lg border border-led-warn px-3 py-2 text-sm text-led-warn">
      <span>
        {summary}
        {note ? `. ${note}` : ""}
      </span>
      <Button variant="outline" size="sm" onClick={() => usePracticeMute.getState().clear()}>
        Unmute
      </Button>
    </p>
  );
}

/** A compact menu with a checkbox per instrument kind. A checked kind is muted in every song, and the choice is not saved into any song. */
export function PracticeMuteMenu() {
  const kinds = usePracticeMute((s) => s.kinds);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label="Practice mute">
          Practice mute{kinds.length ? ` (${kinds.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-56 flex-col gap-2">
        <p className="text-xs text-silkscreen-3">Muted in every song. Each song keeps its own mix.</p>
        {PRACTICE_KINDS.map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label={`Mute ${PRACTICE_LABEL[kind].toLowerCase()} in every song`}
              checked={kinds.includes(kind)}
              onCheckedChange={(on) => usePracticeMute.getState().set(kind, on === true)}
            />
            {PRACTICE_LABEL[kind]}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
