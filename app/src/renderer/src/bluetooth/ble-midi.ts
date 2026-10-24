// MIDI Association BLE-MIDI 1.0 framing. GATT payloads are capped at the default ATT MTU (23 - 3).
export const MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';
const dataLength = (status: number) => status >= 0xf8 ? 0 : status < 0xf0 ? ((status & 0xe0) === 0xc0 ? 1 : 2) : ({ 241: 1, 242: 2, 243: 1, 246: 0 }[status] ?? -1);

export function encodeBleMidi(bytes: readonly number[] | Uint8Array, timestamp = 0, mtu = 20): Uint8Array[] {
  if (mtu < 5 || !Number.isInteger(mtu)) throw new Error('Invalid BLE packet size.');
  const data = Array.from(bytes);
  if (!data.length || data[0] < 128 || data.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error('Invalid MIDI bytes.');
  const stamp = Math.floor(timestamp) & 0x1fff, header = 0x80 | (stamp >> 7), low = 0x80 | (stamp & 127);
  if (data[0] !== 0xf0) {
    if (dataLength(data[0]) !== data.length - 1 || data.slice(1).some(b => b > 127)) throw new Error('Send one complete MIDI message at a time.');
    return [Uint8Array.from([header, low, ...data])];
  }
  if (data.at(-1) !== 0xf7 || data.slice(1, -1).some(b => b > 127)) throw new Error('Invalid SysEx data.');
  const packets: Uint8Array[] = [];
  let packet = [header, low, 0xf0];
  for (const b of data.slice(1, -1)) {
    if (packet.length === mtu) { packets.push(Uint8Array.from(packet)); packet = [header]; }
    packet.push(b);
  }
  // EOX always has a timestamp, including on a continuation packet.
  if (packet.length + 2 > mtu) { packets.push(Uint8Array.from(packet)); packet = [header]; }
  packets.push(Uint8Array.from([...packet, low, 0xf7]));
  return packets;
}

export class BleMidiDecoder {
  private sysex: number[] | null = null;
  private running = 0;
  reset() { this.sysex = null; this.running = 0; }
  decode(packet: Uint8Array): Uint8Array[] {
    const messages: Uint8Array[] = [];
    if (packet.length < 2 || (packet[0] & 0xc0) !== 0x80) { this.reset(); return messages; }
    let i = 1;
    const emit = (bytes: number[]) => messages.push(Uint8Array.from(bytes));
    while (i < packet.length) {
      if (this.sysex) {
        const b = packet[i++];
        if (b < 128) {
          this.sysex.push(b);
          if (this.sysex.length > 1024 * 1024) this.reset();
          continue;
        }
        // High-bit byte inside SysEx is a timestamp preceding EOX or an interleaved realtime message.
        const status = packet[i++];
        if (status === 0xf7) { this.sysex.push(status); emit(this.sysex); this.sysex = null; }
        else if (status >= 0xf8) emit([status]);
        else { this.reset(); break; }
        continue;
      }
      if (packet[i] >= 128) i++; // timestamp; running-status events may omit it
      if (i >= packet.length) break;
      let status = packet[i];
      if (status >= 128) i++;
      else status = this.running;
      if (status === 0xf0) { this.sysex = [status]; this.running = 0; continue; }
      const length = dataLength(status);
      if (status < 128 || length < 0) { this.reset(); break; }
      if (status < 0xf0) this.running = status;
      else if (status < 0xf8) this.running = 0;
      const message = [status];
      while (message.length <= length && i < packet.length) {
        if (packet[i] < 128) message.push(packet[i++]);
        else if (packet[i + 1] >= 0xf8) { i++; emit([packet[i++]]); }
        else break;
      }
      if (message.length !== length + 1) { this.reset(); break; }
      emit(message);
    }
    return messages;
  }
}
