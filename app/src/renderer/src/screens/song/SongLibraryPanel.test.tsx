import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SongLibraryPanel } from './SongLibraryPanel';
import { useSongLibrary } from '@/song/library';
import { useSong } from '@/song/store';
import { emptyLibrary } from '@shared/song-library';
const api=vi.hoisted(()=>({index:vi.fn(),exportBackup:vi.fn(),restoreBackup:vi.fn(),onTransferProgress:vi.fn()}));
vi.mock('@/host',()=>({host:{song:{library:api}}}));
vi.mock('@/song/stems/engine',()=>({separateStems:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();api.index.mockResolvedValue(emptyLibrary());api.exportBackup.mockResolvedValue(null);api.restoreBackup.mockResolvedValue(null);api.onTransferProgress.mockReturnValue(vi.fn());useSong.setState({source:null,stems:null,status:{kind:'idle'}});useSongLibrary.setState({index:emptyLibrary(),busy:false,error:'',notice:'',transfer:''});});
afterEach(cleanup);
it('offers non-destructive restore on an empty library and cancels cleanly through the real store',async()=>{
  await act(async()=>{render(<SongLibraryPanel onPick={vi.fn()}/>);});
  expect((screen.getByText('Export library backup…') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Restore adds new songs and playlists/)).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByText('Restore backup as new copies…'));});
  expect(api.restoreBackup).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Backup restore cancelled.')).toBeTruthy();
});
