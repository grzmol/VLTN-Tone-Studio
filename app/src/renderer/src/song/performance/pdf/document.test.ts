import { describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({
  getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 1 }), destroy: () => Promise.resolve() })),
}));
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument }));

import { openChart, pdfjsOptions } from "./document";

describe("pdfjsOptions", () => {
  it("points pdf.js at the standard fonts, the WASM decoders and the packed CMaps under one folder", () => {
    expect(pdfjsOptions("https://app.example/pdfjs/")).toEqual({
      standardFontDataUrl: "https://app.example/pdfjs/standard_fonts/",
      wasmUrl: "https://app.example/pdfjs/wasm/",
      cMapUrl: "https://app.example/pdfjs/cmaps/",
      cMapPacked: true,
    });
  });
});

describe("openChart", () => {
  it("opens the PDF with the data-file options, so the standard fonts and decoders resolve", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })));
    const chart = await openChart("app://library/rev/chart.pdf");
    expect(chart.doc).toEqual({ numPages: 1 });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Uint8Array),
        standardFontDataUrl: expect.stringMatching(/\/pdfjs\/standard_fonts\/$/),
        wasmUrl: expect.stringMatching(/\/pdfjs\/wasm\/$/),
        cMapUrl: expect.stringMatching(/\/pdfjs\/cmaps\/$/),
        cMapPacked: true,
      }),
    );
    vi.unstubAllGlobals();
  });
});
