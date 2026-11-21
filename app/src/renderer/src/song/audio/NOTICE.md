# Notices

- **soundtouchjs 0.3.0** (cutterbl/SoundTouchJS): LGPL-2.1. It is the JavaScript port of SoundTouch, which the performance
  speed and pitch stretch (`stretch.ts`, `stretch-worker.ts`) uses. It is used unmodified, as a dependency, and its licence
  text is in `node_modules/soundtouchjs/LICENSE`. A distributed build of this app must keep the library replaceable: the
  package is open source and the stretch imports it by name, so a replacement built from the same API works without
  rebuilding the app's own code.

- **pdfjs-dist 6.4.299** (Mozilla pdf.js): Apache-2.0. It draws a song's PDF chart (`song/performance/pdf/document.ts`, `screens/song/PdfChart.tsx`)
  in its own worker. It is used unmodified, as a dependency, and its licence text is in `node_modules/pdfjs-dist/LICENSE`. Apache-2.0 is
  compatible with this app's GPL-3.0 licence. The version is pinned exactly in `app/package.json`.

- **CodeMirror 6** (`@codemirror/state` 6.7.6, `@codemirror/view` 6.43.15, `@codemirror/commands` 6.11.1, `@codemirror/search` 6.7.2;
  Marijn Haverbeke and contributors): MIT. It is the chart editor's text box (`screens/song/ChartCodeEditor.tsx`):
  search, undo and syntax colours. It is used unmodified, as dependencies, and each licence text is in `node_modules/@codemirror/<package>/LICENSE`.
  The versions are pinned exactly in `app/package.json`.

The Rubber Band library was considered for higher-quality stretching but not used: its npm WASM build (`rubberband-wasm`)
is listed as plain "GPLv2", not "GPLv2 or later". GPL-2.0-only code cannot be combined with this GPL-3.0-only app, so it
stays out until its licence is confirmed.
