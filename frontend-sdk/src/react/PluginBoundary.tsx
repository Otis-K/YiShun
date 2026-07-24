import { Component, type ErrorInfo, type ReactNode } from 'react';

interface PluginBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: unknown;
  onError: (error: Error, info: ErrorInfo) => void;
}

interface PluginBoundaryState {
  error?: Error;
}

/** Keeps one faulty host renderer from unmounting the entire canvas root. */
export class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
  state: PluginBoundaryState = {};

  static getDerivedStateFromError(error: Error): PluginBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  componentDidUpdate(previous: PluginBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: undefined });
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
