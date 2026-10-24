// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const dialog = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
vi.mock('electron', () => ({ dialog }));
import { installBluetoothChooser } from './bluetooth';
import type { BrowserWindow } from 'electron';
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
it('keeps selection alive beyond the scan deadline and freezes the device list', async () => {
  vi.useFakeTimers();
  let choose!: (value: { response: number }) => void;
  dialog.showMessageBox.mockImplementation(() => new Promise(resolve => { choose = resolve; }));
  const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), isDestroyed: () => false });
  installBluetoothChooser(window as unknown as BrowserWindow);
  const callback = vi.fn(), event = { preventDefault: vi.fn() };
  window.webContents.emit('select-bluetooth-device', event, [{ deviceId: 'pedal', deviceName: 'GP-180 BLE' }], callback);
  await vi.advanceTimersByTimeAsync(1500);
  window.webContents.emit('select-bluetooth-device', event, [{ deviceId: 'other', deviceName: 'Other MIDI' }], callback);
  await vi.advanceTimersByTimeAsync(60000);
  expect(callback).not.toHaveBeenCalled();
  choose({ response: 1 });
  await vi.advanceTimersByTimeAsync(0);
  expect(callback).toHaveBeenCalledExactlyOnceWith('pedal');
});
it('ends a scan with no devices and cancels an outstanding choice on close', async () => {
  vi.useFakeTimers();
  dialog.showMessageBox.mockImplementation(() => new Promise(() => {}));
  const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), isDestroyed: () => false });
  installBluetoothChooser(window as unknown as BrowserWindow);
  const callback = vi.fn(), event = { preventDefault: vi.fn() };
  window.webContents.emit('select-bluetooth-device', event, [], callback);
  await vi.advanceTimersByTimeAsync(30000);
  expect(callback).toHaveBeenCalledExactlyOnceWith('');
  const second = vi.fn();
  window.webContents.emit('select-bluetooth-device', event, [{ deviceId: 'pedal', deviceName: 'GP-180 BLE' }], second);
  await vi.advanceTimersByTimeAsync(1500);
  window.emit('closed');
  expect(second).toHaveBeenCalledExactlyOnceWith('');
});
