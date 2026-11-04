import { SettingsCard } from "@/components/ui/settings-card";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ACTION_IDS, ACTIONS, actionLabel, type ActionId } from "@/song/performance/actions";
import { defaultBindings, describeBinding, startLearn, stopLearn, useRemoteLearn, type Binding } from "@/song/performance/bindings";
import { useMidiConfiguration } from "@/song/performance/midi-configuration";

const GROUPS = [...new Set(ACTION_IDS.map((id) => ACTIONS[id].group))];

/** The number a numbered action is learned with. Clamped to the action's range, so a bad field never stores a bad binding. */
function clampNumber(action: ActionId, value: number): number {
  const number = ACTIONS[action].number;
  if (!number) return 0;
  if (!Number.isFinite(value)) return number.min;
  return Math.min(number.max, Math.max(number.min, Math.round(value)));
}

/** The Learn state as a line for the performer: what is being learned, what was last seen, and what was decided last. */
export function LearnStatus() {
  const learn = useRemoteLearn();
  const target = learn.target;
  if (target) {
    const what = target.source === "song" ? "a song's trigger" : actionLabel(target.action, target.index);
    const press =
      target.source === "song"
        ? "Press a program change or Song Select on the selected MIDI input."
        : target.source === "midi"
          ? "Press the pedal or controller on the selected MIDI input."
          : "Press the key.";
    return (
      <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-seam p-3 text-[13px]">
        <span>
          Learning {what}. {press}
        </span>
        <span className="text-silkscreen-2 tabular-nums">{learn.seen ? `Last message: ${learn.seen}` : "Waiting for a message."}</span>
        <Button variant="outline" size="sm" onClick={() => stopLearn()}>
          Cancel
        </Button>
      </div>
    );
  }
  return learn.result ? (
    <p role="status" className="text-[13px] text-silkscreen-2">
      {learn.result}
    </p>
  ) : null;
}

interface RowProps {
  action: ActionId;
  bindings: { binding: Binding; index: number }[];
  inputReady: boolean;
  number: number;
  onNumber(value: number): void;
  onLearn(source: "midi" | "key"): void;
  onChange(index: number, binding: Binding): void;
  onRemove(index: number): void;
}

function ActionRow({ action, bindings, inputReady, number, onNumber, onLearn, onChange, onRemove }: RowProps) {
  const def = ACTIONS[action];
  return (
    <li className="flex flex-col gap-2 border-t border-seam py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-40 text-[13px]">{def.label}</span>
        {def.number && (
          <Input
            type="number"
            aria-label={`${def.number.noun} for ${def.label}`}
            min={def.number.min}
            max={def.number.max}
            value={number}
            className="w-20"
            onChange={(e) => onNumber(clampNumber(action, Number(e.target.value)))}
          />
        )}
        <Button variant="outline" size="sm" disabled={!inputReady} onClick={() => onLearn("midi")}>
          Learn MIDI
        </Button>
        <Button variant="outline" size="sm" onClick={() => onLearn("key")}>
          Learn key
        </Button>
      </div>
      {bindings.length > 0 && (
        <ul className="flex flex-col gap-1 pl-2 text-[12px] text-silkscreen-2">
          {bindings.map(({ binding, index }) => {
            const what = describeBinding(binding);
            return (
              <li key={index} className="flex flex-wrap items-center gap-3">
                <span className="tabular-nums">{what}</span>
                <label className="flex items-center gap-1.5">
                  <Checkbox
                    aria-label={`Double press for ${what}`}
                    checked={!!binding.doublePress}
                    onCheckedChange={(checked) => onChange(index, { ...binding, doublePress: checked === true ? true : undefined })}
                  />
                  Double press
                </label>
                <Button variant="ghost" size="sm" aria-label={`Remove ${what}`} onClick={() => onRemove(index)}>
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * The remote bindings: each action with its MIDI and key bindings, Learn for each, and the double-press option. The list is saved with
 * the MIDI configuration. `inputReady` says whether a MIDI input is selected, since MIDI Learn listens on that input.
 */
export function RemoteControlSettings({ inputReady }: { inputReady: boolean }) {
  const bindings = useMidiConfiguration((s) => s.bindings);
  const [open, setOpen] = useState(false);
  const [numbers, setNumbers] = useState<Partial<Record<ActionId, number>>>({});
  const save = (next: Binding[]) => useMidiConfiguration.getState().update({ bindings: next });
  const numberOf = (action: ActionId) => numbers[action] ?? ACTIONS[action].number?.min ?? 0;
  const learn = (action: ActionId, source: "midi" | "key") => {
    const index = ACTIONS[action].number ? numberOf(action) : undefined;
    startLearn({ source, action, ...(index === undefined ? {} : { index }) });
  };
  return (
    <SettingsCard
      title="Remote control"
      summary={`${bindings.length} binding${bindings.length === 1 ? "" : "s"}`}
      storageKey="remote-control"
      defaultOpen={false}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-silkscreen-3">
          {bindings.length} binding{bindings.length === 1 ? "" : "s"}. Any action can run from a MIDI message or a key, including a Bluetooth page-turner.
        </p>
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide remote control" : "Edit remote control"}
        </Button>
      </div>
      {open && (
        <RemoteControlList
          bindings={bindings}
          inputReady={inputReady}
          numberOf={numberOf}
          setNumber={(action, value) => setNumbers((current) => ({ ...current, [action]: value }))}
          learn={learn}
          save={save}
        />
      )}
    </SettingsCard>
  );
}

function RemoteControlList({
  bindings,
  inputReady,
  numberOf,
  setNumber,
  learn,
  save,
}: {
  bindings: Binding[];
  inputReady: boolean;
  numberOf(action: ActionId): number;
  setNumber(action: ActionId, value: number): void;
  learn(action: ActionId, source: "midi" | "key"): void;
  save(next: Binding[]): void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-silkscreen-3">Keys do nothing while you type in a field. Learn captures the next message or key and names any clash.</p>
        <Button variant="outline" size="sm" onClick={() => save(defaultBindings())}>
          Reset to defaults
        </Button>
      </div>
      {!inputReady && (
        <p className="text-[12px] text-silkscreen-3">Choose a MIDI input in MIDI setup to learn pedal messages. Keys can be learned at any time.</p>
      )}
      <LearnStatus />
      {GROUPS.map((group) => (
        <div key={group} className="flex flex-col">
          <h4 className="text-[11px] tracking-wide text-silkscreen-3 uppercase">{group}</h4>
          <ul className="flex flex-col">
            {ACTION_IDS.filter((id) => ACTIONS[id].group === group).map((action) => (
              <ActionRow
                key={action}
                action={action}
                bindings={bindings.flatMap((binding, index) => (binding.action === action ? [{ binding, index }] : []))}
                inputReady={inputReady}
                number={numberOf(action)}
                onNumber={(value) => setNumber(action, value)}
                onLearn={(source) => learn(action, source)}
                onChange={(index, binding) => save(bindings.map((b, i) => (i === index ? binding : b)))}
                onRemove={(index) => save(bindings.filter((_, i) => i !== index))}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
