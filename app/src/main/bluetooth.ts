import { dialog, type BrowserWindow } from 'electron';

/** A user-selected device, never the first advertisement. Electron supplies no built-in BLE chooser. */
export function installBluetoothChooser(window: BrowserWindow): void {
  let pending: ((id: string) => void) | null = null;
  let collect: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let showing = false;
  const devices = new Map<string, string>();
  const finish = (id: string) => {
    const callback = pending; pending = null;
    clearTimeout(collect); clearTimeout(deadline); collect = undefined; deadline = undefined;
    devices.clear(); callback?.(id);
  };
  window.webContents.on('select-bluetooth-device', (event, found, callback) => {
    event.preventDefault();
    if (!pending) {
      if (showing) { callback(''); return; }
      pending = callback;
      deadline = setTimeout(() => finish(''), 30000);
    }
    for (const d of found) devices.set(d.deviceId, d.deviceName || 'Unnamed MIDI device');
    if (!devices.size || collect || showing) return;
    collect = setTimeout(() => {
      collect = undefined;
      if (!pending || window.isDestroyed()) return finish('');
      // Freeze this selection while the dialog is visible; subsequent scan events must not change button indexes.
      const choices = [...devices].slice(0, 12);
      const request = pending;
      showing = true;
      // The scan deadline must not cancel a request while the user reads the chooser.
      clearTimeout(deadline); deadline = undefined;
      void dialog.showMessageBox(window, {
        type: 'question', title: 'Connect Bluetooth MIDI',
        message: 'Choose your Bluetooth MIDI device',
        detail: 'Choose a MIDI device or your GP-150 / GP-180. The app checks for the standard Bluetooth MIDI service before sending anything. Valeton’s app connection may use a separate service. Cancel and retry after enabling Bluetooth and closing other MIDI apps.',
        buttons: ['Cancel', ...choices.map(([id, name]) => `${name} (${id})`)], defaultId: 0, cancelId: 0, noLink: true,
      }).then(({ response }) => { if (pending === request) finish(response > 0 ? choices[response - 1]?.[0] ?? '' : ''); })
        .catch(() => { if (pending === request) finish(''); })
        .finally(() => { showing = false; });
    }, 1500);
  });
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) finish(''); });
  window.on('closed', () => finish(''));
}
