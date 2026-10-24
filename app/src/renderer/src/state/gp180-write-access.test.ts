import { afterEach, expect, it } from 'vitest';
import { useDevice } from './device';
afterEach(async () => { await useDevice.getState().disconnect(); });
it.each(['gp150', 'gp180'] as const)('allows %s USB writes and selection without an unlock', async model => {
  await useDevice.getState().connect('mock', { mockDevice: model });
  useDevice.setState({ mode: 'webmidi' });
  const preset = useDevice.getState().preset!.prst;
  await useDevice.getState().writePreset(1, preset);
  expect(useDevice.getState().slot).toBe(1);
  await useDevice.getState().selectSlot(2);
  expect(useDevice.getState().slot).toBe(2);
});
