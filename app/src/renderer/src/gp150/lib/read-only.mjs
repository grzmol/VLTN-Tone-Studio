// Hardware inspection boundary: reject live edits, selection, uploads and unknown messages before MIDI send.
import { CMD, CONTROL, EDIT_BUFFER, decodeFrame, query, readPatch } from './protocol.mjs';
const reads = [CMD.STATE, CMD.GLOBALS, CMD.PRESET_NAMES, CMD.IR_NAMES, CMD.SNAPTONE_NAMES];
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export function assertReadOnlyFrame(bytes) {
  const frame = decodeFrame(bytes);
  if (!frame) throw new Error('Read-only session rejected an invalid frame.');
  if (frame.kind === 'control') {
    if (frame.type === CONTROL.HELLO && frame.arg === 3 && frame.extra.length === 0) return;
    if (frame.type === CONTROL.ACK && frame.arg === 0 && frame.extra.length === 0) return;
    if (frame.type === CONTROL.RESEND && frame.arg === 6 && frame.extra.length === 8) return;
  } else if (frame.offset === 0 && frame.index === 0 && frame.total === frame.data.length) {
    if (reads.some(cmd => equal(frame.data, query(cmd)))) return;
    // Only mode-1 reads; mode-0 selects a patch and is deliberately forbidden.
    for (const slot of [...Array(200).keys(), EDIT_BUFFER]) if (equal(frame.data, readPatch(slot, false))) return;
  }
  throw new Error('Read-only session blocked a command that could change the pedal.');
}
