import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { BASS_FROM, BASS_RANGES, DRUM_KITS, HUMANISE_CHOICES, type BandSettings, type BassFrom, type DrumKit, type FollowSource, type HumaniseChoice } from "@/song/band/arrangement";
import { DEFAULT_BASS_PARTS, type BassPart } from "@/song/band/bass-parts";
<<<<<<< HEAD
import { STYLE_IDS, STYLES, type StyleId } from "@/song/band/styles";
import { PartToneChain } from "./PartToneChain";
import { BASS_PART_LABELS } from "./band-labels";
=======
import type { StyleId } from "@/song/band/styles";
import { BASS_PART_LABELS, styleChoices } from "./band-labels";
>>>>>>> d5d3d9cf (feat(band): organise the Band dialog in tabs on a larger surface)
/**
 * The track of a band slider. The theme's muted track is nearly the colour of the glass dialog, so at a value of 0 only the thumb showed.
 * A lighter track keeps the full length visible at any value.
 */
const BAND_TRACK = "bg-white/15";
const BASS_RANGE_LABELS: Record<(typeof BASS_RANGES)[number], string> = { low: "Low", normal: "Normal", high: "High" };
const BASS_FROM_LABELS: Record<BassFrom, string> = { original: "Original bass", chords: "Chords" };
/** The kit menu's choices. "auto" leaves the kit to the style: the heavier kit for metal, rock and half-time. */
const KIT_LABELS: Record<DrumKit, string> = { standard: "Standard", rock: "Standard, heavier" };
const AUTO_KIT = "auto";
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
<<<<<<< HEAD
  /** The song's length in seconds, for the tone chains' render-time estimates. */
  songSeconds?: number;
}

/** The song-wide band settings. Changing one saves it; nothing is generated until Generate. */
export function BandSettingsForm({ settings, followSources, onChange, onStyle, songSeconds = 0 }: BandSettingsFormProps) {
=======
  /** The song's beats per bar, to list the styles written for it first. */
  beatsPerBar?: number;
}

/** The song-wide band settings, in two columns: drums, then bass. The tone chains are on the Sound tab. Changing one saves it; nothing is generated until Generate. */
export function BandSettingsForm({ settings, followSources, onChange, onStyle, beatsPerBar }: BandSettingsFormProps) {
>>>>>>> d5d3d9cf (feat(band): organise the Band dialog in tabs on a larger surface)
  return (
    <section aria-label="Band settings" className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-semibold">Drums</h3>
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate drums" checked={settings.parts.drums} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, drums: on } })} />
          Drums
        </label>
        <label className="flex items-center gap-3">
<<<<<<< HEAD
          Kit
          <Select value={settings.kit ?? AUTO_KIT} onValueChange={(value) => onChange({ kit: value === AUTO_KIT ? undefined : (value as DrumKit) })}>
            <SelectTrigger aria-label="Drum kit" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_KIT}>Automatic</SelectItem>
              {DRUM_KITS.map((kit) => (
                <SelectItem key={kit} value={kit}>
                  {KIT_LABELS[kit]}
=======
          Style
          <Select value={settings.style} onValueChange={(value) => onStyle(value as StyleId)}>
            <SelectTrigger aria-label="Style" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {styleChoices(beatsPerBar).map(({ id, label }) => (
                <SelectItem key={id} value={id}>
                  {label}
>>>>>>> d5d3d9cf (feat(band): organise the Band dialog in tabs on a larger surface)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-3">
<<<<<<< HEAD
          Room {Math.round(settings.drumRoom * 100)}%
          <Slider
            trackClassName={BAND_TRACK}
            aria-label="Room"
            min={0}
            max={100}
            step={5}
            value={[Math.round(settings.drumRoom * 100)]}
            onValueChange={([percent]) => onChange({ drumRoom: percent / 100 })}
          />
        </label>
=======
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
        <label className="flex items-center gap-2">
          <Switch aria-label="Play with the drummer's timing" checked={settings.followDrummer} onCheckedChange={(on) => onChange({ followDrummer: on })} />
          <span>
            Play with the drummer's timing
            <span className="block text-xs text-silkscreen-3">Moves each generated hit onto the original drummer's hit, when the song has a drums stem.</span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <Switch aria-label="Follow my playing" checked={settings.followPlaying} onCheckedChange={(on) => onChange({ followPlaying: on })} />
          Follow my playing
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
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-semibold">Bass</h3>
>>>>>>> d5d3d9cf (feat(band): organise the Band dialog in tabs on a larger surface)
        <label className="flex items-center gap-2">
          <Switch aria-label="Generate bass" checked={settings.parts.bass} onCheckedChange={(on) => onChange({ parts: { ...settings.parts, bass: on } })} />
          Bass
        </label>
<<<<<<< HEAD
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
=======
        {/* The bass sound choice is hidden until a second bass sample set exists. The field stays in BandSettings. */}
>>>>>>> d5d3d9cf (feat(band): organise the Band dialog in tabs on a larger surface)
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
        <div className="flex flex-col gap-1">
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
        <div className="flex flex-col gap-1">
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
      </div>
    </section>
  );
}
