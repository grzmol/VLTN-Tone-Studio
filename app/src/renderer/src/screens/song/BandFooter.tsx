import { ChevronDown, Ellipsis, Info, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { BandNotice } from "./band-status";
import { NO_SONG_TEXT, PLAYING_TEXT } from "./band-panel-helpers";

export type PreviewChoice = "whole" | "4" | "8";
const PREVIEW_LENGTHS: { value: PreviewChoice; label: string }[] = [
  { value: "whole", label: "Whole section" },
  { value: "4", label: "4 bars" },
  { value: "8", label: "8 bars" },
];

export interface BandFooterProps {
  noSong: boolean;
  playing: boolean;
  /** What the panel is doing, shown with a progress bar, or null. */
  work: string | null;
  /** True while Find the beat runs: its progress stays on the Timing tab, so the footer does not repeat it. */
  finding: boolean;
  /** What the running preview is ("Previewing Chorus (8 bars)…"), or null. */
  previewing: string | null;
  /** True after a Generate that went through, until the next action. */
  done: boolean;
  /** The label of Play from the start / Play from a section, offered in Preview's place for a few seconds after Generate, or null. */
  playFrom: { label: string; run(): void } | null;
  notices: readonly BandNotice[];
  /** True while an action runs or the song plays, or with no song: the actions are then disabled. */
  blocked: boolean;
  hasGrid: boolean;
  hasGeneratedParts: boolean;
  canExportMidi: boolean;
  rhythm?: { enabled: boolean; title: string };
  previewLength: PreviewChoice;
  fromPlayhead: boolean;
  onPreviewLength(length: PreviewChoice): void;
  onFromPlayhead(on: boolean): void;
  onCancel(): void;
  onGenerate(): void;
  onTryAnother(): void;
  onPreview(): void;
  onStopPreview(): void;
  onRemove(): void;
  onExportMidi(): void;
  onExportRhythm?(): void;
}

/**
 * The Band dialog's one-row footer. Left: the More menu (export, remove) and the status line (progress, preview, Done, then the problems
 * as amber text, and the information notes behind a button). Right: Preview with its menu, Try another and Generate.
 */
export function BandFooter(props: BandFooterProps) {
  const { notices, blocked, hasGrid, previewing, work, finding } = props;
  const warnings = notices.filter((notice) => notice.level === "warning");
  const infos = notices.filter((notice) => notice.level === "info");
  const needsGrid = blocked || !hasGrid;
  return (
    <footer aria-label="Band actions" className="flex h-14 shrink-0 items-center gap-3 border-t border-seam pt-2 text-sm">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="More actions">
            <Ellipsis aria-hidden />
            More
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled={props.playing || !props.canExportMidi} onSelect={props.onExportMidi}>
            Export MIDI…
          </DropdownMenuItem>
          {props.rhythm && (
          <DropdownMenuItem disabled={blocked || previewing !== null || !props.rhythm.enabled} title={props.rhythm.title} onSelect={props.onExportRhythm}>
            Export for BOSS RC-10R…
          </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={blocked || !props.hasGeneratedParts} onSelect={props.onRemove}>
            Remove generated parts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex min-w-0 flex-1 items-center gap-3">
        {props.noSong && (
          <p role="note" className="truncate text-led-warn">
            {NO_SONG_TEXT}
          </p>
        )}
        {props.playing && (
          <p role="note" className="truncate text-led-warn">
            {PLAYING_TEXT}
          </p>
        )}
        {work && !finding && (
          <div className="flex shrink-0 items-center gap-2" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            <span>{work}</span>
            <span aria-hidden className="h-1 w-20 overflow-hidden rounded-pill bg-well">
              <span className="block h-full w-1/3 animate-pulse rounded-pill bg-silkscreen-2" />
            </span>
            <Button size="sm" variant="ghost" onClick={props.onCancel}>
              Cancel
            </Button>
          </div>
        )}
        {previewing && !work && <p role="status">{previewing}</p>}
        {props.done && !work && <p role="status">Done. Drums and bass are in the mixer.</p>}
        {warnings.length > 0 && (
          <ul role="status" className="flex min-w-0 flex-col text-led-warn">
            {warnings.map((notice) => (
              <li key={notice.text} className="truncate" title={notice.text}>
                {notice.text}
              </li>
            ))}
          </ul>
        )}
        {infos.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="shrink-0">
                <Info aria-hidden />
                {infos.length === 1 ? "1 note" : `${infos.length} notes`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-96 flex-col gap-2 text-sm">
              {infos.map((notice) => (
                <p key={notice.text}>{notice.text}</p>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center">
          <Button
            variant="outline"
            className="rounded-r-none"
            disabled={props.playFrom ? false : needsGrid}
            onClick={() => (props.playFrom ? props.playFrom.run() : previewing ? props.onStopPreview() : props.onPreview())}
          >
            {props.playFrom ? props.playFrom.label : previewing ? "Stop preview" : "Preview"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="rounded-l-none border-l-0"
                aria-label="Preview options"
                disabled={blocked || previewing !== null}
              >
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={props.previewLength} onValueChange={(value) => props.onPreviewLength(value as PreviewChoice)}>
                {PREVIEW_LENGTHS.map(({ value, label }) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={props.fromPlayhead} onCheckedChange={props.onFromPlayhead}>
                From the playhead
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button variant="outline" disabled={needsGrid} onClick={props.onTryAnother}>
          Try another
        </Button>
        <Button disabled={needsGrid} onClick={props.onGenerate}>
          Generate
        </Button>
      </div>
    </footer>
  );
}
