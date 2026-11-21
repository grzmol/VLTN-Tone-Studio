import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogTitle } from "./alert-dialog";

afterEach(cleanup);

it("keeps an alert dialog inside the window and lets its body scroll", () => {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
      </AlertDialogContent>
    </AlertDialog>
  );
  const content = screen.getByRole("alertdialog");
  expect(content.className).toContain("max-h-[calc(100dvh-2rem)]");
  expect(content.className).toContain("overflow-y-auto");
});

it("lets a caller's own max height replace the default", () => {
  render(
    <AlertDialog open>
      <AlertDialogContent className="max-h-[90vh]">
        <AlertDialogTitle>Capped</AlertDialogTitle>
      </AlertDialogContent>
    </AlertDialog>
  );
  const content = screen.getByRole("alertdialog");
  expect(content.className).toContain("max-h-[90vh]");
  expect(content.className).not.toContain("max-h-[calc(100dvh-2rem)]");
});

it("keeps the alert footer visible at the bottom", () => {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Footer</AlertDialogTitle>
        <AlertDialogFooter>
          <button>OK</button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const footer = document.querySelector('[data-slot="alert-dialog-footer"]') as HTMLElement;
  expect(footer.className).toContain("sticky");
  expect(footer.className).toContain("-bottom-6");
});
