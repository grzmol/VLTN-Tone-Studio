// Tags and star ratings for presets on this computer. Kept in localStorage next to the app's other renderer-side
// memory, keyed by `collectionId/presetId`, so no file format or IPC changes.
// ponytail: a renamed or moved preset loses its tags; move to collection.json if that starts to hurt.
import { create } from "zustand";
import type { LocalPreset } from "@shared/host/files";

export interface PresetMeta {
  tags: string[];
  /** 0 = unrated, 1-5 */
  stars: number;
}

const KEY = "vltn.presetMeta.v1";
const EMPTY: PresetMeta = { tags: [], stars: 0 };

export const metaKey = (p: Pick<LocalPreset, "collectionId" | "id">) => `${p.collectionId}/${p.id}`;

export const normTag = (t: string) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");

function load(): Record<string, PresetMeta> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

interface TagsState {
  meta: Record<string, PresetMeta>;
  setStars(key: string, stars: number): void;
  addTag(key: string, tag: string): void;
  removeTag(key: string, tag: string): void;
}

export const useTags = create<TagsState>((set, get) => {
  const write = (key: string, next: PresetMeta) => {
    const meta = { ...get().meta };
    if (next.stars || next.tags.length) meta[key] = next;
    else delete meta[key];
    set({ meta });
    try {
      localStorage.setItem(KEY, JSON.stringify(meta));
    } catch {
      /* storage full or blocked: tags last for this session */
    }
  };
  const cur = (key: string) => get().meta[key] ?? EMPTY;
  return {
    meta: load(),
    setStars: (key, stars) => write(key, { ...cur(key), stars: cur(key).stars === stars ? 0 : stars }),
    addTag(key, tag) {
      const t = normTag(tag);
      if (t && !cur(key).tags.includes(t)) write(key, { ...cur(key), tags: [...cur(key).tags, t] });
    },
    removeTag: (key, tag) => write(key, { ...cur(key), tags: cur(key).tags.filter((x) => x !== tag) }),
  };
});

export const useMeta = (p: Pick<LocalPreset, "collectionId" | "id">) => useTags((s) => s.meta[metaKey(p)] ?? EMPTY);

/**
 * Every word must match the name, file name, a tag or a model title (`haystack`); `stars:N` keeps N and up.
 * "plexi clean stars:4" = name/tag/model contains plexi and clean, rated 4+.
 */
export function matchesQuery(query: string, haystack: string[], meta: PresetMeta): boolean {
  const text = haystack.join("\n").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => {
      const stars = /^stars?:(\d)$/.exec(w);
      return stars ? meta.stars >= Number(stars[1]) : text.includes(w.replace(/^#/, ""));
    });
}
