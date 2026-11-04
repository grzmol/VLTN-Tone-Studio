import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "./dialog";

afterEach(cleanup);

it("keeps a dialog inside the window and lets its body scroll", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Long dialog</DialogTitle>
      </DialogContent>
    </Dialog>
  );
  const content = screen.getByRole("dialog");
  expect(content.className).toContain("max-h-[calc(100dvh-2rem)]");
  expect(content.className).toContain("overflow-y-auto");
  expect(content.className).toContain("overscroll-contain");
});

it("lets a caller's own max height replace the default", () => {
  render(
    <Dialog open>
      <DialogContent className="max-h-[80vh]">
        <DialogTitle>Capped dialog</DialogTitle>
      </DialogContent>
    </Dialog>
  );
  const content = screen.getByRole("dialog");
  expect(content.className).toContain("max-h-[80vh]");
  expect(content.className).not.toContain("max-h-[calc(100dvh-2rem)]");
});

it("keeps the footer visible at the bottom of a scrolling dialog", () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>With footer</DialogTitle>
        <DialogFooter>
          <button>Start</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  const footer = document.querySelector('[data-slot="dialog-footer"]') as HTMLElement;
  expect(footer.className).toContain("sticky");
  expect(footer.className).toContain("-bottom-6");
  expect(footer.className).toContain("bg-background/95");
});
