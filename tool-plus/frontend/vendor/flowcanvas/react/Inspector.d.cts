import type { CanvasEngine } from '../core/engine.cjs';
import type { CanvasNode, NodeDefinition, ValidationIssue } from '../core/types.cjs';
import type { FlowCanvasAssistantService } from '../services.cjs';
import type { FlowCanvasInspectorRenderer } from './extensions.cjs';
export type InspectorTab = 'properties' | 'assistant';
interface InspectorProps {
    engine: CanvasEngine;
    node?: CanvasNode;
    definition?: NodeDefinition;
    issues: ValidationIssue[];
    onClose: () => void;
    readOnly?: boolean;
    renderer?: FlowCanvasInspectorRenderer;
    assistant?: FlowCanvasAssistantService;
    tab: InspectorTab;
    onTabChange: (tab: InspectorTab) => void;
    onDraftChange?: (active: boolean, commit?: () => void) => void;
}
export declare function Inspector({ engine, node, definition, issues, onClose, readOnly, renderer: PropertyRenderer, assistant, tab, onTabChange, onDraftChange, }: InspectorProps): import("react").JSX.Element;
export {};
