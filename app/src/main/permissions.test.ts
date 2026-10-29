import { describe, expect, it } from "vitest";
import { isOwnRenderer } from "./permissions";

describe("isOwnRenderer", () => {
  it("accepts the packaged bundle, page and origin", () => {
    expect(isOwnRenderer("app://bundle/index.html", undefined)).toBe(true);
    expect(isOwnRenderer("app://bundle/", undefined)).toBe(true);
    expect(isOwnRenderer("app://bundle", undefined)).toBe(true);
  });

  it("refuses other app:// hosts", () => {
    expect(isOwnRenderer("app://library/1/track.flac", undefined)).toBe(false);
    expect(isOwnRenderer("app://evil/index.html", undefined)).toBe(false);
  });

  it("accepts the dev server's origin in development, whatever the path", () => {
    expect(isOwnRenderer("http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isOwnRenderer("http://localhost:5173/index.html?x=1", "http://localhost:5173/")).toBe(true);
  });

  it("refuses the bundle in development, and other ports or hosts of the dev server", () => {
    expect(isOwnRenderer("app://bundle/index.html", "http://localhost:5173")).toBe(false);
    expect(isOwnRenderer("http://localhost:5174/", "http://localhost:5173")).toBe(false);
    expect(isOwnRenderer("http://127.0.0.1:5173/", "http://localhost:5173")).toBe(false);
  });

  it("refuses web pages and local files", () => {
    expect(isOwnRenderer("https://www.tone3000.com/", undefined)).toBe(false);
    expect(isOwnRenderer("https://www.tone3000.com/", "http://localhost:5173")).toBe(false);
    expect(isOwnRenderer("file:///Applications/Tone%20Studio.app/index.html", undefined)).toBe(false);
  });

  it("refuses a missing or unparseable URL", () => {
    expect(isOwnRenderer(undefined, undefined)).toBe(false);
    expect(isOwnRenderer("", undefined)).toBe(false);
    expect(isOwnRenderer("not a url", undefined)).toBe(false);
    expect(isOwnRenderer("http://localhost:5173/", "not a url")).toBe(false);
  });
});
