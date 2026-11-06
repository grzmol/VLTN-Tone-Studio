import { describe, expect, it } from "vitest";
import { COLOUR_NAMES, COLOUR_TAG, headingLabel, midiCommand, parseChart, stageText, timedCues, transpose } from "./chart";
import { isChased } from "./midi-chase";

/** Charts written with the original grammar. Their parse is pinned to the output of the parser from before triggers, macros and the extended grammar. */
const existingCharts: string[] = [
] = [
  "[00:00] {midi:pc 1 1}\n[00:01] {midi:pc 1 2}\n[00:02] {midi:pc 1 3}",
  "[00:10.5][00:02.00] [Am]Verse {midi:pc 2 127}\n[00:00] Intro {midi:cc 1 80 127}",
  "[00:12.50] [Am]Words here {midi:pc 1 0} {label:Patch A}\n[00:24.00] [F]Chorus {midi:cc 1 64 127} {label:Looper record}",
  "[00:25.00] {midi:note 1 60 100} {midi:off 1 60 0}\n[00:26.00] {midi:off 1 60 0}",
  "[00:27.00] {midi:sysex F0 7D 01 F7} {chase}\n[00:28.00] {nochase} {midi:cc 2 80 127}",
  "[00:30.00] {midi:cc 3 64 127} {midi:cc 3 64 0} {label:Momentary} {nochase}\n[01:02.5] Chords [C][G/B] {midi:pc 16 127}",
  "Lyrics without timestamps\n[00:05] Line one\n\n  \n[00:06.25] Line two {label:Two}",
  "[00:00] [Bbmaj7/D] Hello [Am] [F#sus4] {midi:cc 1 0 0}",
  "[00:03] {midi:cc 1 0 0} {midi:cc 1 32 1} {midi:pc 1 9}",
  ""
];

/** The parse of each chart above before this change. If one of these changes, an existing chart would play differently. */
const legacyParse: unknown[] = [
  [
    {
      "time": 0,
      "text": "",
      "messages": [
        [
          192,
          1
        ]
      ]
    },
    {
      "time": 1,
      "text": "",
      "messages": [
        [
          192,
          2
        ]
      ]
    },
    {
      "time": 2,
      "text": "",
      "messages": [
        [
          192,
          3
        ]
      ]
    }
  ],
  [
    {
      "time": 0,
      "text": "Intro",
      "messages": [
        [
          176,
          80,
          127
        ]
      ]
    },
    {
      "time": 2,
      "text": "[Am]Verse",
      "messages": [
        [
          193,
          127
        ]
      ]
    },
    {
      "time": 10.5,
      "text": "[Am]Verse",
      "messages": [
        [
          193,
          127
        ]
      ]
    }
  ],
  [
    {
      "time": 12.5,
      "text": "[Am]Words here",
      "messages": [
        [
          192,
          0
        ]
      ],
      "label": "Patch A"
    },
    {
      "time": 24,
      "text": "[F]Chorus",
      "messages": [
        [
          176,
          64,
          127
        ]
      ],
      "label": "Looper record"
    }
  ],
  [
    {
      "time": 25,
      "text": "",
      "messages": [
        [
          144,
          60,
          100
        ],
        [
          128,
          60,
          0
        ]
      ]
    },
    {
      "time": 26,
      "text": "",
      "messages": [
        [
          128,
          60,
          0
        ]
      ]
    }
  ],
  [
    {
      "time": 27,
      "text": "",
      "messages": [
        [
          240,
          125,
          1,
          247
        ]
      ],
      "chase": true
    },
    {
      "time": 28,
      "text": "",
      "messages": [
        [
          177,
          80,
          127
        ]
      ],
      "chase": false
    }
  ],
  [
    {
      "time": 30,
      "text": "",
      "messages": [
        [
          178,
          64,
          127
        ],
        [
          178,
          64,
          0
        ]
      ],
      "label": "Momentary",
      "chase": false
    },
    {
      "time": 62.5,
      "text": "Chords [C][G/B]",
      "messages": [
        [
          207,
          127
        ]
      ]
    }
  ],
  [
    {
      "time": 5,
      "text": "Line one",
      "messages": []
    },
    {
      "time": 6.25,
      "text": "Line two",
      "messages": [],
      "label": "Two"
    }
  ],
  [
    {
      "time": 0,
      "text": "[Bbmaj7/D] Hello [Am] [F#sus4]",
      "messages": [
        [
          176,
          0,
          0
        ]
      ]
    }
  ],
  [
    {
      "time": 3,
      "text": "",
      "messages": [
        [
          176,
          0,
          0
        ],
        [
          176,
          32,
          1
        ],
        [
          192,
          9
        ]
      ]
    }
  ],
  []
];

