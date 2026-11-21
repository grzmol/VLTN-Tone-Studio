# Supported devices

What Tone Studio does on each pedal. The short list is in the [README](../README.md#devices); this page is the detail behind it. A mark means the feature exists in the app, not that it has been proven on every unit: see the hardware notes in the [Performance guide](PERFORMANCE.md#hardware-results) and the [product plan](PRODUCT-PLAN.md).

| | GP-5 | GP-50 | GP-150 | GP-180 | GP-200 · 200R · 200X | GP-200LT | GP-200JR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Recognised over USB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live editing | ✅ | ✅ | ✅ | ✅ | ✅¹ | ✅¹ | ✅¹ |
| Preset library | ✅ 100 slots | ✅ 100 slots | ✅ 200 slots | ✅ 200 slots | ✅ 256 slots | ✅ 256 slots | ✅ 255 slots |
| Backups | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Restore a backup | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `.prst` export | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `.prst` import | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pedal settings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Global EQ | — | — | ✅ | ✅ | ✅² | ✅² | ✅² |
| Footswitches and chain order | ✅ FS1–2 | ✅³ FS1–2 | ✅ FS A–B | ✅ FS A–C | ✅ CTRL 1–8 | ✅ | ✅ |
| Tempo and tap tempo | ✅ | ✅³ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Expression pedal and patch settings | — | ✅³ | ✖️ | ✖️ | ✅ | ✅ | ✅ |
| SnapTones (NAM) over USB | ✅ 30 user slots | ✅ 30 user slots | ✅ 50 user slots | ✅ 50 user slots | ✅ 10 slots | ❔ | ❔ |
| Cab IR inside a SnapTone | ✅ | ✅ | — | — | — | — | — |
| User IRs over USB | ✅ 20 × 512 | ✅ 20 × 512 | ✅ 20 slots | ✅ 20 slots | ✅ 20 × 1024 | ✅ 20 × 1024 | ✅ 20 × 1024 |
| Tone Match | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Simulated pedal](#build-it-yourself) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

<sub>✅ works &nbsp;·&nbsp; ✖️ not in Tone Studio &nbsp;·&nbsp; ❔ not known yet whether the pedal has it &nbsp;·&nbsp; — the pedal doesn't have it or doesn't need it</sub>

<br>

¹ **GP-200 knobs come from the built-in [effect list](../README.md#the-gp-200-family)**, or from Valeton's editor if you import its list.<br>
² **The Global EQ write** is known only from Valeton's GP-200 editor, so it's behind *Settings › Experimental pedal commands*.<br>
³ **Some GP-50 commands sit behind Settings › Experimental pedal commands**: live footswitch, order and tempo changes, expression pedal settings, reading a slot without selecting it, and the pedal's own delete, copy and move. With the switch off, footswitches, order and tempo reach the pedal when you save. The simulator always has them.
