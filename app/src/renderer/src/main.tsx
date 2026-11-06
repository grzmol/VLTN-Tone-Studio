import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./app/App";
import { AudienceView } from "./screens/audience/AudienceView";
import { logUncaughtErrors } from "./state/session-log";

logUncaughtErrors();

// The audience display is a second window that loads this same bundle with ?view=audience (spec 43). It shows only the audience view.
const audience = new URLSearchParams(window.location.search).get("view") === "audience";

createRoot(document.getElementById("root")!).render(
  audience ? (
    <AudienceView />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
