// While a performance uses the pedal, the device store sends nothing on its own and catches up once afterwards.
import { afterEach, beforeEach, expect, it } from "vitest";
import { getDriver, useDevice } from "./device";
import { useStageActivity } from "./stage-activity";
import type { Gp150Driver } from "./driver/gp150-driver";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mockOf = () => (getDriver() as Gp150Driver).mock!;

beforeEach(async () => {
  useStageActivity.setState({ busy: false });
  await useDevice.getState().connect("mock", { mockDevice: "gp180" });
});
afterEach(async () => {
  useStageActivity.setState({ busy: false });
  await useDevice.getState().disconnect();
});

it("defers the re-read after a pedal-side patch change until the performance stops", async () => {
  const mock = mockOf();
  useStageActivity.setState({ busy: true });
  const before = mock.received.length;
  await mock.selectOnPedal(5);
  await wait(900);
  expect(mock.received.length).toBe(before);
  expect(useDevice.getState().stale).toBe(true);

  useStageActivity.setState({ busy: false });
  await wait(1200);
  expect(useDevice.getState().stale).toBe(false);
  expect(useDevice.getState().slot).toBe(5);
  expect(mock.received.length).toBeGreaterThan(before);
}, 30_000);

it("runs one catch-up read however many patches changed", async () => {
  const mock = mockOf();
  useStageActivity.setState({ busy: true });
  await mock.selectOnPedal(5);
  await mock.selectOnPedal(6);
  await mock.selectOnPedal(7);
  await wait(600);
  useStageActivity.setState({ busy: false });
  await wait(1200);
  expect(useDevice.getState().slot).toBe(7);
  const settled = mock.received.length;
  await wait(900);
  expect(mock.received.length).toBe(settled);
}, 30_000);

it("defers the name list re-read after a save on the pedal, then reads it once", async () => {
  const mock = mockOf();
  useStageActivity.setState({ busy: true });
  const before = mock.received.length;
  await mock.saveOnPedal();
  await wait(900);
  expect(mock.received.length).toBe(before);

  useStageActivity.setState({ busy: false });
  await wait(1200);
  expect(mock.received.length).toBeGreaterThan(before);
}, 30_000);

it("forgets a deferred read when the pedal disconnects", async () => {
  useStageActivity.setState({ busy: true });
  await mockOf().selectOnPedal(5);
  await wait(100);
  expect(useDevice.getState().stale).toBe(true);
  await useDevice.getState().disconnect();
  expect(useDevice.getState().stale).toBe(false);
}, 30_000);

it("still reads right away when nothing is playing", async () => {
  const mock = mockOf();
  await mock.selectOnPedal(5);
  await wait(1200);
  expect(useDevice.getState().slot).toBe(5);
  expect(useDevice.getState().stale).toBe(false);
}, 30_000);
