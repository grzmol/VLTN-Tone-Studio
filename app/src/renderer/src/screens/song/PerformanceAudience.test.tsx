import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudienceStatus } from "@shared/host/audience";
import { AudienceSettings } from "./AudienceSettings";

const status = (patch: Partial<AudienceStatus> = {}): AudienceStatus => ({
  windowing: "display",
  open: false,
  mode: null,
  displayId: null,
  displays: [{ id: 1, label: "Display 1", primary: true, width: 1440, height: 900 }],
  message: "Audience display is off.",
  ...patch,
});

const host = vi.hoisted(() => ({ audience: undefined as unknown }));
vi.mock("@/host", () => ({ host }));

// Radix's Select measures its list with ResizeObserver, which jsdom does not have.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("AudienceSettings", () => {
  afterEach(() => cleanup());
  it("shows nothing where there is no audience display (the browser build has its own)", () => {
    host.audience = undefined;
    const { container } = render(<AudienceSettings />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the status and opens the audience display from the performance screen", async () => {
    const open = vi.fn(async () => status({ open: true, mode: "display", message: "Showing on Display 1." }));
    host.audience = {
      status: async () => status(),
      onStatus: () => () => {},
      open,
      close: async () => status(),
      chooseDisplay: async () => status(),
      publish: async () => {},
    };
    render(<AudienceSettings />);
    expect(await screen.findByText("Audience display is off.")).toBeTruthy();
    screen.getByRole("button", { name: "Open audience display" }).click();
    expect(open).toHaveBeenCalled();
    expect(await screen.findByText("Showing on Display 1.")).toBeTruthy();
  });

  it("shows the display choice only for a display, not for a pop-up", async () => {
    host.audience = {
      status: async () => status({ windowing: "popup", displays: [] }),
      onStatus: () => () => {},
      open: async () => status(),
      close: async () => status(),
      chooseDisplay: async () => status(),
      publish: async () => {},
    };
    render(<AudienceSettings />);
    await screen.findByText("Audience display is off.");
    expect(screen.queryByLabelText("Audience display location")).toBeNull();
  });
});
