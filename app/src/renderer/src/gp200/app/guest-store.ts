// Guest effects of the GrooveGurus mod (gp-200-re RFC-0027): an effect of one block offered in another block's list
// ("DST Green OD" in MOD). The mod reports which fit each block (service op GUESTS); state/scenes.ts reads them when a
// modded pedal connects, and the catalog lookups (state/preset-codec.ts) add them to the block's models.
import { create } from "zustand";
import type { ModGuest } from "@/gp200/lib/mod-service.mjs";

interface ModGuestsState {
  /** Guests per destination block index (0-10); null without a modded pedal or before the read */
  byBlock: Readonly<Record<number, readonly ModGuest[]>> | null;
}

export const useModGuests = create<ModGuestsState>(() => ({ byBlock: null }));

/** The guests block `block` can hold now ([] when unknown). */
export const guestsOf = (block: number): readonly ModGuest[] => useModGuests.getState().byBlock?.[block] ?? [];
