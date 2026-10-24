import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {PlaylistPreflight} from './PlaylistPreflight';
const api=vi.hoisted(()=>({preflight:vi.fn()}));
vi.mock('@/host',()=>({host:{song:{library:api}}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('shows results for every entry without loading or playing songs',async()=>{
 api.preflight.mockResolvedValue([{id:'missing',errors:['Song is missing from the library.']}]);
 render(<PlaylistPreflight ids={['missing','missing']} disabled={false} revision={1}/>);
 fireEvent.click(screen.getByText('Check playlist'));
 await waitFor(()=>expect(screen.getByText('2 entries checked · 2 errors · 0 warnings')).toBeTruthy());
 expect(screen.getAllByText(/Error: Song is missing/)).toHaveLength(2);
 expect(api.preflight).toHaveBeenCalledWith(['missing','missing']);
});
it('ignores a late result when the playlist changes and reports request failures',async()=>{
 let finish!:(value:unknown)=>void;api.preflight.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(<PlaylistPreflight ids={['old']} disabled={false} revision={1}/>);
 fireEvent.click(screen.getByText('Check playlist'));
 view.rerender(<PlaylistPreflight ids={['new']} disabled={false} revision={2}/>);
 await act(async()=>{finish([{id:'old',errors:['Old failure']}]);});
 expect(screen.queryByText(/Old failure/)).toBeNull();
 api.preflight.mockRejectedValueOnce(new Error('Disk unavailable'));
 fireEvent.click(screen.getByText('Check playlist'));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('Disk unavailable'));
});
