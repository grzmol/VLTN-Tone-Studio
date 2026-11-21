import { useEffect, useState } from "react";
import type { AudienceState } from "@shared/audience";

/** The audience window's state, from `subscribe` (the preload or the browser channel). It starts empty until the first update. */
export function useAudienceState(subscribe: (callback: (state: AudienceState) => void) => () => void): AudienceState {
  const [state, setState] = useState<AudienceState>({ model: null, clock: null });
  useEffect(() => subscribe(setState), [subscribe]);
  return state;
}
