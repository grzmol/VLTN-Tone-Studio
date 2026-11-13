import type { BandSettings, FollowSource } from "@/song/band/arrangement";
import type { StyleId } from "@/song/band/styles";
import { BandSettingsForm } from "./BandSettingsForm";

/** The Feel tab: how the drums and the bass play, in two columns. */
export function BandTabFeel({
  settings,
  followSources,
  onChange,
  onStyle,
  beatsPerBar,
}: {
  settings: BandSettings;
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  onStyle(id: StyleId): void;
  beatsPerBar?: number;
}) {
  return <BandSettingsForm settings={settings} followSources={followSources} onChange={onChange} onStyle={onStyle} beatsPerBar={beatsPerBar} />;
}
