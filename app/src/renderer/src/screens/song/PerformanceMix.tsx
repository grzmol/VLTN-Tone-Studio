import { defaultStemMix, type Mix, type StemMix } from "@/song/stems/mix";
import type { TrackBuses } from "@/song/stems/player";
import type { Stems } from "@/song/types";
import { BUS_LABELS, BUS_NAMES, type BusName } from "@/song/audio/outputs";
import { useSession, type PerformanceSession } from "@/song/performance/session";
import { followsPitch } from "@/song/performance/speed";
import { clickStretchWarning, setSolo, silenceGroupmates, type TrackInfo } from "@/song/tracks";
import { ORIGINAL_PARTS, partKeysOf, silencedByChoice, type PartChoices } from "@/song/band/part-choice";
import { STEM_LABEL } from "./stems/StemMixer";
import type { StemName } from "@/song/types";

/**
 * The name a mixer row shows. A split stem uses the Stems tab's name for it, so the two mixers read alike; a generated or imported track
 * shows its own name; with no split the song is one row called Song.
 */
function rowName(name: string, stems: Stems | null, info: TrackInfo | undefined): string {
  if (!stems) return "Song";
  if (info?.kind === "stem" || (info === undefined && name in STEM_LABEL)) return STEM_LABEL[name as StemName] ?? name;
  return info?.name ?? name;
}

// One grid for every row, so the columns line up: name, solo, volume, pan, follows pitch, bus and mute groups.
const ROW_GRID = "grid grid-cols-[minmax(9rem,1.2fr)_auto_minmax(8rem,1fr)_minmax(7rem,0.8fr)_auto_minmax(7rem,auto)_minmax(10rem,auto)] gap-x-3";

/** The mute groups a track belongs to, by key, as the exclusive rule reads them. */
function groupsOf(tracks: Record<string, TrackInfo>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(tracks).map(([key, info]) => [key, info.muteGroups ?? []]));
}

/** The mix with `name` muted or unmuted. Unmuting (or soloing) a track in an exclusive group mutes the rest of that group. */
function withMute(mix: Mix, groups: Record<string, number[]>, name: string, mute: boolean): Mix {
  const next = { ...mix, [name]: { ...(mix[name] ?? defaultStemMix()), mute } };
  return mute ? next : silenceGroupmates(next, groups, name);
}

/**
 * Per-track mute, solo, volume and pan, the output bus each track plays on, and the pitch choice. Each track's name, colour and
 * mute groups come from what the song saved for it. A click-like track stretched at speed gets a warning, not a silent stretch.
 */
