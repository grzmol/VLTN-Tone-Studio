import { validateSmartRules, type SmartRules } from "@shared/library-filter";

/*
 * The filters a person used lately, kept on this computer so they can be applied again. It is a convenience for one viewer: nothing here
 * is shared, and nothing is needed for the library to work. A stored filter that no longer passes the rules is dropped, and storage that
 * cannot be read or written (a private window, blocked site data) gives an empty list rather than an error.
 */

export const RECENT_FILTERS_KEY = "vltn.library.recentFilters.v1";
export const RECENT_FILTERS_MAX = 8;

export function readRecentFilters(): SmartRules[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_FILTERS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((filter): filter is SmartRules => {
      try {
        validateSmartRules(filter as SmartRules);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/** The list with `filter` at the top. A filter already in the list moves up, rather than being repeated. */
export function withRecentFilter(recent: readonly SmartRules[], filter: SmartRules): SmartRules[] {
  const key = JSON.stringify(filter);
  return [filter, ...recent.filter((item) => JSON.stringify(item) !== key)].slice(0, RECENT_FILTERS_MAX);
}

/** Stores the recent filters. A write that fails is ignored: the list then lasts only for this session. */
export function writeRecentFilters(recent: readonly SmartRules[]): void {
  try {
    localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify(recent.slice(0, RECENT_FILTERS_MAX)));
  } catch {
    // Not stored; the filter still applies.
  }
}
