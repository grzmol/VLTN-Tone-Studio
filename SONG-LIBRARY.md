# Saved songs

In the desktop app, open **Song → Songs**. The browser version can split a song but cannot keep it, so this tab only works in the desktop app.

1. Open a song on the Stems tab and split it.
2. On the Songs tab, enter a title and an artist and choose **Save to library**. After a new split, choose **Save changes** to replace the stems.
3. Saved songs are listed below. **Open** loads a song with its stems, ready to play on the Stems tab. The bin button moves a song to the Trash after asking first.

## What is saved

Each saved song has its own ID, so the file name of the original does not matter, and the original file is not needed again. The source and every stem are stored as lossless FLAC, one file per track. The source keeps 24 bits when the file you opened had more than 16 bits. Stems are stored at 16 bits.

The data lives in the app's data folder, in a folder called `song-library`. `library.json` holds the list of songs. Folders named with a long ID hold the audio of one song each, with files such as `source.flac` and `vocals.flac`. Do not rename files in there. To copy the library to another computer, use the backup below.

A song's tracks are read straight from disk and decoded in the background, so nothing large is copied between processes when a song opens. Opening a song takes under a second in the packaged app.

A save writes every audio file first and only then replaces the index, so an interrupted save leaves the earlier version of the song as it was. When you save a song again and a track has not changed, its file is reused and nothing is encoded for it. Folders left behind by an interrupted save are removed once they are more than an hour old, at start and every 10 minutes after.

A deleted song and its audio are moved to the Trash. Where the system has no Trash, they go into a `.trash` folder inside the library, which is emptied of anything older than 30 days.

## Portable backup and restore

**Export library backup…** writes every saved song, with its source and stems, into one `.tar.gz` file. The export writes a temporary file beside the destination and only replaces the destination once it is complete, so a failed export keeps an earlier backup.

**Restore backup…** adds the songs in a backup to your library and keeps what you already have. If some songs have the same source audio as songs you have saved, you can **skip** them or **import as copies**. Restored songs get new IDs.

Every file in a backup is checked against its size and SHA-256 before the library changes, and file names outside the expected layout are refused. A failed restore leaves the library as it was. A backup holds up to 50,000 files and 512 GiB. Backups are large because the audio is lossless. Allow room for the archive when exporting and for all the audio when restoring.

## Libraries from Tone Studio fork builds

Releases made from the main project never had a song library, so nobody upgrading from one of them has anything to convert. This section is for people who ran the fork's builds, which saved songs as raw float32 files (library version 1).

The first time such a library is opened, the app converts it to FLAC in the background, one song at a time. The status bar shows "Converting library" with the number of songs done. Each song is written to a new folder, decoded again and compared sample for sample with the original before the index is changed. Only then is the old folder moved to `v1-backup` inside the library. A song that has not been converted yet refuses to open, with a message, rather than failing quietly. An interrupted conversion picks up where it stopped at the next start, and a song that fails is left as it was.

`v1-backup` holds the old `library.json` and each converted song's old folder, with a README that says how to put them back. It is the way back to the old library. When you no longer need it, **Settings → Library → Remove the old library copy** moves it to the Trash. Nothing in it is needed to play your songs.

## Format versions

The library index is version 4. It also has room for folders, play history and playlists, which this release stores and hands back unchanged but has no screens for. Fields a song carries that this release does not know are kept when the song is saved again, so a later version can add fields without changing the format.

Older indexes are read and upgraded in memory with no saved value changed; the upgrade is written on the next save. An older app cannot read a version 4 library. It shows an empty library and does not change the files, so going back is safe as long as you have the copy in `v1-backup` or a backup from before. Backups made by earlier versions still restore, and their songs are converted like any other older song.
