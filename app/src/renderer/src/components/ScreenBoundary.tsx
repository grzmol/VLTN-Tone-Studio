import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { sessionLog } from "@/state/session-log";

/*
 * An error in one screen or view must not blank the whole window (spec 146). The boundary shows a panel in place of the
 * broken part and leaves the rest of the app, playback and MIDI running. Audio and MIDI objects live outside React, so
 * they are not unmounted by a boundary below them unless the boundary wraps their owner.
 */

interface ScreenBoundaryProps {
  children: ReactNode;
  /** Names the screen or view in the session log and in the copied details. */
  name: string;
  /** "app" wraps the whole window and offers Reload app; "screen" offers Reload screen. */
  scope?: "screen" | "app";
  /** Heading of the panel. Defaults to the wording the screen uses. */
  title?: string;
}

interface ScreenBoundaryState {
  error: Error | null;
  componentStack: string;
  /** Bumped by Reload screen; changing the key remounts the children from scratch. */
  attempt: number;
  copy: "idle" | "copied" | "failed";
}

/** The first line of the error, so one long message does not fill the panel. */
export function errorLine(error: Error): string {
  const line = (error.message || error.name || "Unknown error").split("\n")[0].trim();
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/** Text for Copy details: the error, its stack and the component stack, ready to paste into a bug report. */
export function detailsText(name: string, error: Error, componentStack: string): string {
  const lines = [`Screen: ${name}`, `Error: ${error.name}: ${error.message}`];
  if (error.stack) lines.push("", error.stack);
  if (componentStack.trim()) lines.push("", "Component stack:", componentStack.trim());
  return lines.join("\n");
}

export class ScreenBoundary extends Component<ScreenBoundaryProps, ScreenBoundaryState> {
  state: ScreenBoundaryState = { error: null, componentStack: "", attempt: 0, copy: "idle" };

  static getDerivedStateFromError(error: Error): Partial<ScreenBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
    sessionLog("Error", `${this.props.name} hit a problem: ${errorLine(error)}`);
  }

  private reloadScreen = (): void => {
    this.setState((s) => ({ error: null, componentStack: "", copy: "idle", attempt: s.attempt + 1 }));
  };

  private reloadApp = (): void => {
    window.location.reload();
  };

  private copyDetails = async (): Promise<void> => {
    const { name } = this.props;
    const { error, componentStack } = this.state;
    if (!error) return;
    try {
      await navigator.clipboard.writeText(detailsText(name, error, componentStack));
      this.setState({ copy: "copied" });
    } catch {
      this.setState({ copy: "failed" });
    }
  };

  render(): ReactNode {
    const { error, attempt, copy } = this.state;
    const { scope = "screen", title, name } = this.props;
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>;
    const app = scope === "app";
    return (
      <div className="p-6">
        <section role="alert" aria-label={name} className="glass flex max-w-xl flex-col gap-3 rounded-xl p-5 text-[13px]">
          <h2 className="text-base font-semibold">{title ?? (app ? "This app hit a problem." : "This screen hit a problem.")}</h2>
          <p className="text-silkscreen-2 break-words">{errorLine(error)}</p>
          <div className="flex flex-wrap items-center gap-2">
            {app ? (
              <Button onClick={this.reloadApp}>Reload app</Button>
            ) : (
              <Button onClick={this.reloadScreen}>Reload screen</Button>
            )}
            <Button variant="outline" onClick={() => void this.copyDetails()}>
              Copy details
            </Button>
            {copy === "copied" && <span className="text-xs text-silkscreen-2">Copied.</span>}
            {copy === "failed" && <span className="text-xs text-silkscreen-2">Couldn't copy. Select the details from the session log instead.</span>}
          </div>
        </section>
      </div>
    );
  }
}
