import { describe, expect, it } from 'vitest';
import { assertReadOnlyFrame } from '../gp150/lib/read-only.mjs';
import { CMD, ack, hello, packetize, query, readPatch, setParam, setBlockOn } from '../gp150/lib/protocol.mjs';
describe('Historical GP-180 read-only log audit', () => {
  it('allows only known queries and acknowledgements', () => {
    for (const bytes of [hello(), ack(1), ...packetize(query(CMD.STATE), 1), ...packetize(query(CMD.GLOBALS), 2), ...packetize(readPatch(199, false), 3)]) expect(() => assertReadOnlyFrame(bytes)).not.toThrow();
  });
  it('rejects patch selection, parameter changes, toggles and unknown queries', () => {
    for (const msg of [readPatch(0, true), setParam(0,0,0,1), setBlockOn(0,true), query(CMD.DEVICE_ID)]) {
      for (const bytes of packetize(msg,1)) expect(() => assertReadOnlyFrame(bytes)).toThrow();
    }
    expect(() => assertReadOnlyFrame(Uint8Array.from([0xc0,1]))).toThrow();
  });
});
