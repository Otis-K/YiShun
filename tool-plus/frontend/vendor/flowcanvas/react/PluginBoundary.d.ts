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
export declare class PluginBoundary extends Component<PluginBoundaryProps, PluginBoundaryState> {
    state: PluginBoundaryState;
    static getDerivedStateFromError(error: Error): PluginBoundaryState;
    componentDidCatch(error: Error, info: ErrorInfo): void;
    componentDidUpdate(previous: PluginBoundaryProps): void;
    render(): ReactNode;
}
export {};
