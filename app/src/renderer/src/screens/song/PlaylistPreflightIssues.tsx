import type { PlaylistCheck } from "@/song/performance/playlist-preflight";

/** Put every entry's errors before advisory performance warnings, without reordering the playlist. */
export function PlaylistPreflightIssues({ report }: { report: readonly PlaylistCheck[] }) {
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
            </li>
          ))}
        </ul>
      ) : (
        <p>No static playback or MIDI issues found. Arrangement advice is listed separately below.</p>
      )}
    </section>
  );
}
