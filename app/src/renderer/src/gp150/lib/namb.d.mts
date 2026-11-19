export const NAM_WEIGHT_COUNT: number;
export const NAMB_LENGTH: number;
export const NAM_UNSUPPORTED: string;
export class NamError extends Error {}
/** Throws NamError unless `nam` (parsed .nam JSON) is an A2 Lite model; returns its submodel-0 model. */
export function checkNam(nam: unknown): { weights: number[]; metadata?: { loudness?: number } };
export function namToNamb(nam: unknown): Uint8Array;
export function namTextToNamb(text: string): Uint8Array;
