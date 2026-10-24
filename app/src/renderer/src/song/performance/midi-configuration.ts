import { create } from 'zustand';

export const MIDI_CONFIG_KEY = 'vltn.performance.midi.v1';
export interface PortChoice { id: string; name: string; transport: 'bluetooth' | 'system' }
export interface MidiConfiguration {
  preset: string; output: PortChoice | null; input: PortChoice | null;
  tempoOnStart: boolean; tempoChannel: number; showCommands: boolean;
  pedal: string; commands: Record<string, { action: string; value: number }>;
}
const defaults: MidiConfiguration = { preset: 'cues', output: null, input: null, tempoOnStart: false, tempoChannel: 16, showCommands: true, pedal: '', commands: {} };
export function readMidiConfiguration(): MidiConfiguration {
  try {
    const data = JSON.parse(localStorage.getItem(MIDI_CONFIG_KEY) || '{}');
    const port = (p: PortChoice | null) => p && typeof p.id === 'string' && typeof p.name === 'string' && ['bluetooth','system'].includes(p.transport) ? p : null;
    return { ...defaults, preset: typeof data.preset === 'string' ? data.preset : defaults.preset,
      output: port(data.output), input: port(data.input), tempoOnStart: data.tempoOnStart === true,
      tempoChannel: Number.isInteger(data.tempoChannel) && data.tempoChannel >= 1 && data.tempoChannel <= 16 ? data.tempoChannel : 16,
      showCommands: data.showCommands !== false, pedal: typeof data.pedal === 'string' ? data.pedal : '',
      commands: Object.fromEntries(Object.entries(data.commands || {}).filter(([,v]) => v && typeof v === 'object' && typeof (v as {action?:unknown}).action === 'string' && Number.isFinite((v as {value?:number}).value))) as MidiConfiguration['commands'],
    };
  } catch { return { ...defaults }; }
}
export const useMidiConfiguration = create<MidiConfiguration & { update: (patch: Partial<MidiConfiguration>) => void }>((set, get) => ({
  ...readMidiConfiguration(),
  update(patch) {
    const { update: _update, ...data } = { ...get(), ...patch };
    localStorage.setItem(MIDI_CONFIG_KEY, JSON.stringify(data)); set(patch);
  },
}));
export const MIDI_SETUP_PRESETS = [
  { id: 'gp180-bluetooth', name: 'GP-150 / GP-180 + pedals · Bluetooth', transport: 'bluetooth', clock: false, tempo: true, description: 'Connect Bluetooth MIDI manually. GP-150 / GP-180: MIDI In Mixed/BT, clock Internal, TRS clock output On. Sends song BPM once to GP-150 / GP-180; the pedal clocks downstream pedals.' },
  { id: 'gp180-usb', name: 'GP-150 / GP-180 + pedals · USB', transport: 'system', clock: false, tempo: true, description: 'Enable USB MIDI and select your GP-150 or GP-180. GP-150 / GP-180: MIDI In Mixed/USB, clock Internal, TRS clock output On. Sends song BPM once; continuous app clock stays off.' },
  { id: 'cues', name: 'MIDI commands only', transport: 'system', clock: false, tempo: false, description: 'Send saved song commands without automatic tempo or continuous clock. Select each pedal’s receive channel in the command builder.' },
  { id: 'clock', name: 'Continuous clock · compatible receiver', transport: 'system', clock: true, tempo: false, description: 'Receiver must accept external MIDI clock. Continuous clock failed the GP-180/TimeLine hardware test; use one-time GP-180 tempo for that rig.' },
] as const;
export function rememberedPort<T extends {id: string; name?: string | null; state: string}>(ports: T[], choice: PortChoice | null): T | undefined {
  if (!choice) return;
  const connected=ports.filter(p=>p.state === 'connected');
  const exact=connected.find(p=>p.id === choice.id); if(exact) return exact;
  const named=connected.filter(p=>p.name === choice.name);
  return named.length === 1 ? named[0] : undefined;
}
