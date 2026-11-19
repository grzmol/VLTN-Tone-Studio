// Converter from a NAM file (A2 Lite shape) to the native converted model the GP-150 / GP-180 stores in a NAM slot.
// Layout, proven against the public upload captures: a constant 496-byte header, then the weights as float32.
// Header offsets 0x18 (CRC-32) and 0x2C (loudness, float64) are filled per model. Pure, isomorphic ESM.

/** Bytes 0x000-0x1EF of every supported model (magic "BMAN", 48000.0 Hz at 0x28). */
const HEADER_HEX =
  "424d414e010000002c1f0000f00100004f0700009d0100002a5c1c2e0000000000070001000000000070e740085c8515" +
  "5bc337c00000000000000000000000000000000000000000000000000000000003009901010001000100010001000300" +
  "030010000117010001000101000000010001000002000100020001000200010002000100020001000200010002000100" +
  "02000100010000000300000007000000110000002900000065000000ef00000001000000030000000700000011000000" +
  "2900000065000000ef000000010000000d000000010000000300000007000000110000002900000065000000ef000000" +
  "060006000600060006000600060006000600060006000600060006000f000f0006000600060006000600060006000401" +
  "0ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c0401" +
  "0ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c0401" +
  "0ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c04010ad7233c0000000000000000" +
  "000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000";

const HEADER_BYTES = 0x1f0;
const CRC_OFFSET = 0x18;
const LOUDNESS_OFFSET = 0x2c;
export const NAM_WEIGHT_COUNT = 1871;
/** The converted model is this long; the pedal slot holds it zero-padded to 8192 bytes. */
export const NAMB_LENGTH = HEADER_BYTES + 4 * NAM_WEIGHT_COUNT;

export const NAM_UNSUPPORTED = "The GP-180 accepts A2 Lite NAM files only";

export class NamError extends Error {
  constructor(message) {
    super(message);
    this.name = "NamError";
  }
}

const refuse = (why) => new NamError(`${NAM_UNSUPPORTED}. ${why}`);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  return c >>> 0;
});

/** CRC-32/IEEE of `bytes`, ignoring the four bytes at `skip` (the CRC field itself). */
function crc32Skipping(bytes, skip) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    if (i >= skip && i < skip + 4) continue;
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** Check that `nam` (parsed .nam JSON) is an A2 Lite model; returns its submodel-0 model. Throws NamError otherwise. */
export function checkNam(nam) {
  if (!nam || typeof nam !== "object") throw refuse("The file is not a NAM model.");
  if (nam.version !== "0.7.0") throw refuse(`NAM version ${nam.version} is not supported (needs 0.7.0).`);
  if (nam.architecture !== "SlimmableContainer") throw refuse(`Architecture ${nam.architecture} is not supported.`);
  const model = nam.config?.submodels?.[0]?.model;
  if (!model) throw refuse("The file has no submodels.");
  if (model.architecture !== "WaveNet") throw refuse(`Submodel architecture ${model.architecture} is not supported.`);
  if (model.sample_rate !== 48000) throw refuse(`Sample rate ${model.sample_rate} is not supported (needs 48000).`);
  const weights = model.weights;
  if (!Array.isArray(weights) || weights.length !== NAM_WEIGHT_COUNT) {
    throw refuse(`The model has ${Array.isArray(weights) ? weights.length : 0} weights, expected ${NAM_WEIGHT_COUNT}.`);
  }
  if (!weights.every((w) => typeof w === "number" && Number.isFinite(w))) throw refuse("The weights contain invalid numbers.");
  const loudness = nam.config.submodels[0].model.metadata?.loudness;
  if (loudness !== undefined && typeof loudness !== "number") throw refuse("The loudness value is invalid.");
  return model;
}

/** Convert parsed .nam JSON to the 7,980-byte native model. */
export function namToNamb(nam) {
  const model = checkNam(nam);
  const out = new Uint8Array(NAMB_LENGTH);
  for (let i = 0; i < HEADER_BYTES; i++) out[i] = parseInt(HEADER_HEX.slice(2 * i, 2 * i + 2), 16);
  const view = new DataView(out.buffer);
  view.setFloat64(LOUDNESS_OFFSET, model.metadata?.loudness ?? 0, true);
  model.weights.forEach((w, i) => view.setFloat32(HEADER_BYTES + 4 * i, w, true));
  view.setUint32(CRC_OFFSET, crc32Skipping(out, CRC_OFFSET), true);
  return out;
}

/** Parse .nam file text and convert it. */
export function namTextToNamb(text) {
  let nam;
  try {
    nam = JSON.parse(text);
  } catch {
    throw refuse("The file is not valid NAM (JSON) data.");
  }
  return namToNamb(nam);
}
