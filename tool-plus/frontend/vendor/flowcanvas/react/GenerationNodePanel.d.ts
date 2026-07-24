import type { MutationOptions } from '../core/engine.js';
import type { CanvasNodeData, GraphDocument, NodeDefinition } from '../core/types.js';
import { type GenerationMediaKind, type GenerationMode } from '../generation.js';
import type { FlowCanvasReadonlyNode } from './extensions.js';
export interface GenerationReference {
    id: string;
    title: string;
    type: string;
    status?: string;
    prompt?: string;
    preview?: string;
    kind?: GenerationMediaKind;
    mimeType?: string;
    sourceNodeId?: string;
    targetPort?: string;
    connected?: boolean;
}
interface GenerationNodePanelProps {
    node: FlowCanvasReadonlyNode;
    definition: NodeDefinition;
    readOnly: boolean;
    running: boolean;
    onUpdateData: (patch: Partial<CanvasNodeData>, options?: MutationOptions) => void;
    onCaptureSnapshot: () => GraphDocument;
    onCommitSnapshot: (label: string, before: GraphDocument) => void;
    onDraftChange: (active: boolean, commit?: () => void) => void;
    onChangeMode: (mode: GenerationMode) => void;
    onRun: () => void;
    onCancel: () => void;
    onNotify: (message: string) => void;
    getReferences: () => GenerationReference[];
    connectedReferences: GenerationReference[];
    onDisconnectReference: (sourceNodeId: string, targetPort?: string, edgeId?: string) => void;
}
export declare function GenerationNodePanel({ node, definition, readOnly, running, onUpdateData, onCaptureSnapshot, onCommitSnapshot, onDraftChange, onChangeMode, onRun, onCancel, onNotify, getReferences, connectedReferences, onDisconnectReference, }: GenerationNodePanelProps): import("react").JSX.Element;
export {};
