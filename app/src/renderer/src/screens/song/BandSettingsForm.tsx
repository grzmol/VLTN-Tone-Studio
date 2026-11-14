import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { BASS_FROM, BASS_RANGES, HUMANISE_CHOICES, type BandSettings, type BassFrom, type FollowSource, type HumaniseChoice } from "@/song/band/arrangement";
import { DEFAULT_BASS_PARTS, type BassPart } from "@/song/band/bass-parts";
import { STYLE_IDS, STYLES, type StyleId } from "@/song/band/styles";
import { PartToneChain } from "./PartToneChain";
import { BASS_PART_LABELS } from "./band-labels";
/**
 * The track of a band slider. The theme's muted track is nearly the colour of the glass dialog, so at a value of 0 only the thumb showed.
 * A lighter track keeps the full length visible at any value.
 */
const BAND_TRACK = "bg-white/15";
const BASS_RANGE_LABELS: Record<(typeof BASS_RANGES)[number], string> = { low: "Low", normal: "Normal", high: "High" };
const BASS_FROM_LABELS: Record<BassFrom, string> = { original: "Original bass", chords: "Chords" };
const FOLLOW_LABELS: Record<FollowSource, string> = { auto: "Auto", guitar: "Guitar", piano: "Piano", other: "Other", mix: "Mix" };
const HUMANISE_LABELS: Record<HumaniseChoice, string> = {
  style: "Style default",
  tight: "Tight",
  natural: "Natural",
  "laid-back": "Laid back",
  pushed: "Pushed",
};

export interface BandSettingsFormProps {
  settings: BandSettings;
  /** The follow sources the song can read: auto, then the stems that were split, then the mix. */
  followSources: readonly FollowSource[];
  onChange(patch: Partial<BandSettings>): void;
  /** Changes the style, which also sets its swing default. */
  onStyle(id: StyleId): void;
  /** The song's length in seconds, for the tone chains' render-time estimates. */
  songSeconds?: number;
}

