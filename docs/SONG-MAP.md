# Song maps

A song map is a Markdown file that holds what the app can't work out well on its own: the structure of a song, what the drums and bass play in each part, the notes the bass should play, and the timed lyrics and chords. An assistant can write one from the song's audio, you check it, and Tone Studio imports it.

- [The round trip](#the-round-trip)
- [The song brief](#the-song-brief)
- [A prompt for the assistant](#a-prompt-for-the-assistant)
- [The file format](#the-file-format)
- [What an import changes](#what-an-import-changes)
- [Undo](#undo)
- [Limits](#limits)

## The round trip

Find **Song map** in the **This song** view of **Song → Performance**. The song must be saved to the library, and its audio loaded.

1. Press **Export song brief…**. It saves a file called `<song> - song brief.md`. **Copy brief** puts the same text on the clipboard instead.
2. Give the brief to an assistant, with the song's audio or its stems. Ask it to correct the draft at the end of the brief. The [prompt below](#a-prompt-for-the-assistant) is a start.
3. Save the assistant's reply as a `.md` file, and press **Import song map…**. Or press **Paste…** and paste the text.
4. Tick the parts you want, and press **Apply**. The song saves and loads again, so every panel shows the new values.

Nothing changes until you press **Apply**. The import is refused while the song plays, so stop it first.

## The song brief

The brief is a snapshot of the song as the app knows it when you export. Export it again after you change the song.

It has these parts, and leaves out any part the song doesn't have:

- **What the app found**: the length, the tempo, the meter, the first beat, the key and the loudness.
- **Bars**: the time each bar starts at, eight bars to a line.
- **Detected sections**: the sections the analysis suggested, with the parts that are silent in each.
- **Chords**: the chords the app heard, one line per bar.
- **Bass notes heard**: the bass note on each beat, one line per bar. A dash means the app wasn't sure of that beat.
- **Lyrics as transcribed**: the lyrics the app took from the vocals, if there are any.
- **Draft song map**: the song's current state as a song map, to correct. It holds the tempo, the key, the sections with the drums and bass chosen for each, the bass notes, the chart and the notes.

Importing the draft without changes changes nothing in the song. The dialog offers no part, because every part already matches the song.

## A prompt for the assistant

Paste this into a chat assistant with the brief and the song's audio:

```text
Attached is a song brief from VLTN Tone Studio, and the song. Listen to the song and check the bars, the sections, the chords and the bass
notes against it. Correct the draft song map at the end of the brief. Keep its format exactly: the same front matter, the same tables and
the same chart fence. Where you are not sure, say so in the Notes section. Reply with the song map only, as one Markdown file.
```

## The file format

A song map is Markdown with front matter, then `##` sections. Only `songmap: 1` is required.

````markdown
---
songmap: 1
title: Confession
duration: 3:52.0
key: A major
bpm: 128.5
meter: 4/4
first_beat: 0:00.42
style: rock
---

# Confession

## Sections

| Start | End | Section | Drums | Bass | Style | Energy | Busy | Loud | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 0:00.0 | 0:12.4 | Intro | off | pedal | | 2 | 1 | 2 | Guitar alone, bass enters bar 3 |
| 0:12.4 | 0:43.1 | Verse 1 | on | ring | | 2 | 2 | 2 | |
| 0:43.1 | 1:14.0 | Chorus 1 | on | melodic | rock | 4 | 4 | 4 | Big, open |

## Bass notes

| Start | End | Note | Octave |
|---|---|---|---|
| 1:02.50 | 1:04.40 | F# | |
| 1:20.00 | 1:21.90 | E | down |

## Chart

```chart
[0:12.40] [A]First line of the [E]verse
[0:16.10] [F#m]Second line [D]here
```

## Notes

The instruments heard, playing styles, anything the performer should know.
````

- **Times** are `m:ss.s` (`1:02.50`), `h:mm:ss.s`, or plain seconds (`42.5`).
- **Front matter** is `key: value` lines between `---` lines. `key` is a note and `major` or `minor`, such as `F# minor`, `F#m` or `Bb`. `bpm` is 20 to 300. `meter` is such as `3/4` or `6/8`. `first_beat` is the time of the first downbeat. `style` is one of the band styles in the table below. Other keys are kept, and do no harm.
- **Sections** is a table. `Start` and `Section` are needed; the rest are optional. The headers can be in any order and any case.
  - `End` may be empty. The section then ends where the next one starts, or at `duration` for the last one.
  - `Drums` is `on` or `off`.
  - `Bass` is `off` (no generated bass in the section), or one of `auto`, `ring`, `pulse`, `groove`, `melodic`, `walking`, `pedal` and `rest`.
  - `Style` is one of `rock`, `pop`, `ballad`, `funk`, `shuffle`, `country`, `reggae`, `metal`, `six-eight` and `half-time`.
  - `Energy`, `Busy` and `Loud` are 1 to 5.
  - Sections must be in time order, and must not overlap.
- **Bass notes** is a table of `Start`, `End`, `Note` (`C`, `F#`, `Bb`, and so on) and `Octave` (`up`, `down`, or empty). The bass plays that note in the time given, instead of the chord's bass.
- **Chart** is the first code block under `## Chart`, with the `chart` fence. It uses the same format as the chart editor: `[m:ss.xx]` for the time of a line, `[Chord]` for a chord, and `# Heading` for a heading.
- **Notes** is the text under `## Notes`, up to the next `##` heading.

Other `##` headings are ignored, and the app says so.

If a row is wrong, the app skips that row and says which line it was and why. The rest of the map still imports. The import dialog lists the skipped lines under **Problems in the song map**.

## What an import changes

The dialog lists each part the map holds, with what it changes. Tick the parts you want. Only the ticked parts change.

| Part | What it changes | What it replaces |
|---|---|---|
| Tempo | The tempo, the meter and the first beat. | The saved values that differ, shown in the dialog. |
| Key | The song's key. | The key the song had, if it differs. |
| Sections | The song's sections, with the names and times from the map. | Your sections. |
| Drums and bass | Each section's drums on or off, bass part, style, energy, busy and loud. | The drums and bass choices for the song's sections. It is only offered together with the sections. |
| Bass notes | The bass notes the map lists. | Your bass notes. |
| Chart | The chart. | Your chart. It is unticked by default when it would replace one. |
| Notes | The notes for the song. | The notes you saved. |

Some things to know:

- A section in the map keeps the song's section when it starts at the same time (within 0.05 seconds) and has the same name, or is the only section there. The kept section keeps its id, mode and colour, and takes the map's name and times. A new section gets a new id, `map-1`, `map-2` and so on.
- A part is offered only when it would change something. A tempo value that matches is not written, so the song's tempo source stays as it was. A value that changes is marked as set by hand, and a new analysis won't change it.
- A chart that is only the song's lyrics is not offered as a chart. The lyrics stay in their own track.

## Undo

After **Apply**, the card shows **Undo**. It puts back what the import replaced. It works until the next import, or until you open another song.

## Limits

- A map is at most 1 MB.
- At most 64 sections, and 500 bass notes.
- The notes are cut after 4000 characters.
- A map is only read by this version of the app if it says `songmap: 1`.
