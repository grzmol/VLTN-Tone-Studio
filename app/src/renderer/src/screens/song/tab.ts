import { useEffect } from "react";
import { useSong } from "@/song/store";
import { useNav } from "@/state/nav";

export type SongTab = "stems" | "tone" | "performance" | "songs";

const isSongTab = (param: string | null): param is SongTab => param === "songs" || param === "stems" || param === "tone" || param === "performance";

/**
 * The tab last opened by name. AppShell mounts only the active screen, so this lives outside React: a bare
 * `go("song")` (rail, menu, shortcut) comes back to Tone match after a trip to the Rig.
 */
let lastTab: SongTab = "stems";

/**
 * The Song tab follows the nav param (`go("song", "tone")`, `?screen=song&param=tone`); without one it is the
 * tab used last, as long as there are stems to match (otherwise Stems, where a song gets opened and split).
 * Choosing a tab sets the param, so the choice survives leaving the screen.
 */
export function useSongTab(): [SongTab, (tab: SongTab) => void] {
  const param = useNav((s) => s.param);
  const hasStems = useSong((s) => s.stems !== null);
  useEffect(() => {
    if (isSongTab(param)) lastTab = param;
  }, [param]);
  const tab: SongTab = isSongTab(param) ? param : (lastTab === "performance" || lastTab === "songs") ? lastTab : lastTab === "tone" && hasStems ? "tone" : "stems";
  return [tab, (next) => useNav.getState().go("song", next)];
}