describe("existing chart syntax", () => {
  it("parses every existing chart exactly as before", () => {
    expect(existingCharts.map((chart) => parseChart(chart))).toEqual(legacyParse);
  });
  it("keeps the original MIDI command grammar and the existing errors", () => {
    expect(midiCommand("pc 1 5")).toEqual([192, 5]);
    expect(() => parseChart("Untimed {midi:pc 1 1}")).toThrow("MIDI needs a [mm:ss] timestamp.");
    expect(() => parseChart("[00:00] {midi:pc 1 1")).toThrow(/MIDI commands/);
    expect(() => parseChart("[00:00] {chase} {nochase}")).toThrow("either {chase} or {nochase}");
    expect(transpose("[Bbmaj7/D] Hello", 2)).toBe("[Cmaj7/E] Hello");
  });
});

describe("MIDI triggers", () => {
  it("parses each trigger without a timestamp and keeps its label", () => {
    const cues = parseChart("{midi@load: pc 1 5} {label:Patch}\n{midi@play: cc 2 80 127}\n{midi@stop: cc 2 81 127}\n{midi@end: start}");
    expect(cues.map((c) => [c.trigger, c.time, c.messages, c.tokens])).toEqual([
      ["load", 0, [[192, 5]], ["@load pc 1 5"]],
      ["play", 0, [[177, 80, 127]], ["@play cc 2 80 127"]],
      ["stop", 0, [[177, 81, 127]], ["@stop cc 2 81 127"]],
      ["end", 0, [[250]], ["@end start"]],
    ]);
    expect(cues[0].label).toBe("Patch");
  });
  it("keeps triggers out of the timed cues", () => {
    const cues = parseChart("{midi@load: pc 1 5}\n[00:01] {midi:pc 1 2}");
    expect(timedCues(cues).map((c) => c.time)).toEqual([1]);
  });
  it("rejects a trigger that has a timestamp, an empty trigger, and a misspelled kind", () => {
    expect(() => parseChart("[00:10] {midi@load: pc 1 5}")).toThrow(/no timestamp/);
    expect(() => parseChart("{midi@load:}")).toThrow(/need contents/);
    expect(() => parseChart("{midi@start: pc 1 5}")).toThrow(/MIDI trigger is/);
  });
});

describe("extended commands in charts", () => {
  it("parses bank, song select and transport tokens", () => {
    const [cue] = parseChart("[00:01.00] {midi:pc 1 5 bank 0 2} {midi:songselect 3} {midi:start}");
    expect(cue.messages).toEqual([[176, 0, 0], [176, 32, 2], [192, 5], [243, 3], [250]]);
    expect(cue.tokens).toEqual(["pc 1 5 bank 0 2", "songselect 3", "start"]);
  });
  it("rejects malformed extended commands with the command text", () => {
    expect(() => parseChart("[00:00] {midi:pc 1 5 bank 0}")).toThrow(/Invalid MIDI command: pc 1 5 bank 0/);
  });
});

describe("macros in charts", () => {
  const macros = [
    { code: "GP_LEAD", label: "Lead", commands: ["pc 16 12", "cc 1 102 127"] },
    { code: "OUTRO", label: "Outro", commands: ["$GP_LEAD", "stop"] },
  ];
  it("expands a reference when the chart is parsed, keeping the reference as its token", () => {
    const [cue] = parseChart("[00:20] Chorus {midi:$GP_LEAD}", macros);
    expect(cue.messages).toEqual([
      [207, 12],
      [176, 102, 127],
    ]);
    expect(cue.tokens).toEqual(["$GP_LEAD"]);
  });
  it("expands a trigger that uses a macro", () => {
    expect(parseChart("{midi@end: $OUTRO}", macros)[0].messages.length).toBe(3);
  });
  it("throws for an unknown macro, a self reference, or a reference to a missing table", () => {
    expect(() => parseChart("[00:01] {midi:$NOPE}", macros)).toThrow(/Unknown macro \$NOPE/);
    expect(() => parseChart("[00:01] {midi:$GP_LEAD}")).toThrow(/Unknown macro/);
    const self = [{ code: "LOOP", label: "Loop", commands: ["$LOOP"] }];
    expect(() => parseChart("[00:01] {midi:$LOOP}", self)).toThrow(/refers to itself/);
  });
});

describe("chase rules for the new messages", () => {
  const cue = (text: string) => parseChart(text)[0];
  it("treats song select as state, and the transport bytes and triggers as one-shots", () => {
    const song = cue("[00:01] {midi:songselect 3}");
    expect(isChased(song, song.messages[0])).toBe(true);
    const start = cue("[00:01] {midi:start}");
    expect(isChased(start, start.messages[0])).toBe(false);
  });
});

