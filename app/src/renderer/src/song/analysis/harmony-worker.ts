import { readKey, type KeyInput, type KeyReading } from "../performance/key";
import { detectChords, type Chord, type ChordsInput } from "../performance/chords";
import type { PcmAudio } from "../types";

export type HarmonyRequest =
  | { kind: "audio"; audio: PcmAudio }
  | { kind: "key"; id: number; input: Omit<KeyInput, "harmony"> }
  | { kind: "chords"; id: number; input: Omit<ChordsInput, "harmony"> };
export type HarmonyReply = { id: number; result: KeyReading | Chord[] } | { id: number; error: string };

let harmony: PcmAudio | null = null;
self.onmessage = (event: MessageEvent<HarmonyRequest>) => {
  const request = event.data;
  if (request.kind === "audio") {
    harmony = request.audio;
    return;
  }
  try {
    if (!harmony) throw new Error("No harmony audio was supplied.");
    const result = request.kind === "key" ? readKey({ ...request.input, harmony }) : detectChords({ ...request.input, harmony });
    self.postMessage({ id: request.id, result } satisfies HarmonyReply);
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) } satisfies HarmonyReply);
  }
};
