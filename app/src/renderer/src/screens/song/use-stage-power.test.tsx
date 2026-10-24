import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useStagePower} from './use-stage-power';
const api=vi.hoisted(()=>({stagePower:vi.fn(async(_token:string,_enabled:boolean)=>{})}));
vi.mock('@/host',()=>({host:{song:api}}));
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers();});
it('renews only during active playback and releases on pause or unmount',async()=>{
 vi.useFakeTimers();const view=renderHook(({active})=>useStagePower(active),{initialProps:{active:false}});
 expect(api.stagePower).not.toHaveBeenCalled();
 await act(async()=>{view.rerender({active:true});});const token=api.stagePower.mock.calls[0][0];
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(api.stagePower).toHaveBeenCalledTimes(2);
 view.rerender({active:false});expect(api.stagePower).toHaveBeenLastCalledWith(token,false);
 await act(async()=>{view.rerender({active:true});});view.unmount();expect(api.stagePower.mock.calls.at(-1)?.[1]).toBe(false);
});
it('surfaces failed sleep prevention without stopping playback',async()=>{
 api.stagePower.mockRejectedValueOnce(new Error('Power error'));const view=renderHook(()=>useStagePower(true));
 await act(async()=>{});expect(view.result.current).toContain('Could not prevent sleep');
});
