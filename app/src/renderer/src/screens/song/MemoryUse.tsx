import { useEffect, useState } from "react";
import { host } from "@/host";
import type { MemoryReading } from "@shared/host/app";
import { currentFootprint } from "@/song/audio/memory-usage";
import { memoryLines, type Footprint } from "@/song/audio/memory-estimate";

const REFRESH_MS = 5000;

/** What the app and the open song's audio use, refreshed while MIDI health is open. */
export function MemoryUse() {
  const [reading, setReading] = useState<{ memory: MemoryReading | null; footprint: Footprint } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => {
      const footprint = currentFootprint();
      host.app.memory().then(
        (memory) => alive && setReading({ memory, footprint }),
        () => alive && setReading({ memory: null, footprint }),
      );
    };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!reading) return null;
  const { text, warning } = memoryLines(reading.memory, reading.footprint);
  return (
    <section aria-label="Memory" className="space-y-1">
      <h3 className="font-medium">Memory</h3>
      <p>{text}</p>
      {warning && <p className="text-amber-400">{warning}</p>}
    </section>
  );
}
