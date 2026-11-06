import { useState } from "react";
import { Button } from "@/components/ui/button";
import { lrcTime } from "@/song/performance/chart";
import { removeMacro, useMidiConfiguration } from "@/song/performance/midi-configuration";
import { expandCommand, macroProblems } from "@/song/performance/midi-macros";

/** The saved macros: insert one into the song at a time, send it now, or remove it. Macros are shared by every song. */
export function MacroPanel({
  time,
  onAdd,
  onTest,
  canTest,
}: {
  time: number;
  onAdd: (line: string) => void;
  onTest: (bytes: number[]) => void;
  canTest: boolean;
}) {
  const macros = useMidiConfiguration((s) => s.macros);
  const [code, setCode] = useState(""),
    [error, setError] = useState("");
  const problems = macroProblems(macros);
  const chosen = macros.find((macro) => macro.code === code) ?? macros[0];
  const run = (action: () => void) => {
    try {
      action();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (!macros.length)
    return <p className="text-sm text-silkscreen-3">No macros yet. Save a pedal command or a raw command as a macro to reuse it in any song.</p>;
  return (
    <div aria-label="MIDI macros" className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Macro{" "}
          <select aria-label="MIDI macro" className="rounded border border-seam bg-background p-2" value={chosen?.code ?? ""} onChange={(e) => setCode(e.target.value)}>
            {macros.map((macro) => (
              <option key={macro.code} value={macro.code}>
                {macro.label} ($${macro.code})
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!chosen} onClick={() => chosen && run(() => onAdd(`${lrcTime(time)} {midi:$${chosen.code}}`))}>
          Add macro cue
        </Button>
        <Button
          variant="outline"
          disabled={!chosen || !canTest}
          onClick={() => chosen && run(() => expandCommand(`$${chosen.code}`, macros).forEach(onTest))}
        >
          Send macro now
        </Button>
        <Button variant="outline" disabled={!chosen} onClick={() => chosen && run(() => removeMacro(chosen.code))}>
          Remove macro
        </Button>
      </div>
      {chosen && <p className="font-mono text-xs text-silkscreen-3">{chosen.commands.join(" → ")}</p>}
      {problems.length > 0 && (
        <ul role="alert" className="text-red-400">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
