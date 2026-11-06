import { createRoot } from "react-dom/client";
import "./follower.css";
import { FollowerApp } from "./FollowerApp";
import { FollowerClient, sessionTokens, socketOf } from "./follower-client";

// The follower page is its own entry (follower.html), built beside the app and served by band sync (spec 44). It is read-only: it
// receives the song and the clock, and sends only a PIN, a session, pings and the transport actions the performer allows.
const secure = window.location.protocol === "https:";
const client = new FollowerClient({
  url: `${secure ? "wss" : "ws"}://${window.location.host}/ws`,
  connect: socketOf,
  tokens: sessionTokens(window.sessionStorage),
  now: () => Date.now(),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
});

createRoot(document.getElementById("root")!).render(<FollowerApp client={client} />);
client.start();
window.addEventListener("pagehide", () => client.stop());
