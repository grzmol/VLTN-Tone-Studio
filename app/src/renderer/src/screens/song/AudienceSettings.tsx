import { SettingsCard } from "@/components/ui/settings-card";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { host } from "@/host";
import { AUDIENCE_LIMITS, AUDIENCE_ROTATIONS, type AudienceRotation } from "@shared/audience";
import type { AudienceStatus } from "@shared/host/audience";
import { useAudienceSettings } from "@/song/performance/audience-settings";
import { HelpNote } from "@/components/ui/help-note";

/** The audience display's controls and status: where it shows, how it is laid out, and blackout (spec 43). */
export function AudienceSettings() {
  const settings = useAudienceSettings();
  const [status, setStatus] = useState<AudienceStatus | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!host.audience) return;
    let live = true;
    void host.audience.status().then((next) => live && setStatus(next));
    const stop = host.audience.onStatus((next) => setStatus(next));
    return () => {
      live = false;
      stop();
    };
  }, []);
  if (!host.audience) return null;
  const run = (action: Promise<AudienceStatus>) => {
    setError("");
    action.then(setStatus).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const onDisplay = status?.windowing === "display";
  return (
    <SettingsCard
      title="Audience display"
      summary={status?.open ? "Audience display is on" : "Audience display is off"}
      storageKey="audience"
      defaultOpen={false}
      actions={
        <>
          {status?.open ? (
            <Button variant="outline" onClick={() => run(host.audience.close())}>
              Close audience display
            </Button>
          ) : (
            <Button variant="outline" onClick={() => run(host.audience.open())}>
              Open audience display
            </Button>
          )}
          <Button
            variant={settings.blackout ? "default" : "outline"}
            aria-pressed={settings.blackout}
            onClick={() => settings.update({ blackout: !settings.blackout })}
          >
            {settings.blackout ? "Blackout on" : "Blackout"}
          </Button>
        </>
      }
    >
      <p role="status" className="text-sm text-silkscreen-2">
        {error || status?.message || "Checking the audience display…"}
      </p>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {onDisplay && (
          <label className="flex items-center gap-2">
            Show on
            <Select
              value={status?.displayId === null || status?.displayId === undefined ? "window" : String(status.displayId)}
              onValueChange={(value) => run(host.audience.chooseDisplay(value === "window" ? null : Number(value)))}
            >
              <SelectTrigger aria-label="Audience display location" className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="window">A window</SelectItem>
                {status?.displayId !== null && status?.displayId !== undefined && !status.displays.some((d) => d.id === status.displayId) && (
                  <SelectItem value={String(status.displayId)}>Chosen display (not connected)</SelectItem>
                )}
                {status?.displays.map((display) => (
                  <SelectItem key={display.id} value={String(display.id)}>
                    {`${display.label}${display.primary ? " (main screen)" : ""} · ${display.width}×${display.height}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <Checkbox
            aria-label="Black between songs"
            checked={settings.blackBetweenSongs}
            onCheckedChange={(checked) => settings.update({ blackBetweenSongs: checked === true })}
          />
          Black between songs
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            aria-label="Show chords on the audience display"
            checked={settings.showChords}
            onCheckedChange={(checked) => settings.update({ showChords: checked === true })}
          />
          Show chords
        </label>
        <label className="flex items-center gap-2">
          Rotation
          <Select value={String(settings.rotation)} onValueChange={(value) => settings.update({ rotation: Number(value) as AudienceRotation })}>
            <SelectTrigger aria-label="Audience display rotation" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIENCE_ROTATIONS.map((turn) => (
                <SelectItem key={turn} value={String(turn)}>
                  {turn}°
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-56 flex-1 items-center gap-3">
          Text size {Math.round(settings.fontScale * 100)}%
          <Slider
            aria-label="Audience text size"
            min={Math.round(AUDIENCE_LIMITS.fontMin * 100)}
            max={Math.round(AUDIENCE_LIMITS.fontMax * 100)}
            step={5}
            value={[Math.round(settings.fontScale * 100)]}
            onValueChange={([percent]) => settings.update({ fontScale: percent / 100 })}
          />
        </label>
      </div>
      <HelpNote>
        <p>The audience window shows the lyrics and chords of the song on screen, or its PDF page, and follows playback. Closing it does not stop playback.</p>
      </HelpNote>
    </SettingsCard>
  );
}
