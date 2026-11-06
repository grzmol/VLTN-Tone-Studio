// Publishes pdf.js's data files (the standard fonts, the WASM image decoders and the CMaps) to the renderer under `pdfjs/`, so a PDF chart
// that uses the standard fonts or those decoders draws as its author meant. The files come from the installed `pdfjs-dist` package: there
// is no copy step and no extra package. The dev server serves them at the same paths, so the browser build works too.
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";

/** The folders of pdfjs-dist that the reader asks for, by the option that names them (see song/performance/pdf/document.ts). */
export const PDFJS_DATA_DIRS = ["standard_fonts", "wasm", "cmaps"];
// Found from this app's own install, whichever folder the bundled config runs from.
const PDFJS_ROOT = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const TYPES: Record<string, string> = { ".wasm": "application/wasm", ".ttf": "font/ttf", ".pfb": "application/octet-stream", ".bcmap": "application/octet-stream" };

/** The Vite plugin: emits the data files into the build and serves them from `/pdfjs/<folder>/<file>` in development. */
export function pdfjsAssets() {
  return {
    name: "vltn-pdfjs-assets",
    generateBundle(this: { emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): void }) {
      for (const dir of PDFJS_DATA_DIRS) {
        for (const name of readdirSync(join(PDFJS_ROOT, dir))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS_ROOT, dir, name)) });
        }
      }
    },
    configureServer(server: {
      middlewares: {
        use(path: string, fn: (req: { url?: string }, res: { statusCode: number; setHeader(k: string, v: string): void; end(b?: Uint8Array): void }) => void): void;
      };
    }) {
      // Under /pdfjs/ nothing else is served, so a missing file is a 404, not the app's HTML fallback that pdf.js would try to parse.
      server.middlewares.use("/pdfjs", (req, res) => {
        // Vite strips the mount point, so the path is `<folder>/<file>`. Only the listed folders, and one file name, are read.
        const [dir, name, ...rest] = decodeURIComponent((req.url ?? "").split("?")[0]).split("/").filter(Boolean);
        const notFound = () => {
          res.statusCode = 404;
          res.end();
        };
        if (!PDFJS_DATA_DIRS.includes(dir) || !name || rest.length || name.startsWith(".")) return notFound();
        readFile(join(PDFJS_ROOT, dir, name)).then(
          (bytes) => {
            res.setHeader("Content-Type", TYPES[extname(name)] ?? "application/octet-stream");
            res.end(bytes);
          },
          notFound,
        );
      });
    },
  };
}
