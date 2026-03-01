import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught render error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: '1rem', color: '#ff6b6b', fontFamily: 'monospace' }}>
          <h3>Display Error</h3>
          <p>{this.state.error?.message ?? 'An unexpected error occurred'}</p>
          <button onClick={() => { window.location.reload(); }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
