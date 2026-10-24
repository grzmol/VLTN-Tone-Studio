import { Button } from '@/components/ui/button';
import { connectBluetooth, useBluetooth, type BleMidiConnection } from './connection';

export function BluetoothControls({ editor = false, onConnected }: { editor?: boolean; onConnected?: (connection: BleMidiConnection) => void }) {
  const { connection, connecting, error, diagnostics } = useBluetooth();
  return <div className="flex max-w-xl flex-col gap-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      {!connection ? <Button variant="outline" disabled={connecting} onClick={() => void connectBluetooth().then(connection => onConnected?.(connection)).catch(() => {})}>{connecting ? 'Selecting Bluetooth device…' : 'Connect Bluetooth MIDI'}</Button> : <>
        <span>Bluetooth: {connection.name}</span>
        <Button variant="outline" onClick={() => connection.close()}>Disconnect Bluetooth</Button>
      </>}
    </div>
    {editor && <p className="text-silkscreen-3">Bluetooth MIDI is available for performance controls. Connect by USB to manage and edit the pedal; Bluetooth editor management is disabled.</p>}
    {diagnostics?.clockTiming && <details className="text-silkscreen-3"><summary>Bluetooth clock timing</summary><p>{diagnostics.clockTiming.pulses} pulses · maximum dispatch delay {diagnostics.clockTiming.maxLateMs.toFixed(1)} ms · maximum write {diagnostics.clockTiming.maxWriteMs.toFixed(1)} ms · write intervals {diagnostics.clockTiming.minIntervalMs.toFixed(1)}–{diagnostics.clockTiming.maxIntervalMs.toFixed(1)} ms</p></details>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </div>;
}
