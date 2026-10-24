import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Gp180Inspection } from './Gp180Inspection';
const data = vi.hoisted(() => ({ device: 'gp200', mode: 'webmidi', status: 'connected', preset: null, busy: null }));
vi.mock('@/state/device', () => ({ useDevice: (select: (s: unknown) => unknown) => select(data) }));
afterEach(cleanup);
it('shows inspection only for GP-180 connections', () => {
  const view = render(<Gp180Inspection />);
  expect(screen.queryByLabelText('Unlock GP-180 writes')).toBeNull();
  data.device = 'gp180'; view.rerender(<Gp180Inspection />);
  expect(screen.getByLabelText('GP-180 preset inspection')).toBeTruthy();
  expect(screen.queryByLabelText('Unlock GP-180 writes')).toBeNull();
});