export function PerformanceMix({
  session,
  stems,
  tracks,
  mix,
  onMix,
  trackBuses,
  onTrackBus,
  onTrackInfo,
  partChoices = ORIGINAL_PARTS,
}: {
  session: PerformanceSession;
  stems: Stems | null;
  tracks: Record<string, TrackInfo>;
  mix: Mix;
  onMix: (update: (mix: Mix) => Mix) => void;
  trackBuses: TrackBuses;
  onTrackBus: (name: string, bus: BusName) => void;
  onTrackInfo: (key: string, patch: Partial<Omit<TrackInfo, "kind">>) => void;
  /** What "What plays" is set to. A track it silences is marked, so a muted original or generated part does not look like a fault. */
  partChoices?: PartChoices;
}) {
  const player = useSession(session, (s) => s.player);
  const speed = useSession(session, (s) => s.speed);
  if (!player) return null;
  const groups = groupsOf(tracks);
  const busOf = (name: string): BusName => trackBuses[name] ?? tracks[name]?.bus ?? "main";
  const warning = clickStretchWarning(
    speed.rate,
    player.names.map((name) => ({ key: name, name: tracks[name]?.name ?? name, bus: busOf(name) })),
  );
  const label = (name: string) => rowName(name, stems, tracks[name]);
  const silenced = silencedByChoice(partChoices, partKeysOf(tracks, stems));
  const usedGroups = [...new Set(Object.values(groups).flat())].sort((a, b) => a - b);
  return (
    <div aria-label="Performance mixer" className="flex flex-col gap-3">
      {usedGroups.length > 0 && (
        <div aria-label="Mute groups" className="flex flex-wrap gap-2 text-sm">
          {usedGroups.map((group) => {
            const members = player.names.filter((name) => groups[name]?.includes(group));
            const active = player.names.every((name) => (members.includes(name) ? !mix[name]?.mute : mix[name]?.mute));
            return (
              <button
                key={group}
                type="button"
                aria-pressed={active}
                className={`rounded-pill border px-3 py-1 ${active ? "border-led-on text-led-on" : "border-seam"}`}
                onClick={() =>
                  // The group is a scene: its tracks play and the rest are muted. The exclusive rule is not applied here, or it would mute the group's own members.
                  onMix((current) => {
                    const next = { ...current };
                    for (const name of player.names) next[name] = { ...(current[name] ?? defaultStemMix()), mute: active ? false : !members.includes(name) };
                    return next;
                  })
                }
              >
                Group {group}
              </button>
            );
          })}
        </div>
      )}
      {warning && (
        <p role="status" className="rounded-lg border border-seam px-3 py-2 text-sm text-led-warn">
          {warning}
        </p>
      )}
      <div aria-label="Mixer rows" className={`${ROW_GRID} items-center gap-y-2`}>
        {player.names.map((name) => {
          const entry: StemMix = mix[name] ?? defaultStemMix();
          const info = tracks[name];
          const off = silenced[name];
          return (
            <div
              key={name}
              role="group"
              aria-label={label(name)}
              className="col-span-full grid grid-cols-subgrid items-center rounded-lg border border-seam px-3 py-2 text-sm"
            >
              <div className={`flex min-w-0 items-center gap-2 ${off ? "opacity-60" : ""}`}>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: info?.color ?? "#94a3b8" }} />
                <label className="flex min-w-0 items-center gap-1.5">
                  <input
                    type="checkbox"
                    aria-label={`${label(name)} enabled`}
                    checked={!entry.mute}
                    onChange={(e) => {
                      // Read the input now: an updater runs after React has put a controlled input back, so its value would be stale.
                      const enabled = e.target.checked;
                      onMix((m) => withMute(m, groups, name, !enabled));
                    }}
                  />
                  <span className="truncate">{label(name)}</span>
                </label>
                {off && <span className="shrink-0 rounded-md border border-seam px-1.5 py-0.5 text-xs text-silkscreen-3">{off}</span>}
              </div>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${label(name)} solo`}
                  checked={entry.solo}
                  onChange={(e) => {
                    const solo = e.target.checked;
                    onMix((m) => setSolo(m, groups, name, solo));
                  }}
                />
                Solo
              </label>
              <div className="flex items-center gap-2">
                <input
                  aria-label={`${label(name)} volume`}
                  className="min-w-0 flex-1"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={entry.volume}
                  onChange={(e) => {
                    const volume = Number(e.target.value);
                    onMix((m) => ({ ...m, [name]: { ...(m[name] ?? defaultStemMix()), volume } }));
                  }}
                />
                <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(entry.volume * 100)}%</span>
              </div>
              <input
                aria-label={`${label(name)} pan`}
                className="w-full"
                type="range"
                min="-1"
                max="1"
                step="0.05"
                value={entry.pan ?? 0}
                onChange={(e) => {
                  const pan = Number(e.target.value);
                  onMix((m) => ({ ...m, [name]: { ...(m[name] ?? defaultStemMix()), pan } }));
                }}
              />
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${label(name)} follows pitch`}
                  checked={followsPitch(speed, name)}
                  onChange={(e) => session.setSpeed({ followsPitch: { ...speed.followsPitch, [name]: e.target.checked } })}
                />
                Follows pitch
              </label>
              <select
                aria-label={`${label(name)} bus`}
                className="w-full rounded-md border border-seam bg-transparent px-2 py-1"
                value={busOf(name)}
                onChange={(e) => onTrackBus(name, e.target.value as BusName)}
              >
                {BUS_NAMES.map((bus) => (
                  <option key={bus} value={bus}>
                    {BUS_LABELS[bus]}
                  </option>
                ))}
              </select>
              {info?.kind === "user" ? (
                <fieldset className="flex gap-1" aria-label={`${label(name)} mute groups`}>
                  {[1, 2, 3, 4, 5, 6].map((group) => {
                    const member = info.muteGroups?.includes(group) ?? false;
                    return (
                      <button
                        key={group}
                        type="button"
                        aria-pressed={member}
                        aria-label={`${label(name)} in group ${group}`}
                        className={`size-6 rounded-md border text-xs ${member ? "border-led-on text-led-on" : "border-seam"}`}
                        onClick={() => {
                          const next = member ? (info.muteGroups ?? []).filter((g) => g !== group) : [...(info.muteGroups ?? []), group].sort((a, b) => a - b);
                          onTrackInfo(name, { muteGroups: next });
                        }}
                      >
                        {group}
                      </button>
                    );
                  })}
                </fieldset>
              ) : (
                <span aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
