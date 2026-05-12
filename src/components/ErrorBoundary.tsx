import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null; info: ErrorInfo | null };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[ErrorBoundary]", error, info);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen p-6 font-mono text-sm">
        <h1 className="mb-3 text-lg font-semibold text-destructive">App crashed</h1>
        <p className="mb-2 text-muted-foreground">{this.state.error.name}: {this.state.error.message}</p>
        <details open className="mt-3">
          <summary className="cursor-pointer">stack</summary>
          <pre className="mt-2 overflow-auto rounded border bg-card p-3 text-xs">
            {this.state.error.stack}
          </pre>
        </details>
        {this.state.info?.componentStack && (
          <details open className="mt-3">
            <summary className="cursor-pointer">component stack</summary>
            <pre className="mt-2 overflow-auto rounded border bg-card p-3 text-xs">
              {this.state.info.componentStack}
            </pre>
          </details>
        )}
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded border px-3 py-1 text-xs hover:bg-accent"
        >
          Reload
        </button>
      </div>
    );
  }
}
