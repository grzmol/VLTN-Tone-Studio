// The page of the PDF chart on screen, for the audience display (spec 43), which shows the same page. The PDF chart sets it and clears
// it when it goes; nothing else reads the viewer's state.
import { create } from "zustand";

export const useChartPage = create<{ songId: string | null; page: number }>(() => ({ songId: null, page: 1 }));

export function setChartPage(songId: string, page: number): void {
  useChartPage.setState({ songId, page });
}

/** Clears the page only when it is still this song's: a newer chart may have taken it already. */
export function clearChartPage(songId: string): void {
  if (useChartPage.getState().songId === songId) useChartPage.setState({ songId: null, page: 1 });
}
