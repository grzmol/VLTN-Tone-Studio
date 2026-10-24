import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PerformanceReader } from './PerformanceReader';

afterEach(cleanup);
it('follows playback and backward seeks, transposes chords, and can stop following', () => {
  const scroll = vi.fn(); HTMLElement.prototype.scrollTo = scroll;
  const props = { title: 'Song', chart: '[00:01] [C] First\n[00:05] [G] Second', lyrics: '', chords: [], shift: 2 };
  const view = render(<PerformanceReader {...props} time={1} />);
  expect(screen.getByText('First').parentElement?.getAttribute('aria-current')).toBe('true');
  expect(within(screen.getAllByLabelText('Chords')[0]).getByText('D')).toBeTruthy();
  view.rerender(<PerformanceReader {...props} time={6} />);
  expect(screen.getByText('Second').parentElement?.getAttribute('aria-current')).toBe('true');
  view.rerender(<PerformanceReader {...props} time={1} />);
  expect(screen.getByText('First').parentElement?.getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByLabelText('Follow playback')); scroll.mockClear();
  view.rerender(<PerformanceReader {...props} time={6} />);
  expect(scroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Expand performance view'));
  expect(screen.getByText('Close expanded view')).toBeTruthy();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.getByText('Expand performance view')).toBeTruthy();
});

it('opens transposed chord tabs and closes the overlay without closing the expanded reader', () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  render(<PerformanceReader title="Song" chart="[00:00] [C]Words" lyrics="" chords={[]} shift={2} time={0} />);
  fireEvent.click(screen.getByText('Expand performance view'));
  fireEvent.click(screen.getByRole('button', { name: 'Show D guitar voicings' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByText('D · Guitar voicings')).toBeTruthy();
  expect(screen.getByLabelText('D position 1 tablature').textContent).toContain('e|--');
  fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('Close expanded view')).toBeTruthy();
});

it('edits displayed lyrics and chords with MIDI preserved, validates values, and supports cancel', () => {
  const save=vi.fn(), pause=vi.fn();
  render(<PerformanceReader title="Song" chart="[00:01] [C]Words {midi:pc 2 12}" lyrics="" chords={[]} shift={2} time={1} onEditStart={pause} onSaveChart={save} />);
  fireEvent.click(screen.getByText('Edit chords, lyrics & MIDI'));
  expect(pause).toHaveBeenCalledOnce();
  expect((screen.getByLabelText('Line 1 chords') as HTMLInputElement).value).toBe('C');
  fireEvent.change(screen.getByLabelText('Line 1 lyrics'), {target:{value:'Correct words'}});
  fireEvent.change(screen.getByLabelText('Line 1 chords'), {target:{value:'Am'}});
  fireEvent.change(screen.getByLabelText('Line 1 MIDI'), {target:{value:'pc 17 12'}});
  fireEvent.click(screen.getByText('Save performance edits'));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Invalid MIDI');
  fireEvent.change(screen.getByLabelText('Line 1 MIDI'), {target:{value:'pc 2 14'}});
  fireEvent.click(screen.getByText('Save performance edits'));
  expect(save).toHaveBeenCalledWith('[00:01.00] [Am] Correct words {midi:pc 2 14}');
  fireEvent.click(screen.getByText('Edit chords, lyrics & MIDI'));
  fireEvent.change(screen.getByLabelText('Line 1 lyrics'), {target:{value:'Discard'}});
  fireEvent.click(screen.getByText('Cancel edits'));
  expect(save).toHaveBeenCalledTimes(1);
});

it('shows untimed chord symbols as playable transposed chords',()=>{
  render(<PerformanceReader title="Demo" chart={"[Am] Open road [F]\n[C] New day"} lyrics="" chords={[]} time={0} shift={2}/>);
  expect(screen.getByLabelText('Show Bm guitar voicings')).toBeTruthy();
  expect(screen.getByLabelText('Show G guitar voicings')).toBeTruthy();
  expect(screen.getByLabelText('Show D guitar voicings')).toBeTruthy();
  expect(screen.getByText('Open road')).toBeTruthy();
});
