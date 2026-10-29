// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelDownloadError } from "@shared/host/song";
import { downloadPart, type Fetch } from "./model-download";

const URL_ = "https://huggingface.co/example/model.onnx";
const never = () => new Promise<Response>(() => {});
const tick = () => new Promise((resolve) => setImmediate(resolve));
/** Waits until the download has asked the server, so its watchdog is armed. */
const untilCalled = async (fetchFn: { mock: { calls: unknown[] } }) => {
  while (fetchFn.mock.calls.length === 0) await tick();
};

let dir: string;
let part: string;

/** Waits until `part` holds `bytes` bytes (the watchdog is armed by then, so a fake-timer advance counts from there). */
async function untilSize(bytes: number) {
  for (;;) {
    if (((await stat(part).catch(() => null))?.size ?? 0) === bytes) return;
    await tick();
  }
}

/** Resolves with the error `promise` rejects with (or null), so a test can advance timers before it settles. */
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (e: unknown) => e as { code?: string; message: string },
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  dir = await mkdtemp(join(tmpdir(), "model-download-"));
  part = join(dir, "model.onnx.part");
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("downloadPart", () => {
  it("fails a transfer that gets no response within 30 s, and keeps the .part for the next try", async () => {
    await writeFile(part, "0123456789");
    const fetchFn = vi.fn<Fetch>(never);
    const outcome = settle(downloadPart(URL_, 20, part, fetchFn, () => {}));
    await untilCalled(fetchFn);
    vi.advanceTimersByTime(30_000);
    const error = await outcome;
    expect(error).toMatchObject({ code: "network", message: modelDownloadError(null) });
    expect((await readFile(part)).toString()).toBe("0123456789");
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: { Range: "bytes=10-" } });
  });

  it("fails a transfer that stalls mid-body for 60 s, after the bytes it did get", async () => {
    await writeFile(part, "0123456789");
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcde"));
      },
    });
    const fetchFn = vi.fn<Fetch>(async () => new Response(body, { status: 206 }));
    const outcome = settle(downloadPart(URL_, 20, part, fetchFn, () => {}));
    await untilSize(15);
    vi.advanceTimersByTime(60_000);
    expect(await outcome).toMatchObject({ code: "network" });
    expect((await readFile(part)).toString()).toBe("0123456789abcde");
  });

  it("resumes from the .part with a Range request and finishes the file", async () => {
    await writeFile(part, "0123456789");
    const rest = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("ABCDEFGHIJ"));
        controller.close();
      },
    });
    const fetchFn = vi.fn<Fetch>(async () => new Response(rest, { status: 206 }));
    const received: number[] = [];
    await downloadPart(URL_, 20, part, fetchFn, (n) => received.push(n));
    expect(fetchFn.mock.calls[0][1]).toMatchObject({ headers: { Range: "bytes=10-" } });
    expect((await readFile(part)).toString()).toBe("0123456789ABCDEFGHIJ");
    expect(received.at(-1)).toBe(20);
  });

  it("starts over when the server ignores Range and sends the whole file", async () => {
    await writeFile(part, "stale");
    const whole = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0123456789"));
        controller.close();
      },
    });
    await downloadPart(URL_, 10, part, async () => new Response(whole, { status: 200 }), () => {});
    expect((await readFile(part)).toString()).toBe("0123456789");
  });

  it("cancel stops a stalled transfer at once with a cancelled error, and keeps the .part", async () => {
    await writeFile(part, "0123456789");
    const stop = new AbortController();
    const fetchFn = vi.fn<Fetch>(never);
    const outcome = settle(downloadPart(URL_, 20, part, fetchFn, () => {}, stop.signal));
    await untilCalled(fetchFn);
    stop.abort();
    expect(await outcome).toMatchObject({ code: "cancelled" });
    expect((await stat(part)).size).toBe(10);
  });

  it("doesn't call the server when cancelled before it starts", async () => {
    const stop = new AbortController();
    stop.abort();
    const fetchFn = vi.fn<Fetch>(never);
    expect(await settle(downloadPart(URL_, 20, part, fetchFn, () => {}, stop.signal))).toMatchObject({ code: "cancelled" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps an HTTP error status to a network error without touching the .part", async () => {
    await writeFile(part, "0123456789");
    const error = await settle(downloadPart(URL_, 20, part, async () => new Response("nope", { status: 503 }), () => {}));
    expect(error).toMatchObject({ code: "network", message: modelDownloadError(503) });
    expect((await readFile(part)).toString()).toBe("0123456789");
  });
});
