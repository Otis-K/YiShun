import type { CanvasEngine } from '../core/engine.cjs';
import type { FlowCanvasServices, SaveState } from '../services.cjs';
import type { FlowCanvasRenderers } from './extensions.cjs';
export interface FlowCanvasAppProps {
    /** One engine per independent canvas; sharing an engine intentionally mirrors graph state. */
    engine: CanvasEngine;
    theme: 'dark' | 'light';
    onThemeChange: (theme: 'dark' | 'light') => void;
    readOnly?: boolean;
    renderers?: FlowCanvasRenderers;
    services?: FlowCanvasServices;
    saveState?: SaveState;
}
export declare function FlowCanvasApp(props: FlowCanvasAppProps): import("react").JSX.Element;
