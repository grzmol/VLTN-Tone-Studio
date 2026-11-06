import { Button } from "@/components/ui/button";
import { connectBluetooth, stopBluetoothReconnect, useBluetooth, type BleMidiConnection } from "./connection";

export function BluetoothControls({ editor = false, onConnected }: { editor?: boolean; onConnected?: (connection: BleMidiConnection) => void }) {
  const { connection, connecting, error, diagnostics, reconnect } = useBluetooth();
  return (
    <div className="flex max-w-xl flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {!connection && reconnect ? (
          <>
            <span role="status">Reconnecting… (attempt {reconnect.attempt})</span>
            <Button variant="outline" onClick={() => stopBluetoothReconnect()}>
              Stop reconnecting
            </Button>
          </>
        ) : !connection ? (
          <Button
            variant="outline"
            disabled={connecting}
            onClick={() =>
              void connectBluetooth()
                .then((connection) => onConnected?.(connection))
                .catch(() => {})
            }
          >
            {connecting ? "Selecting Bluetooth device…" : "Connect Bluetooth MIDI"}
          </Button>
        ) : (
          <>
            <span>Bluetooth: {connection.name}</span>
            <Button variant="outline" onClick={() => connection.close()}>
              Disconnect Bluetooth
            </Button>
          </>
        )}
      </div>
      {editor && (
        <p className="text-silkscreen-3">
          Connect by USB to read, edit and write the pedal. The GP-180 did not answer the editor handshake over Bluetooth, so editing over Bluetooth is off.
        </p>
      )}
      {diagnostics && diagnostics.reconnects > 0 && (
        <p className="text-silkscreen-3">
          {diagnostics.reconnects} automatic reconnect{diagnostics.reconnects === 1 ? "" : "s"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
