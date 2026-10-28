// Per-route error boundary (architecture.md §6.5): "Something went wrong" with the message and a
// "Copy details" button. Owned by app-shell.
import { Component, type ComponentChildren } from 'preact';

interface State {
  error: Error | null;
}

export class RouteBoundary extends Component<{ children?: ComponentChildren }, State> {
  override state: State = { error: null };

  override componentDidCatch(error: unknown): void {
    this.setState({ error: error instanceof Error ? error : new Error(String(error)) });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n${error.stack ?? ''}`;
    return (
      <>
        <h1>Something went wrong</h1>
        <section class="card">
          <p>{error.message}</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(details);
            }}
          >
            Copy details
          </button>
        </section>
      </>
    );
  }
}
