import { useState } from "react";
import { host } from "@/host";
import { Button } from "@/components/ui/button";
import type { PlaylistCheck } from "@/song/performance/playlist-preflight";
import { missingToneWarning, type MissingToneFile } from "@/song/band/tone-check";

/** A button that downloads one missing TONE3000 file, then asks for the playlist to be checked again. */
function DownloadTone({ missing, onDownloaded }: { missing: MissingToneFile; onDownloaded: () => void }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const { toneId, modelId } = missing.file;
  if (toneId === undefined || modelId === undefined) return null;
  const download = async () => {
    setState("busy");
    try {
      await host.tones.downloadModel(toneId, modelId);
      onDownloaded();
    } catch {
      setState("failed");
    }
  };
  return (
    <Button variant="outline" size="sm" className="ml-2" disabled={state === "busy"} onClick={() => void download()}>
      {state === "busy" ? "Downloading…" : state === "failed" ? "Download failed, try again" : `Download ${missing.file.name}`}
    </Button>
  );
}

/** Put every entry's errors before advisory performance warnings, without reordering the playlist. */
export function PlaylistPreflightIssues({ report, onDownloaded }: { report: readonly PlaylistCheck[]; onDownloaded?: () => void }) {
  const issues = (["errors", "warnings"] as const).flatMap((kind) => report.flatMap((entry) => entry[kind].map((text) => ({ entry, kind, text }))));
  return (
    <section aria-label="Playback and MIDI issues" className="space-y-2 rounded border border-seam p-3">
      <h3 className="font-medium">Playback and MIDI issues</h3>
      {issues.length ? (
        <ul className="max-h-64 list-disc overflow-auto pl-5">
          {issues.map(({ entry, kind, text }, index) => (
            <li key={index} className={kind === "errors" ? "text-red-400" : undefined}>
              <strong>
                {kind === "errors" ? "Error" : "Warning"} · {entry.entry}. {entry.title}:
              </strong>{" "}
              {text}
              {onDownloaded &&
                kind === "warnings" &&
                entry.missingTones
                  ?.filter((missing) => missing.file.source === "tone3000" && text === missingToneWarning(missing))
                  .map((missing) => <DownloadTone key={`${missing.part}-${missing.role}`} missing={missing} onDownloaded={onDownloaded} />)}
            </li>
          ))}
        </ul>
      ) : (
        <p>No static playback or MIDI issues found. Arrangement advice is listed separately below.</p>
      )}
    </section>
  );
}
