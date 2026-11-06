// @vitest-environment node
import { expect, it } from "vitest";
import { APP_SCHEME_PRIVILEGES } from "./app-scheme";

it("lets the renderer fetch app://library cross-origin and with the Fetch API", () => {
  expect(APP_SCHEME_PRIVILEGES).toMatchObject({ corsEnabled: true, supportFetchAPI: true, standard: true, secure: true });
});
