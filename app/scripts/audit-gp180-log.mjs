// Offline hardware validation. Never opens a MIDI port or sends to the pedal.
// node scripts/audit-gp180-log.mjs <session.log>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CMD, decodeFrame, decodeMessage, decodeGlobals, decodeNames, Reassembler } from '../src/renderer/src/gp150/lib/protocol.mjs';
import { normalize, parsePrst, validChain } from '../src/renderer/src/gp150/lib/prst.mjs';
import { assertReadOnlyFrame } from '../src/renderer/src/gp150/lib/read-only.mjs';
import { GP150_CATALOG } from '../src/renderer/src/gp150/lib/catalog-data.mjs';
import { modelByFxid } from '../src/renderer/src/gp150/lib/catalog.mjs';

const file = process.argv[2];
if (!file) throw new Error('Pass the path to a Tone Studio session.log. This command only reads the file.');
const log = readFileSync(file, 'utf8');
const start = log.lastIndexOf('  Start ');
assert(start >= 0, 'No complete session start found');
const lines = log.slice(log.lastIndexOf('\n', start) + 1).split(/\r?\n/);
const rx = new Reassembler(), slots = new Set(), unknown = new Set();
let incoming = 0, outgoing = 0, firmware = null, names = 0, presets = 0;
for (const line of lines) {
  const match = line.match(/^\S+\s+(In|Out)\s+.*\[SysEx \d+ B\]\s+([0-9A-F ]+)$/);
  if (!match) continue;
  const bytes = Uint8Array.from(match[2].trim().split(' ').map(x => parseInt(x, 16)));
  if (match[1] === 'Out') { assertReadOnlyFrame(bytes); outgoing++; continue; }
  incoming++;
  const frame = decodeFrame(bytes);
  assert(frame, 'Invalid incoming SysEx frame');
  if (frame.kind !== 'packet') continue;
  const complete = rx.push(frame);
  if (!complete) continue;
  const msg = decodeMessage(complete.bytes);
  assert(msg?.crcOk, 'Invalid reassembled message CRC');
  if (msg.cmd === CMD.GLOBALS) firmware = decodeGlobals(msg.payload).firmware;
  if (msg.cmd === CMD.PRESET_NAMES) names = decodeNames(msg.cmd, msg.payload).length;
  if (msg.cmd !== CMD.PATCH) continue;
  const patch = parsePrst(normalize(msg.payload));
  assert(validChain(patch.chain), 'Invalid preset signal chain');
  assert(patch.blocks.every(b => b.params.every(Number.isFinite)), 'Non-finite preset parameters');
  assert(patch.slot >= 0 && patch.slot < 200, 'Invalid preset slot');
  for (const b of patch.blocks) if (!modelByFxid(GP150_CATALOG, b.fxid, b.index)) unknown.add(`${b.code}:0x${b.fxid.toString(16)}`);
  presets++; slots.add(patch.slot);
}
assert(incoming > 0 && firmware && names === 200 && presets > 0, 'Log does not establish a complete GP-180 inspection');
console.log(JSON.stringify({ incoming, outgoing, allOutgoingReadOnly: true, firmware, presetNames: names, presetReplies: presets, distinctSlots: slots.size, unknownModels: [...unknown] }, null, 2));
