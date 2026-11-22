import { readKey, type KeyInput, type KeyReading } from "../performance/key";
import { detectChords, type Chord, type ChordsInput } from "../performance/chords";
import { sumAudio } from "../band/request";
import type { PcmAudio } from "../types";

/** Each distinct audio crosses once as an `audio` message; key and chord jobs then name the copies they read by index. */
export type HarmonyRequest =
  | { kind: "audio"; index: number; audio: PcmAudio }
  | { kind: "key"; id: number; harmony: number; input: Omit<KeyInput, "harmony"> }
  | { kind: "chords"; id: number; harmony: number[]; input: Omit<ChordsInput, "harmony" | "harmonyParts"> };
export type HarmonyReply = { id: number; result: KeyReading | Chord[] } | { id: number; error: string };

// Keyed by the index the client chose; a Map, so a message can never write an arbitrary property.
const audios = new Map<number, PcmAudio>();
function audioAt(index: number): PcmAudio {
  const audio = audios.get(index);
  if (!audio) throw new Error("No harmony audio was supplied.");
  return audio;
}
self.onmessage = (event: MessageEvent<HarmonyRequest>) => {
  const request = event.data;
  if (request.kind === "audio") {
    if (Number.isInteger(request.index) && request.index >= 0) audios.set(request.index, request.audio);
    return;
  }
  try {
    const result =
      request.kind === "key"
        ? readKey({ ...request.input, harmony: audioAt(request.harmony) })
        : detectChords({ ...request.input, harmony: request.harmony.length === 1 ? audioAt(request.harmony[0]) : sumAudio(request.harmony.map(audioAt)) });
    self.postMessage({ id: request.id, result } satisfies HarmonyReply);
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) } satisfies HarmonyReply);
  }
};
