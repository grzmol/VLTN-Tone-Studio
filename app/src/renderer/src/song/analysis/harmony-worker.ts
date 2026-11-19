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

const audios: PcmAudio[] = [];
function audioAt(index: number): PcmAudio {
  const audio = audios[index];
  if (!audio) throw new Error("No harmony audio was supplied.");
  return audio;
}
self.onmessage = (event: MessageEvent<HarmonyRequest>) => {
  const request = event.data;
  if (request.kind === "audio") {
    audios[request.index] = request.audio;
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
