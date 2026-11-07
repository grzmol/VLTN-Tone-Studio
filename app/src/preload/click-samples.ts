import type { ClickSamplesApi } from "@shared/host/click-samples";
import { invoke } from "./invoke";

export const clickSamplesApi: ClickSamplesApi = {
  get: (slot) => invoke("click-samples:get", slot),
  put: (slot, sample) => invoke("click-samples:put", slot, sample.name, sample.bytes),
  clear: (slot) => invoke("click-samples:clear", slot),
};
