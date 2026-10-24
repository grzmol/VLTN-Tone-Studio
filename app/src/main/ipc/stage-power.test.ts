// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {StagePower} from './stage-power';
afterEach(()=>vi.useRealTimers());
it('keeps a single blocker while leases renew and ignores old session release',()=>{
 vi.useFakeTimers();const power={start:vi.fn(()=>7),stop:vi.fn()};const lease=new StagePower(power);
 lease.update(1,'old',true);lease.update(1,'new',true);lease.update(1,'old',false);
 expect(power.start).toHaveBeenCalledTimes(1);expect(power.stop).not.toHaveBeenCalled();
 vi.advanceTimersByTime(10000);lease.update(1,'new',true);vi.advanceTimersByTime(10000);
 expect(power.stop).not.toHaveBeenCalled();lease.release(1);expect(power.stop).toHaveBeenCalledWith(7);expect(vi.getTimerCount()).toBe(0);
});
it('expires abandoned renderer leases and stops on shutdown',()=>{
 vi.useFakeTimers();const power={start:vi.fn(()=>3),stop:vi.fn()};const lease=new StagePower(power);
 lease.update(1,'session',true);vi.advanceTimersByTime(15000);expect(power.stop).toHaveBeenCalledWith(3);expect(vi.getTimerCount()).toBe(0);
 lease.update(1,'next',true);lease.close();expect(power.stop).toHaveBeenCalledTimes(2);
});
