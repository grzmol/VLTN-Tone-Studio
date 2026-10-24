import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenMidiBrowser } from './OpenMidiBrowser';
const load=vi.hoisted(()=>vi.fn());
vi.mock('@/song/performance/openmidi',async importOriginal=>({...await importOriginal<typeof import('@/song/performance/openmidi')>(),loadOpenMidi:load}));
afterEach(cleanup);
it('downloads only on request and imports the chosen community profile without MIDI output',async()=>{
  load.mockResolvedValue([{brand:'test',model:'pedal',name:'Test Pedal',data:{cc:[{name:'Enable',value:20,min:127,max:127}]}}]);
  const imported=vi.fn();render(<OpenMidiBrowser onImport={imported} />);
  expect(load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Load OpenMIDI catalogue'));
  await waitFor(()=>expect(screen.getByText('1 community devices available.')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('OpenMIDI pedal'),{target:{value:'test/pedal'}});
  fireEvent.click(screen.getByText('Import OpenMIDI pedal'));
  expect(imported).toHaveBeenCalledWith(expect.objectContaining({name:'OpenMIDI · Test Pedal',actions:[expect.objectContaining({label:'Enable',commands:['cc $channel 20 127']})]}));
});
