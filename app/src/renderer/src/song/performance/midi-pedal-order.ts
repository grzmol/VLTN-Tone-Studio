/**
 * The GP-150 / GP-180 pauses for a moment while it changes patch, and a message sent to another channel right after its program change
 * is held for that pause. Messages due at the same moment are therefore sent for the other pedals first. Only the order of messages
 * due together changes; each group keeps its own order, so bank select stays before its program change.
 */

/** The channel a status byte addresses (1–16), or null for system messages, which have no channel. */
function channelOf(status: number): number | null {
  return status >= 128 && status < 240 ? (status & 15) + 1 : null;
}

/**
 * Stable reorder of messages due together: those not on `pedalChannel` (including system messages) first, then those on it.
 * With no pedal channel the messages come back in their original order.
 */
export function orderForPedal<T>(messages: readonly T[], pedalChannel: number | null | undefined, bytesOf: (message: T) => readonly number[]): T[] {
  if (!pedalChannel) return [...messages];
  const others: T[] = [];
  const pedal: T[] = [];
  for (const message of messages) {
    const onPedal = channelOf(bytesOf(message)[0]) === pedalChannel;
    if (onPedal) pedal.push(message);
    else others.push(message);
  }
  return [...others, ...pedal];
}