/** The song-wide band settings. Changing one saves it; nothing is generated until Generate. */
export function BandSettingsForm({ settings, followSources, onChange, onStyle, songSeconds = 0 }: BandSettingsFormProps) {
  return (
    <section aria-label="Band settings" className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <h3 className="font-semibold sm:col-span-2">Settings</h3>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate drums" checked={settings.parts.drums} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, drums: on } })} />
          Drums
        </label>
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate bass" checked={settings.parts.bass} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, bass: on } })} />
          Bass
        </label>
      </div>
      <label className="flex items-center gap-3">
        Style
        <Select value={settings.style} onValueChange={(value) => onStyle(value as StyleId)}>
          <SelectTrigger aria-label="Style" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STYLE_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                {STYLES[id].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-3">
        Complexity {Math.round(settings.complexity * 100)}%
        <Slider
          trackClassName={BAND_TRACK}
          aria-label="Complexity"
          min={0}
          max={100}
          step={5}
          value={[Math.round(settings.complexity * 100)]}
          onValueChange={([percent]) => onChange({ complexity: percent / 100 })}
        />
      </label>
      <label className="flex items-center gap-3">
        Swing {Math.round(settings.swing * 100)}%
        <Slider
          trackClassName={BAND_TRACK}
          aria-label="Swing"
          min={0}
          max={75}
          step={5}
          value={[Math.round(settings.swing * 100)]}
          onValueChange={([percent]) => onChange({ swing: percent / 100 })}
        />
      </label>
      <label className="flex items-center gap-3">
        Humanise {Math.round(settings.humanise.amount * 100)}%
        <Slider
          trackClassName={BAND_TRACK}
          aria-label="Humanise"
          min={0}
          max={100}
          step={5}
          value={[Math.round(settings.humanise.amount * 100)]}
          onValueChange={([percent]) => onChange({ humanise: { ...settings.humanise, amount: percent / 100 } })}
        />
      </label>
      <label className="flex items-center gap-3">
        Feel
        <Select value={settings.humanise.feel} onValueChange={(value) => onChange({ humanise: { ...settings.humanise, feel: value as HumaniseChoice } })}>
          <SelectTrigger aria-label="Humanise feel" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HUMANISE_CHOICES.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {HUMANISE_LABELS[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Ghost notes" checked={settings.ghostNotes} onCheckedChange={(on) => onChange({ ghostNotes: on })} />
        Ghost notes
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Crash on section starts" checked={settings.crashOnSections} onCheckedChange={(on) => onChange({ crashOnSections: on })} />
        Crash on section starts
      </label>
      {/* The bass sound choice is hidden until a second bass sample set exists. The field stays in BandSettings. */}
      <label className="flex items-center gap-3">
        Bass range
        <Select value={settings.bassRange} onValueChange={(value) => onChange({ bassRange: value as BandSettings["bassRange"] })}>
          <SelectTrigger aria-label="Bass range" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BASS_RANGES.map((range) => (
              <SelectItem key={range} value={range}>
                {BASS_RANGE_LABELS[range]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="flex items-center gap-3">
          Default bass part
          <Select value={settings.defaultBassPart} onValueChange={(value) => onChange({ defaultBassPart: value as BassPart })}>
            <SelectTrigger aria-label="Default bass part" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEFAULT_BASS_PARTS.map((part) => (
                <SelectItem key={part} value={part}>
                  {BASS_PART_LABELS[part]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs text-silkscreen-3">Used where a section is on Auto and has no rule of its own.</p>
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <label className="flex items-center gap-3">
          Bass notes from
          <Select value={settings.bassFrom} onValueChange={(value) => onChange({ bassFrom: value as BassFrom })}>
            <SelectTrigger aria-label="Bass notes from" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BASS_FROM.map((from) => (
                <SelectItem key={from} value={from}>
                  {BASS_FROM_LABELS[from]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs text-silkscreen-3">
          Original bass plays the notes the song&apos;s bass stem plays, where it has them. Chords plays each chord&apos;s bass.
        </p>
      </div>
      <label className="flex items-center gap-3">
        Feel
        <span className="text-xs text-silkscreen-3">Tight</span>
        <Slider
          trackClassName={BAND_TRACK}
          aria-label="Bass feel"
          min={0}
          max={100}
          step={5}
          value={[Math.round(settings.bassFeel * 100)]}
          onValueChange={([percent]) => onChange({ bassFeel: percent / 100 })}
        />
        <span className="text-xs text-silkscreen-3">Ring</span>
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Lock bass to kick" checked={settings.lockToKick} onCheckedChange={(on) => onChange({ lockToKick: on })} />
        Lock bass to kick
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Follow my playing" checked={settings.followPlaying} onCheckedChange={(on) => onChange({ followPlaying: on })} />
        Follow my playing
      </label>
      <label className="flex items-center gap-2">
        <Switch aria-label="Play with the drummer's timing" checked={settings.followDrummer} onCheckedChange={(on) => onChange({ followDrummer: on })} />
        <span>
          Play with the drummer's timing
          <span className="block text-xs text-silkscreen-3">Moves each generated hit onto the original drummer's hit, when the song has a drums stem.</span>
        </span>
      </label>
      <label className="flex items-center gap-3">
        Follow source
        <Select
          value={followSources.includes(settings.followSource) ? settings.followSource : "auto"}
          disabled={!settings.followPlaying}
          onValueChange={(value) => onChange({ followSource: value as FollowSource })}
        >
          <SelectTrigger aria-label="Follow source" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {followSources.map((source) => (
              <SelectItem key={source} value={source}>
                {FOLLOW_LABELS[source]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <PartToneChain part="drums" tone={settings.drumTone} songSeconds={songSeconds} onChange={(drumTone) => onChange({ drumTone })} />
      <PartToneChain part="bass" tone={settings.bassTone} songSeconds={songSeconds} onChange={(bassTone) => onChange({ bassTone })} />
    </section>
  );
}
