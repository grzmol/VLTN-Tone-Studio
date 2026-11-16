import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CMD } from "@/gp150/lib/protocol.mjs";
import { useDevice, getDriver } from "./device";
import { Gp150Driver } from "./driver/gp150-driver";
import { resetStageActivity, setStageBusy } from "./stage-activity";

beforeEach(async () => {
  resetStageActivity();
  await useDevice.getState().connect("mock", { mockDevice: "gp180" });
});
afterEach(async () => {
  resetStageActivity();
  await useDevice.getState().disconnect();
});

it("defers unsolicited NAM reads during playback and catches up once on stop", async () => {
  const mock = (getDriver() as Gp150Driver).mock!;
  await useDevice.getState().readNams();
  const queries = () => mock.received.filter((m) => m.cmd === CMD.NAM_NAMES).length;
  const before = queries();
  setStageBusy(true, "nam-test");
  mock.namNames[1].name = "Pedal edit";
  await mock.reportNamNames();
  await new Promise((r) => setTimeout(r, 450));
  expect(queries()).toBe(before);
  expect(useDevice.getState().nams![0].name).toBe("NAM 1");
  resetStageActivity();
  await vi.waitFor(() => expect(useDevice.getState().nams![0].name).toBe("Pedal edit"), { timeout: 2000 });
  expect(queries()).toBe(before + 1);
});

it("clears the NAM table on a new connection and gates the feature on other families", async () => {
  await useDevice.getState().readNams();
  expect(useDevice.getState().nams).toHaveLength(20);
  await useDevice.getState().connect("mock", { mockDevice: "gp150" });
  expect(useDevice.getState().nams).toBeNull();
  expect(await useDevice.getState().readNams()).toHaveLength(20);
  await useDevice.getState().connect("mock", { mockDevice: "gp200" });
  expect(useDevice.getState().nams).toBeNull();
  await expect(useDevice.getState().readNams()).rejects.toThrow("can't do this");
  await expect(useDevice.getState().renameNam(1, "No NAM")).rejects.toThrow("can't do this");
  expect(() => useDevice.getState().setNamMode(1)).toThrow("can't do this");
});
