import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BandSettings } from "@/song/band/arrangement";
import { COUNT_IN_SOUNDS, type CountInSettings, type CountInSound } from "@/song/band/count-in";

const BAR_LABELS = ["Off", "1 bar", "2 bars"] as const;
const SOUND_LABELS: Record<CountInSound, string> = { sticks: "Sticks", hat: "Hat" };

/**
 * The drummer's count before the song. It is its own short track, played through the generated drums, so the audience hears it (the
 * metronome's count-in goes to the click output).
 */
export function CountInControls({
  settings,
  disabled,
  onChange,
}: {
  settings: BandSettings;
  disabled?: boolean;
  onChange(patch: Partial<BandSettings>): void;
}) {
  const { countIn } = settings;
  const set = (next: Partial<CountInSettings>) => onChange({ countIn: { ...countIn, ...next } });
  return (
    <section aria-label="Drummer's count" className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <label className="flex items-center gap-3">
        Drummer counts in
        <Select value={String(countIn.bars)} disabled={disabled} onValueChange={(bars) => set({ bars: Number(bars) as CountInSettings["bars"] })}>
          <SelectTrigger aria-label="Drummer counts in" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BAR_LABELS.map((label, bars) => (
              <SelectItem key={label} value={String(bars)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {countIn.bars > 0 && (
        <label className="flex items-center gap-3">
          Counts on
          <Select value={countIn.sound} disabled={disabled} onValueChange={(sound) => set({ sound: sound as CountInSound })}>
            <SelectTrigger aria-label="Counts on" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNT_IN_SOUNDS.map((sound) => (
                <SelectItem key={sound} value={sound}>
                  {SOUND_LABELS[sound]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <p className="basis-full text-silkscreen-3">
        {countIn.bars === 0
          ? "The drummer starts with the song. Turn this on to hear a count through the drums, out to the audience."
          : "The count plays through the generated drums before the song, only when it starts from stopped or after the pause between songs. If the metronome's count-in is on too, the click count and the drummer's count both play."}
      </p>
    </section>
  );
}
