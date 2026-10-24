import { describe, expect, it } from 'vitest';
import { BleMidiDecoder, encodeBleMidi } from './ble-midi';

describe('BLE-MIDI wire framing', () => {
  it('encodes channel messages and a 13-bit timestamp including wrap', () => {
    expect([...encodeBleMidi([0xc0, 5], 129)[0]]).toEqual([0x81, 0x81, 0xc0, 5]);
    expect([...encodeBleMidi([0xf8], 8192)[0]]).toEqual([0x80, 0x80, 0xf8]);
    for (const bytes of [[1,2,3], [0x90,60], [0xc0,128], [0xf0,1], [0xf0,128,0xf7]]) expect(() => encodeBleMidi(bytes)).toThrow();
  });
  it('decodes multiple timestamped messages and running status', () => {
    const decoder = new BleMidiDecoder();
    expect(decoder.decode(Uint8Array.from([0x80,0x81,0x90,60,100,61,90,0x82,62,80,0x83,0xc0,7])).map(b => [...b]))
      .toEqual([[0x90,60,100],[0x90,61,90],[0x90,62,80],[0xc0,7]]);
  });
  it('reassembles SysEx notifications and separates real-time events', () => {
    const decoder = new BleMidiDecoder();
    expect(decoder.decode(Uint8Array.from([0x80,0x80,0xf0,1,2]))).toEqual([]);
    expect(decoder.decode(Uint8Array.from([0x80,3,0x81,0xf8,4])).map(b => [...b])).toEqual([[0xf8]]);
    expect(decoder.decode(Uint8Array.from([0x80,5,0x82,0xf7])).map(b => [...b])).toEqual([[0xf0,1,2,3,4,5,0xf7]]);
  });
  it('handles real-time events interrupting a channel message', () => {
    expect(new BleMidiDecoder().decode(Uint8Array.from([0x80,0x80,0x90,60,0x81,0xf8,100])).map(b => [...b]))
      .toEqual([[0xf8],[0x90,60,100]]);
  });
  it('fragments large SysEx at the default MTU without truncation', () => {
    for (const length of [0,16,17,18,35,1260]) {
      const message = [0xf0,...Array.from({ length }, (_,i) => i % 128),0xf7];
      const packets = encodeBleMidi(message, 1234);
      expect(packets.every(p => p.length <= 20)).toBe(true);
      const decoder = new BleMidiDecoder();
      expect(packets.flatMap(p => decoder.decode(p)).map(b => [...b])).toEqual([message]);
    }
  });
  it('drops malformed or incomplete messages and resets partial SysEx', () => {
    const decoder = new BleMidiDecoder();
    decoder.decode(Uint8Array.from([0x80,0x80,0xf0,1]));
    decoder.decode(Uint8Array.from([0,2,3]));
    expect(decoder.decode(Uint8Array.from([0x80,0x80,0xc0,5])).map(b => [...b])).toEqual([[0xc0,5]]);
    expect(decoder.decode(Uint8Array.from([0x80,0x80,0x90,60]))).toEqual([]);
  });
});
