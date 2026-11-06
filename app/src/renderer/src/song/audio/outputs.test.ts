import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUTS, loadOutputSettings, planRoutes, resolveDeviceId, saveOutputSettings, stereoOnly, type OutputConfig } from "./outputs";

function config(click: [number, number], main: [number, number] = [0, 1]): OutputConfig {
  return {
    deviceId: "usb-4",
    label: "Interface",
    clickDevice: null,
    buses: { ...DEFAULT_OUTPUTS.buses, main: { channels: main, gain: 1 }, click: { channels: click, gain: 0.8 } },
  };
}

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe("planRoutes", () => {
  it("keeps both buses on the stereo destination when they share outputs 1/2", () => {
    expect(planRoutes(DEFAULT_OUTPUTS, 2)).toEqual({
      outputs: 2,
      multichannel: false,
      buses: { main: [0, 1], click: [0, 1], aux1: [0, 1], aux2: [0, 1] },
      fellBack: false,
    });
  });

  it("sends the click to outputs 3/4 and the tracks to 1/2 on a four-output interface", () => {
    expect(planRoutes(config([2, 3]), 4)).toEqual({
      outputs: 4,
      multichannel: true,
      buses: { main: [0, 1], click: [2, 3], aux1: [0, 1], aux2: [0, 1] },
      fellBack: false,
    });
  });

  it("falls back to outputs 1/2 when the click pair is missing on the device", () => {
    expect(planRoutes(config([2, 3]), 2)).toEqual({
      outputs: 2,
      multichannel: false,
      buses: { main: [0, 1], click: [0, 1], aux1: [0, 1], aux2: [0, 1] },
      fellBack: true,
    });
  });

  it("rejects pairs that are not two neighbouring outputs", () => {
    expect(planRoutes(config([3, 2]), 4).fellBack).toBe(true);
    expect(planRoutes(config([1, 3]), 4).fellBack).toBe(true);
    expect(planRoutes(config([-1, 0]), 4).fellBack).toBe(true);
  });
});

describe("resolveDeviceId", () => {
  const devices = [
    { deviceId: "abc", label: "Other" },
    { deviceId: "new-id", label: "Interface" },
  ];

  it("uses the default output for an empty ID", () => {
    expect(resolveDeviceId({ deviceId: "", label: "" }, devices)).toBe("");
  });

  it("keeps the saved ID when the device still has it", () => {
    expect(resolveDeviceId({ deviceId: "new-id", label: "Interface" }, devices)).toBe("new-id");
  });

  it("finds a device by label when its ID has changed", () => {
    expect(resolveDeviceId({ deviceId: "old-id", label: "Interface" }, devices)).toBe("new-id");
  });

  it("returns null when the device is not listed", () => {
    expect(resolveDeviceId({ deviceId: "old-id", label: "Gone" }, devices)).toBeNull();
  });
});

describe("stereoOnly", () => {
  it("moves both buses to outputs 1/2 and keeps their gains", () => {
    const stereo = stereoOnly(config([2, 3]));
    expect(stereo.buses.click).toEqual({ channels: [0, 1], gain: 0.8 });
    expect(stereo.buses.main.channels).toEqual([0, 1]);
  });
});

describe("saved outputs", () => {
  it("keeps the bus gains and devices across a reload", () => {
    const storage = new MemoryStorage();
    saveOutputSettings(storage as unknown as Storage, config([2, 3]));
    expect(loadOutputSettings(storage as unknown as Storage)).toEqual(config([2, 3]));
  });

  it("returns the defaults when nothing is stored or the data is not usable", () => {
    const storage = new MemoryStorage();
    expect(loadOutputSettings(storage as unknown as Storage)).toEqual(DEFAULT_OUTPUTS);
    storage.setItem("vltn.performance.outputs.v1", "null");
    expect(loadOutputSettings(storage as unknown as Storage)).toEqual(DEFAULT_OUTPUTS);
    expect(loadOutputSettings(null)).toEqual(DEFAULT_OUTPUTS);
  });

  it("clamps a stored gain and ignores a bus with a bad pair", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "vltn.performance.outputs.v1",
      JSON.stringify({ deviceId: "", label: "", buses: { main: { channels: [0, 1], gain: 9 }, click: { channels: [0], gain: 1 } } }),
    );
    const loaded = loadOutputSettings(storage as unknown as Storage);
    expect(loaded.buses.main.gain).toBe(2);
    expect(loaded.buses.click).toEqual(DEFAULT_OUTPUTS.buses.click);
  });

  it("does not throw when storage is blocked", () => {
    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(() => saveOutputSettings(blocked as unknown as Storage, config([2, 3]))).not.toThrow();
    expect(loadOutputSettings(blocked as unknown as Storage)).toEqual(DEFAULT_OUTPUTS);
  });
});
