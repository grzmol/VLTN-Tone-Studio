import type { BandSettings, FollowSource } from "@/song/band/arrangement";
import type { StyleId } from "@/song/band/styles";
import type { PcmAudio } from "@/song/types";
import { BandSettingsForm } from "./BandSettingsForm";
import { EndingControls } from "./EndingControls";

/** The Feel tab: how the drums and the bass play, in two columns. */
export function BandTabFeel({
  settings,
  followSources,
  onChange,
  onStyle,
  beatsPerBar,
  sections = [],
  keptAudio,
}: {
  settings: BandSettings;
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  onStyle(id: StyleId): void;
  beatsPerBar?: number;
  /** The song's sections, for the ending's "End after". */
  sections?: readonly { id: string; name: string }[];
  /** The original tracks that keep playing under the band, for the ending's fade notice. */
  keptAudio?: readonly PcmAudio[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <BandSettingsForm settings={settings} followSources={followSources} onChange={onChange} onStyle={onStyle} beatsPerBar={beatsPerBar} />
      <EndingControls settings={settings} sections={sections} keptAudio={keptAudio} onChange={onChange} />
    </div>
  );
}
