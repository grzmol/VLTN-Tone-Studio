import { lrcTime } from "@/song/performance/chart";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTime } from "@/song/stems/mix";
import type { RhythmAutomationDraft, RhythmAutomationPlan, RhythmAutomationSong as AutomationSong } from "@/song/performance/rhythm-automation";

export interface RhythmAutomationEntry {
  song: AutomationSong;
  draft: RhythmAutomationDraft;
  plan: RhythmAutomationPlan | null;
  error: string;
}

/** Per-song choices next to the MIDI that will be saved. Nothing here sends to the pedal. */
export function RhythmAutomationSong({ entry, onChange }: { entry: RhythmAutomationEntry; onChange(draft: RhythmAutomationDraft): void }) {
  const { song, draft, plan, error } = entry;
  return (
    <details className="rounded border border-seam p-3" open>
      <summary className="cursor-pointer font-medium">
        {song.title} · pedal memory {draft.memory}
      </summary>
      <div className="space-y-3 pt-3 text-sm">
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["Memory", "memory", 1, 99, 1],
              ["Pedal BPM", "bpm", 40, 350, 1],
              ["Rhythm starts at (s)", "start", 0, song.duration, 0.01],
              ["Ending begins at (s)", "endingAt", 0, song.duration, 0.01],
              ["Intro bars", "introBars", 0, 32, 1],
              ["Pattern change lead (bars)", "changeLeadBars", 0, 2, 0.25],
            ] as const
          ).map(([label, key, min, max, step]) => (
            <label key={key} className="flex flex-col gap-1">
              {label}
              <Input
                aria-label={`${song.title}: ${label}`}
                className="w-32"
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(draft[key]) ? draft[key] : ""}
                onChange={(event) => onChange({ ...draft, [key]: event.target.valueAsNumber })}
              />
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <Checkbox checked={draft.fills} onCheckedChange={(checked) => onChange({ ...draft, fills: checked === true })} />
          Add a fill before sections that keep the same pattern
        </label>
        {error && <p role="alert">{error}</p>}
        {plan && (
          <>
            <p>
              On this memory set RHY PLAY MODE to {plan.firstPattern === 1 ? "PTN1 → PTN2" : "PTN2 → PTN1"} and RHYTHM INTRO to {draft.introBars ? "ON" : "OFF"}
              .
            </p>
            <div className="flex flex-wrap gap-3">
              {plan.sections.map((section) => (
                <label className="flex flex-col gap-1" key={section.id}>
                  {section.name} ({formatTime(section.start)})
                  <Select
                    value={String(draft.patterns[section.id])}
                    onValueChange={(value) => onChange({ ...draft, patterns: { ...draft.patterns, [section.id]: value === "2" ? 2 : 1 } })}
                  >
                    <SelectTrigger aria-label={`${song.title}: ${section.name} pattern`} className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Pattern 1</SelectItem>
                      <SelectItem value="2">Pattern 2</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </div>
            {plan.warnings.map((warning) => (
              <p key={warning} className="text-amber-200">
                {warning}
              </p>
            ))}
            <div className="max-h-48 overflow-auto">
              <table aria-label={`${song.title} automatic rhythm cues`} className="w-full text-left">
                <thead>
                  <tr>
                    <th className="p-1">When</th>
                    <th className="p-1">Pedal action</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.events.map((event, i) => (
                    <tr key={i}>
                      <td className="p-1">{typeof event.time === "number" ? lrcTime(event.time) : `On ${event.time}`}</td>
                      <td className="p-1">{event.label.replace("RC-10R: ", "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </details>
  );
}
