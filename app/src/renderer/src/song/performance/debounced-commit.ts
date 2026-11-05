/** How long after the last change a typed speed or pitch value is committed */
export const SPEED_COMMIT_DELAY_MS = 250;

/**
 * Holds the latest value of a field and commits it once no change has come for `delay` ms. `flush` commits at once (a commit key or
 * leaving the field), and `cancel` drops the value that is waiting.
 */
export function debouncedCommit<T>(commit: (value: T) => void, delay: number = SPEED_COMMIT_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: { value: T } | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const pending = waiting;
    waiting = null;
    if (pending) commit(pending.value);
  };
  return {
    change(value: T) {
      waiting = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      waiting = null;
    },
  };
}
