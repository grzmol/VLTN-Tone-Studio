// MIDI Association BLE-MIDI 1.0 framing. GATT payloads are capped at the default ATT MTU (23 - 3).
export const MIDI_SERVICE = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
export const MIDI_CHARACTERISTIC = "7772e5db-3868-4112-a1a9-f2669d106bf3";
/** Chromium does not expose the negotiated MTU, so stay at the default payload size. */
export const BLE_MTU = 20;
const dataLength = (status: number) =>
  status >= 0xf8 ? 0 : status < 0xf0 ? ((status & 0xe0) === 0xc0 ? 1 : 2) : ({ 241: 1, 242: 2, 243: 1, 246: 0 }[status] ?? -1);

/** Validate one complete MIDI message (or one whole SysEx) and return a copy of its bytes. */
export function checkMidiMessage(bytes: readonly number[] | Uint8Array): number[] {
  const data = Array.from(bytes);
  if (!data.length || data[0] < 128 || data.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error("Invalid MIDI bytes.");
  if (data[0] !== 0xf0) {
    if (dataLength(data[0]) !== data.length - 1 || data.slice(1).some((b) => b > 127)) throw new Error("Send one complete MIDI message at a time.");
  } else if (data.at(-1) !== 0xf7 || data.slice(1, -1).some((b) => b > 127)) throw new Error("Invalid SysEx data.");
  return data;
}

/**
 * Packs timestamped MIDI messages into BLE-MIDI packets: one header byte, then each message preceded by its own timestamp-low byte.
 * Messages are never split except SysEx, which continues in the next packet and ends with a timestamped EOX. Running status is not used.
 * A message that does not fit, or whose timestamp would not decode in order after the header, starts a new packet.
 */
export class BlePacketBuilder {
  private packets: Uint8Array[] = [];
  private packet: number[] = [];
  private packetStamp = 0;
  private lastStamp = 0;
  constructor(private readonly mtu = BLE_MTU) {
    if (mtu < 5 || !Number.isInteger(mtu)) throw new Error("Invalid BLE packet size.");
  }
  /** Append a message with the time (ms, wrapped to 13 bits) at which it is meant to be sent. */
  add(bytes: readonly number[] | Uint8Array, timestampMs: number) {
    const data = checkMidiMessage(bytes);
    const stamp = Math.floor(timestampMs) & 0x1fff;
    const low = 0x80 | (stamp & 127);
    if (data[0] !== 0xf0) {
      this.begin(stamp, data.length + 1);
      this.packet.push(low, ...data);
      return;
    }
    this.begin(stamp, 3);
    this.packet.push(low, 0xf0);
    for (const b of data.slice(1, -1)) {
      if (this.packet.length === this.mtu) this.cut(true);
      this.packet.push(b);
    }
    // EOX always has a timestamp, including on a continuation packet.
    if (this.packet.length + 2 > this.mtu) this.cut(true);
    this.packet.push(low, 0xf7);
  }
  /** Return every packet built so far, in order, and start over. */
  flush(): Uint8Array[] {
    if (this.packet.length) this.cut(false);
    const packets = this.packets;
    this.packets = [];
    this.packet = [];
    return packets;
  }
  private begin(stamp: number, needed: number) {
    if (this.packet.length && (this.packet.length + needed > this.mtu || stamp >> 7 !== this.packetStamp >> 7 || stamp < this.lastStamp)) this.cut(false);
    if (!this.packet.length) {
      this.packet.push(0x80 | (stamp >> 7));
      this.packetStamp = stamp;
    }
    this.lastStamp = stamp;
  }
  /** Close the current packet; a SysEx continuation reuses the header of the packet it continues. */
  private cut(continuation: boolean) {
    this.packets.push(Uint8Array.from(this.packet));
    this.packet = continuation ? [0x80 | (this.packetStamp >> 7)] : [];
  }
}

export function encodeBleMidi(bytes: readonly number[] | Uint8Array, timestamp = 0, mtu = BLE_MTU): Uint8Array[] {
  const builder = new BlePacketBuilder(mtu);
  builder.add(bytes, timestamp);
  return builder.flush();
}

export class BleMidiDecoder {
  private sysex: number[] | null = null;
  private running = 0;
  reset() {
    this.sysex = null;
    this.running = 0;
  }
  decode(packet: Uint8Array): Uint8Array[] {
    const messages: Uint8Array[] = [];
    if (packet.length < 2 || (packet[0] & 0xc0) !== 0x80) {
      this.reset();
      return messages;
    }
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
        if (status === 0xf7) {
          this.sysex.push(status);
          emit(this.sysex);
          this.sysex = null;
        } else if (status >= 0xf8) emit([status]);
        else {
          this.reset();
          break;
        }
        continue;
      }
      if (packet[i] >= 128) i++; // timestamp; running-status events may omit it
      if (i >= packet.length) break;
      let status = packet[i];
      if (status >= 128) i++;
      else status = this.running;
      if (status === 0xf0) {
        this.sysex = [status];
        this.running = 0;
        continue;
      }
      const length = dataLength(status);
      if (status < 128 || length < 0) {
        this.reset();
        break;
      }
      if (status < 0xf0) this.running = status;
      else if (status < 0xf8) this.running = 0;
      const message = [status];
      while (message.length <= length && i < packet.length) {
        if (packet[i] < 128) message.push(packet[i++]);
        else if (packet[i + 1] >= 0xf8) {
          i++;
          emit([packet[i++]]);
        } else break;
      }
      if (message.length !== length + 1) {
        this.reset();
        break;
      }
      emit(message);
    }
    return messages;
  }
}