describe("transposing chords with a key", () => {
  it.each([
    ["[Bb] [Eb] [Ab]", 0, undefined, "[Bb] [Eb] [Ab]"],
    ["[A#] [D#]", 0, undefined, "[A#] [D#]"],
    ["[A#] [D#]", 0, true, "[Bb] [Eb]"],
    ["[Bb] [Eb]", 0, false, "[A#] [D#]"],
    ["[C] [G7] [Am]", 1, undefined, "[C#] [G#7] [A#m]"],
    ["[C] [G7] [Am]", 1, true, "[Db] [Ab7] [Bbm]"],
    ["[F#m] [E/G#]", -2, true, "[Em] [D/Gb]"],
    ["[N] [F] Words", 4, false, "[N] [A] Words"],
  ])("%s by %i with flats %s is %s", (text, steps, flats, expected) => {
    expect(transpose(text, steps, flats)).toBe(expected);
  });
  it("leaves lyrics with brackets that are not chords alone", () => {
    expect(transpose("[Verse] Hello [Chorus]", 2)).toBe("[Verse] Hello [Chorus]");
  });
});

describe("headings, comments and colour in the text", () => {
  it.each([
    ["# Chorus", "Chorus"],
    ["  #   Verse 2 ", "Verse 2"],
    ["#Chorus", null],
    ["Chorus", null],
    ["[00:01] # Bridge", null],
    ["Hello # not a heading", null],
  ])("headingLabel(%j) is %j", (text, label) => {
    expect(headingLabel(text)).toBe(label);
  });
  it.each([
    ["[C]Hello // a note", "[C]Hello"],
    ["// whole line note", ""],
    ["Plain line", "Plain line"],
    ["Visit http://example.com", "Visit http://example.com"],
    ["Shown {color:red}here{/color} // hidden", "Shown {color:red}here{/color}"],
  ])("stageText(%j) is %j", (text, shown) => {
    expect(stageText(text)).toBe(shown);
  });
  it("names the colours a span may use", () => {
    expect(COLOUR_NAMES).toEqual(["red", "amber", "green", "blue", "violet"]);
    expect("x {color:red}y{/color} {color:purple}z{/color}".match(COLOUR_TAG)).toEqual(["{color:red}", "{/color}", "{color:purple}", "{/color}"]);
  });
  it("keeps headings, comments and colour spans in the parsed text, so the editor shows them", () => {
    const [cue] = parseChart("[00:02] # Chorus {color:red}Loud{/color} // note");
    expect(cue.text).toBe("# Chorus {color:red}Loud{/color} // note");
  });
});

describe("comments are inert for MIDI", () => {
  const note = "// The grammar has four triggers: {midi@load:}, {midi@play:}, {midi@stop:} and {midi@end:}. {midi:pc 16 1} {chase} $GP_LEAD";

  it("parses a chart whose whole-line comment holds an empty trigger and a MIDI command", () => {
    const chart = `${note}\n[00:05] [C]Verse {midi:pc 1 5}\n{midi@load: pc 2 3}`;
    const cues = parseChart(chart);
    expect(cues.map((c) => [c.time, c.trigger, c.messages])).toEqual([
      [0, "load", [[193, 3]]],
      [5, undefined, [[192, 5]]],
    ]);
  });
  it("sends nothing from a comment, even one with a timestamp", () => {
    const cues = parseChart("[00:02] // {midi:pc 16 1} {chase}\n[00:03] {midi:pc 1 2}");
    expect(cues.map((c) => [c.time, c.messages, c.chase])).toEqual([
      [2, [], undefined],
      [3, [[192, 2]], undefined],
    ]);
  });
  it("ignores a trailing comment after content, so its tokens are not parsed", () => {
    const [cue] = parseChart("[00:04] [Am]Hello {midi:cc 1 0 0} // {midi:pc 9 9} {nochase}");
    expect(cue.messages).toEqual([[176, 0, 0]]);
    expect(cue.chase).toBeUndefined();
  });
  it("still rejects an invalid token on a line that is not a comment, with its line number", () => {
    expect(() => parseChart("// {midi:pc 16 1}\n[00:01] {midi:}")).toThrow(/Line 2: MIDI commands need nonempty/);
    expect(() => parseChart("// {midi@load:}\n\n{midi@load:}")).toThrow(/Line 3: MIDI triggers need contents/);
  });
  it("keeps the comment byte for byte in the parsed text, so the editor and saved chart show it", () => {
    const line = "[00:06] Lyric  //  {midi:pc 9 9} keep   this  ";
    const [cue] = parseChart(line);
    expect(cue.text).toBe("Lyric  //  {midi:pc 9 9} keep   this");
    expect(stageText(cue.text)).toBe("Lyric");
    expect(line.slice(line.indexOf("//"))).toBe("//  {midi:pc 9 9} keep   this  ");
  });
});
