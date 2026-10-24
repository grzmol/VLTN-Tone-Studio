import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PedalMidiPicker } from './PedalMidiPicker';
import { usePedalLibrary } from '@/song/performance/pedal-library';
import { readMidiConfiguration, useMidiConfiguration } from '@/song/performance/midi-configuration';
import { parseChart } from '@/song/performance/chart';
afterEach(()=>{cleanup();localStorage.clear();useMidiConfiguration.setState(readMidiConfiguration());usePedalLibrary.setState({profiles:[],channels:{},assignments:{}});});

it('adds a clearly labelled, banked preset and sends the identical sequence on the target channel',()=>{
  const add=vi.fn(),send=vi.fn();render(<PedalMidiPicker time={8} onAdd={add} onTest={send} canTest />);
  fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:'valeton-gp180'}});
  fireEvent.change(screen.getByLabelText('Pedal MIDI channel'),{target:{value:'3'}});
  fireEvent.change(screen.getByLabelText('Pedal command preset'),{target:{value:'memory-129'}});
  fireEvent.click(screen.getByText('Add pedal command'));
  expect(parseChart(add.mock.calls[0][0])[0]).toMatchObject({time:8,label:'Valeton GP-180: Recall memory 129 (ch 3)',messages:[[0xb2,0,1],[0xc2,0]]});
  fireEvent.click(screen.getByText('Send pedal command now'));
  expect(send.mock.calls.map(c=>c[0])).toEqual([[0xb2,0,1],[0xc2,0]]);
  expect(usePedalLibrary.getState().channels['valeton-gp180']).toBe(3);
});
it('requires an explicit assigned CC and saves it for later use',()=>{
  const add=vi.fn();render(<PedalMidiPicker time={0} onAdd={add} onTest={vi.fn()} canTest={false} />);
  fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:'boss-rc10r'}});
  fireEvent.change(screen.getByLabelText('Pedal command preset'),{target:{value:'loop-stop'}});
  fireEvent.click(screen.getByText('Add pedal command'));expect(add).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Assigned pedal CC'),{target:{value:'20'}});
  fireEvent.click(screen.getByText('Add pedal command'));expect(add).toHaveBeenCalledTimes(1);
  expect(usePedalLibrary.getState().assignments['boss-rc10r:loop-stop']).toBe(20);
});
it('saves a custom definition through the editor without sending anything',()=>{
  const send=vi.fn();render(<PedalMidiPicker time={0} onAdd={vi.fn()} onTest={send} canTest />);
  fireEvent.click(screen.getByText('Save custom pedal'));
  expect((screen.getByLabelText('MIDI pedal') as HTMLSelectElement).value).toBe('my-midi-pedal');
  expect(usePedalLibrary.getState().profiles).toHaveLength(1);expect(send).not.toHaveBeenCalled();
});
it('creates and labels a custom pedal without writing JSON or sending MIDI',()=>{
  const send=vi.fn(),add=vi.fn();render(<PedalMidiPicker time={2} onAdd={add} onTest={send} canTest />);
  fireEvent.change(screen.getByLabelText('Custom pedal name'),{target:{value:'My Chorus'}});
  fireEvent.change(screen.getByLabelText('Custom command label'),{target:{value:'Enable chorus'}});
  fireEvent.change(screen.getByLabelText('Custom command reference'),{target:{value:'My manual p. 8'}});
  fireEvent.change(screen.getByLabelText('Custom command type'),{target:{value:'cc'}});
  fireEvent.change(screen.getByLabelText('Custom command number'),{target:{value:'20'}});
  fireEvent.click(screen.getByText('Save named custom command'));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Add pedal command'));
  expect(parseChart(add.mock.calls[0][0])[0]).toMatchObject({label:'My Chorus: Enable chorus (ch 1)',messages:[[0xb0,20,127]]});
});

it('restores the chosen pedal, command and assigned CC after reopening the builder',()=>{
  const props={time:0,onAdd:vi.fn(),onTest:vi.fn(),canTest:false};
  const view=render(<PedalMidiPicker {...props} />);
  fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:'boss-rc10r'}});
  fireEvent.change(screen.getByLabelText('Pedal MIDI channel'),{target:{value:'4'}});
  fireEvent.change(screen.getByLabelText('Pedal command preset'),{target:{value:'loop-stop'}});
  fireEvent.change(screen.getByLabelText('Assigned pedal CC'),{target:{value:'20'}});
  view.unmount();
  useMidiConfiguration.setState(readMidiConfiguration());
  render(<PedalMidiPicker {...props} />);
  expect((screen.getByLabelText('MIDI pedal') as HTMLInputElement).value).toBe('boss-rc10r');
  expect((screen.getByLabelText('Pedal command preset') as HTMLInputElement).value).toBe('loop-stop');
  expect((screen.getByLabelText('Assigned pedal CC') as HTMLInputElement).value).toBe('20');
  expect((screen.getByLabelText('Pedal MIDI channel') as HTMLInputElement).value).toBe('4');
  fireEvent.click(screen.getByText('Add pedal command'));
  expect(parseChart(props.onAdd.mock.calls[0][0])[0].messages[0][0]).toBe(0xb3);
});

it('uses the rig default channels while preserving saved overrides',()=>{
  render(<PedalMidiPicker time={0} onAdd={vi.fn()} onTest={vi.fn()} canTest={false} />);
  for(const [pedal,channel] of [['strymon-timeline','1'],['boss-rc10r','2'],['boss-ir200','3'],['boss-sy200','4']]) {
    fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:pedal}});
    expect((screen.getByLabelText('Pedal MIDI channel') as HTMLSelectElement).value).toBe(channel);
  }
  fireEvent.change(screen.getByLabelText('Pedal MIDI channel'),{target:{value:'9'}});
  fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:'strymon-timeline'}});
  fireEvent.change(screen.getByLabelText('MIDI pedal'),{target:{value:'boss-sy200'}});
  expect((screen.getByLabelText('Pedal MIDI channel') as HTMLSelectElement).value).toBe('9');
});
