import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlaybackClock } from "@/song/performance/playback-clock";
import { MAX_SECTIONS, MAX_SECTION_NAME, SECTION_MODES, SECTION_MODE_LABELS, isSectionMode, snapToBeat, sortedSections, type Section } from "@/song/performance/sections";
import { SectionWaveform } from "./SectionWaveform";

/** Default length of a section added at the playhead, in seconds. */
const NEW_SECTION_S = 8;

/**
 * Edits the song's sections: names, boundaries, stored modes. Edits are saved with the song; the live changes made while playing are
 * not (see "Save as default" in the strip). Boundaries snap to the beat grid when a tempo is set.
 */
export function SectionEditor({
  sections,
  onSections,
  duration,
  bpm,
  firstBeat,
  channels,
}: {
  sections: Section[];
  onSections: (sections: Section[]) => void;
  duration: number;
  bpm: number;
  firstBeat: number;
  channels: Float32Array[] | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [edge, setEdge] = useState<"start" | "end">("start");
  const ordered = sortedSections(sections);
  const snap = (seconds: number) => (bpm > 0 ? snapToBeat(seconds, bpm, firstBeat) : seconds);
  const update = (id: string, patch: Partial<Section>) => onSections(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const valid = (start: number, end: number) => Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= duration && end - start >= 0.1;

  const add = () => {
    if (sections.length >= MAX_SECTIONS) return;
    const start = snap(usePlaybackClock.getState().position);
    const end = Math.min(duration, snap(start + NEW_SECTION_S));
    if (end - start < 0.1) return;
    const section: Section = { id: crypto.randomUUID(), name: `Section ${sections.length + 1}`, start, end, mode: "continue" };
    onSections([...sections, section]);
    setSelected(section.id);
  };

  const pick = (seconds: number) => {
    const section = sections.find((s) => s.id === selected);
    if (!section) return;
    const at = snap(seconds);
    const [start, end] = edge === "start" ? [at, section.end] : [section.start, at];
    if (valid(start, end)) update(section.id, { start, end });
  };

  return (
    <section aria-label="Section editor" className="flex flex-col gap-3">
      <SectionWaveform channels={channels} duration={duration} sections={sections} selected={selected} onPick={pick} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button variant="outline" size="sm" onClick={add} disabled={!duration || sections.length >= MAX_SECTIONS}>
          Add section at playhead
        </Button>
        <span className="text-muted-foreground">Click the waveform to place</span>
        <Button variant={edge === "start" ? "default" : "outline"} size="sm" aria-pressed={edge === "start"} onClick={() => setEdge("start")}>
          Start
        </Button>
        <Button variant={edge === "end" ? "default" : "outline"} size="sm" aria-pressed={edge === "end"} onClick={() => setEdge("end")}>
          End
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {ordered.map((section) => (
          <li key={section.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-seam px-3 py-2 text-sm" data-selected={section.id === selected}>
            <Input
              aria-label="Section name"
              className="w-40"
              maxLength={MAX_SECTION_NAME}
              value={section.name}
              onFocus={() => setSelected(section.id)}
              onChange={(e) => update(section.id, { name: e.target.value })}
            />
            <Input
              aria-label="Start, seconds"
              type="number"
              step={0.01}
              min={0}
              className="w-28"
              value={section.start}
              onFocus={() => setSelected(section.id)}
              onChange={(e) => update(section.id, { start: Number(e.target.value) })}
              onBlur={() => update(section.id, { start: snap(section.start) })}
            />
            <Input
              aria-label="End, seconds"
              type="number"
              step={0.01}
              min={0}
              className="w-28"
              value={section.end}
              onFocus={() => setSelected(section.id)}
              onChange={(e) => update(section.id, { end: Number(e.target.value) })}
              onBlur={() => update(section.id, { end: snap(section.end) })}
            />
            <Select
              value={section.mode}
              onValueChange={(value) => {
                if (isSectionMode(value)) update(section.id, { mode: value });
              }}
            >
              <SelectTrigger size="sm" aria-label="At the end">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {SECTION_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => onSections(sections.filter((s) => s.id !== section.id))}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
