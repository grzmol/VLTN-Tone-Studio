import type { PreparationCommand } from "@/song/performance/preparation-repeat";
import type { PreparationSequence } from "@/song/performance/preparation-sequence";

export const preparationSeconds = (ms: number) => Number((ms / 1000).toFixed(3)).toString();
function message(bytes: number[]): string {
  const kind = bytes[0] & 240,
    channel = (bytes[0] & 15) + 1;
  if (kind === 192) return `Ch ${channel} · PC ${bytes[1]}`;
  if (kind === 176) return `Ch ${channel} · CC ${bytes[1]}=${bytes[2]}`;
  return bytes.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function commandDetails(commands: PreparationCommand[], tempo: boolean): string {
  const bytes = commands.map((command) => command.bytes);
  const bpm = tempo && bytes.length === 2 && bytes[0][1] === 73 && bytes[1][1] === 74 ? `${bytes[0][2] * 128 + bytes[1][2]} BPM · ` : "";
  return bpm + bytes.map(message).join(" → ");
}
const originLabel = { automatic: "Automatic", custom: "Your command", tempo: "Automatic tempo" };

/** Shared song and playlist view of the sender's plan. Rendering this table has no MIDI side effects. */
export function PreparationSequenceDetails({
  plan,
  activeStep,
  label = "Preparation steps",
}: {
  plan: PreparationSequence;
  activeStep?: number;
  label?: string;
}) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left" aria-label={label}>
          <thead>
            <tr>
              <th className="p-2">At</th>
              <th className="p-2">Step</th>
              <th className="p-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((step, index) => (
              <tr key={index} className="border-t border-seam" aria-current={activeStep === index ? "step" : undefined}>
                <td className="p-2 tabular-nums">{preparationSeconds(step.atMs)} s</td>
                <td className="p-2">
                  {step.label}
                  {step.kind === "send" && <span className="ml-1 text-xs text-silkscreen-3">({originLabel[step.origin]})</span>}
                </td>
                <td className="p-2">
                  {step.kind === "wait" ? `${preparationSeconds(step.durationMs)} s` : commandDetails(step.commands, step.origin === "tempo")}
                </td>
              </tr>
            ))}
            <tr className="border-t border-seam">
              <td className="p-2">{preparationSeconds(plan.totalWaitMs)} s</td>
              <td className="p-2">Ready</td>
              <td className="p-2">Play starts the count-in and song.</td>
            </tr>
          </tbody>
        </table>
      </div>
      {plan.skipped.length > 0 && (
        <ul className="list-disc pl-5">
          {plan.skipped.map((step, index) => (
            <li key={index}>
              {step.label}: {step.reason}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
