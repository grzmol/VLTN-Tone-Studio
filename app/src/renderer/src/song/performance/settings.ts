import { host } from "@/host";
import type { SongSource } from "../types";
import { SETTING_SUFFIXES } from "@shared/song-library";

/**
 * A song's chart, tempo, lyrics and options. A saved song keeps them in the library, which is the only copy: they are read from a cache that
 * loading the song fills, and edits go back to the library after a short pause. A song that has not been saved keeps them in localStorage.
 */
export const LIBRARY_PREFIX = "vltn.song:";
export const settingSuffixes = SETTING_SUFFIXES;
/** Edits arrive on every keystroke; the library is written once typing stops. */
export const SETTINGS_DEBOUNCE_MS = 500;

export const performanceKey = (source: SongSource | null): string =>
  source?.libraryId
    ? `${LIBRARY_PREFIX}${source.libraryId}`
    : source
      ? `vltn.performance.v1:${source.name}:${source.audio.channels[0].length}:${source.audio.sampleRate}`
      : "vltn.performance.v1:practice";

const savedId = (key: string): string | null => (key.startsWith(LIBRARY_PREFIX) ? key.slice(LIBRARY_PREFIX.length) : null);
const cache = new Map<string, Record<string, string>>(),
  unsent = new Map<string, Record<string, string>>(),
  timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Fills the cache with what the library holds for a song. Edits that have not reached the library yet win. */
export function seedSettings(id: string, values: Record<string, string>): void {
  cache.set(id, { ...values, ...unsent.get(id) });
}
/** Drops every cached song and pending edit. For tests. */
export function clearSettingsCache(): void {
  for (const id of [...cache.keys(), ...unsent.keys()]) forgetSettings(id);
}
export function forgetSettings(id: string): void {
  cache.delete(id);
  unsent.delete(id);
  clearTimeout(timers.get(id));
  timers.delete(id);
}
async function send(id: string): Promise<void> {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const patch = unsent.get(id);
  if (!patch || !host.song.library) return;
  unsent.delete(id);
  try {
    await host.song.library.updateSettings(id, patch);
  } catch (e) {
    // Keep the edit for the next attempt, unless a newer edit of the same value arrived meanwhile.
    unsent.set(id, { ...patch, ...unsent.get(id) });
    throw e;
  }
}
/** Writes every pending edit to the library now. Call it before the library is read, backed up or another song is loaded. */
export async function flushSettings(): Promise<void> {
  await Promise.all([...unsent.keys()].map(send));
}

export function getSetting(key: string, suffix: (typeof settingSuffixes)[number]): string {
  const id = savedId(key);
  if (id) return cache.get(id)?.[suffix] ?? "";
  return localStorage.getItem(key + suffix) ?? "";
}
export function setSetting(key: string, suffix: (typeof settingSuffixes)[number], value: string): void {
  const id = savedId(key);
  if (!id) {
    if (value) localStorage.setItem(key + suffix, value);
    else localStorage.removeItem(key + suffix);
    return;
  }
  if ((cache.get(id)?.[suffix] ?? "") === value) return;
  cache.set(id, { ...cache.get(id), [suffix]: value });
  unsent.set(id, { ...unsent.get(id), [suffix]: value });
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => void send(id).catch((e) => console.error("Could not save song settings", e)), SETTINGS_DEBOUNCE_MS),
  );
}
export function readSettings(key: string): Record<string, string> {
  return Object.fromEntries(settingSuffixes.map((suffix) => [suffix, getSetting(key, suffix)]));
}
export function writeSettings(key: string, values: Record<string, string>): void {
  for (const suffix of settingSuffixes) setSetting(key, suffix, values[suffix] ?? "");
}
/**
 * Changes one saved song's options through the settings cache, so the change is saved with the song's other edits. A song that is not in
 * the cache yet starts from `saved`, the copy the library holds, so nothing else in its options is lost. Returns the options as stored.
 */
export function changeSavedOptions(id: string, saved: string | undefined, change: (options: Record<string, unknown>) => Record<string, unknown>): string {
  const cached = cache.get(id)?.[":options"];
  const json = JSON.stringify(change(parseObject(cached ?? saved ?? "")));
  setSetting(`${LIBRARY_PREFIX}${id}`, ":options", json);
  return json;
}
function parseObject(json: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(json || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
export function readOptions<T>(key: string, defaults: T): T {
  try {
    return { ...defaults, ...JSON.parse(getSetting(key, ":options") || "{}") };
  } catch {
    return defaults;
  }
}

/**
 * Earlier versions kept a saved song's settings in localStorage as well as the library. Moves what is still there into the library and
 * removes the keys. A value in localStorage is at least as new as the library's, because it was only copied over on a song switch.
 */
export async function migrateLocalSettings(songs: { id: string; settings: Record<string, string> }[]): Promise<void> {
  if (!host.song.library) return;
  const found = new Map<string, Record<string, string>>(),
    keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i);
    if (!name?.startsWith(LIBRARY_PREFIX)) continue;
    const id = name.slice(LIBRARY_PREFIX.length, LIBRARY_PREFIX.length + 36),
      suffix = name.slice(LIBRARY_PREFIX.length + 36);
    if (!(settingSuffixes as readonly string[]).includes(suffix)) continue;
    keys.push(name);
    found.set(id, { ...found.get(id), [suffix]: localStorage.getItem(name) ?? "" });
  }
  for (const [id, values] of found) {
    const song = songs.find((s) => s.id === id);
    if (song) {
      const patch = Object.fromEntries(Object.entries(values).filter(([suffix, value]) => value && value !== song.settings[suffix]));
      if (Object.keys(patch).length) {
        await host.song.library.updateSettings(id, patch);
        song.settings = { ...song.settings, ...patch };
      }
    }
  }
  // Keys of songs that no longer exist go too; nothing refers to them.
  for (const name of keys) localStorage.removeItem(name);
}
