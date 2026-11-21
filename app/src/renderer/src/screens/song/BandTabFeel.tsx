import type { BandSettings, FollowSource } from "@/song/band/arrangement";
import type { StyleId } from "@/song/band/styles";
import { BandSettingsForm } from "./BandSettingsForm";
import { CountInControls } from "./CountInControls";
import { EndingControls } from "./EndingControls";

/** The Feel tab: how the drums and the bass play, in two columns. */
export function BandTabFeel({
  settings,
  followSources,
  onChange,
  onStyle,
  beatsPerBar,
  sections = [],
}: {
  settings: BandSettings;
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  onStyle(id: StyleId): void;
  beatsPerBar?: number;
  /** The song's sections, for the ending's "End after". */
  sections?: readonly { id: string; name: string }[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <BandSettingsForm settings={settings} followSources={followSources} onChange={onChange} onStyle={onStyle} beatsPerBar={beatsPerBar} />
      <CountInControls settings={settings} onChange={onChange} />
      <EndingControls settings={settings} sections={sections} onChange={onChange} />
    </div>
  );
}
