import { SettingsCard } from "@/components/ui/settings-card";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOutputSettings } from "@/song/audio/output-settings";
import { BUS_LABELS, BUS_NAMES, listOutputDevices, type BusName, type OutputDevice } from "@/song/audio/outputs";

/** The devices the system lists, refreshed when one is plugged in or removed. */
function useOutputDevices(): OutputDevice[] {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void listOutputDevices().then((list) => live && setDevices(list ?? []));
    load();
    const mediaDevices = globalThis.navigator?.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      live = false;
      mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, []);
  return devices;
}

/** Listed devices, plus a saved one that is not connected right now, so the choice stays visible. */
function deviceOptions(devices: OutputDevice[], saved: OutputDevice | null): OutputDevice[] {
  if (!saved || devices.some((device) => device.deviceId === saved.deviceId)) return devices;
  return [...devices, { deviceId: saved.deviceId, label: `${saved.label || "Saved output"} (not connected)` }];
}

function DeviceSelect({
  label,
  value,
  options,
  defaultLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: OutputDevice[];
  defaultLabel: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-silkscreen-2">{label}</span>
      <select className="rounded-md border border-seam bg-transparent px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{defaultLabel}</option>
        {options.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `Output ${device.deviceId.slice(0, 6)}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Outputs for the Performance session: the main device, an optional device for the click, and each bus's channel pair and gain.
 * The pairs offered come from the main device's channel count. "Test" plays a short tone on that bus alone.
 */
export function PerformanceOutputs({ player }: { player: { outputChannels: number; testTone: (bus: BusName) => void } | null }) {
  const config = useOutputSettings((state) => state.config);
  const update = useOutputSettings((state) => state.update);
  const devices = useOutputDevices();
  const channels = player?.outputChannels ?? 2;
  const pairs = Array.from({ length: Math.floor(channels / 2) }, (_, i) => i * 2);
  const mainOptions = deviceOptions(devices, config.deviceId ? { deviceId: config.deviceId, label: config.label } : null);
  const clickOptions = deviceOptions(devices, config.clickDevice);

  return (
    <SettingsCard title="Audio outputs" summary="Main, click and aux outputs" storageKey="outputs" defaultOpen={false}>
      <div className="flex flex-wrap gap-3">
        <DeviceSelect
          label="Main device"
          value={config.deviceId}
          options={mainOptions}
          defaultLabel="System default"
          onChange={(deviceId) => {
            const device = mainOptions.find((option) => option.deviceId === deviceId);
            update({ ...config, deviceId, label: deviceId ? (device?.label ?? "") : "" });
          }}
        />
        <DeviceSelect
          label="Click device"
          value={config.clickDevice?.deviceId ?? ""}
          options={clickOptions}
          defaultLabel="Same as main"
          onChange={(deviceId) => {
            const device = clickOptions.find((option) => option.deviceId === deviceId);
            update({ ...config, clickDevice: deviceId ? { deviceId, label: device?.label ?? "" } : null });
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        {BUS_NAMES.map((name) => {
          const bus = config.buses[name];
          const ownDevice = name === "click" && config.clickDevice !== null;
          const pair = String(bus.channels[0]);
          return (
            <div key={name} className="flex flex-wrap items-center gap-3 rounded-lg border border-seam px-3 py-2">
              <span className="w-14 font-medium">{BUS_LABELS[name]}</span>
              {ownDevice ? (
                <span className="text-xs text-silkscreen-2">Outputs 1–2 of the click device</span>
              ) : (
                <select
                  aria-label={`${BUS_LABELS[name]} outputs`}
                  className="rounded-md border border-seam bg-transparent px-2 py-1"
                  value={pair}
                  onChange={(e) => {
                    const left = Number(e.target.value);
                    update({ ...config, buses: { ...config.buses, [name]: { ...bus, channels: [left, left + 1] } } });
                  }}
                >
                  {pairs.map((left) => (
                    <option key={left} value={String(left)}>
                      Outputs {left + 1}–{left + 2}
                    </option>
                  ))}
                </select>
              )}
              <input
                aria-label={`${BUS_LABELS[name]} gain`}
                type="range"
                min="0"
                max="2"
                step="0.05"
                className="w-28"
                value={bus.gain}
                onChange={(e) => update({ ...config, buses: { ...config.buses, [name]: { ...bus, gain: Number(e.target.value) } } })}
              />
              <Button variant="outline" size="sm" aria-label={`Test ${BUS_LABELS[name]}`} disabled={!player} onClick={() => player?.testTone(name)}>
                Test
              </Button>
            </div>
          );
        })}
      </div>
    </SettingsCard>
  );
}
