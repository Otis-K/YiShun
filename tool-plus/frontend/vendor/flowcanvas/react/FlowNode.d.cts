import { type Node, type NodeProps } from '@xyflow/react';
import type { MutationOptions } from '../core/engine.cjs';
import type { CanvasNodeData, GraphDocument, NodeDefinition } from '../core/types.cjs';
import { type GenerationMode } from '../generation.cjs';
import type { FlowCanvasNodeRenderer, FlowCanvasReadonlyNode } from './extensions.cjs';
import { type GenerationReference } from './GenerationNodePanel.cjs';
export interface FlowNodeData extends CanvasNodeData {
    definition: NodeDefinition;
    node: FlowCanvasReadonlyNode;
    renderer?: FlowCanvasNodeRenderer;
    onRendererError: (error: Error) => void;
    readOnly: boolean;
    running: boolean;
    onUpdateData: (patch: Partial<CanvasNodeData>, options?: MutationOptions) => void;
    onCaptureSnapshot: () => GraphDocument;
    onCommitSnapshot: (label: string, before: GraphDocument) => void;
    onDraftChange: (active: boolean, commit?: () => void) => void;
    onChangeGenerationMode: (mode: GenerationMode) => void;
    onRunNode: () => void;
    onCancelRun: () => void;
    onNotify: (message: string) => void;
    getReferences: () => GenerationReference[];
    connectedReferences: GenerationReference[];
    onDisconnectReference: (sourceNodeId: string, targetPort?: string, edgeId?: string) => void;
}
export type FlowNodeModel = Node<FlowNodeData, 'flowcanvas'>;
export declare const FlowNode: import("react").MemoExoticComponent<({ data, selected }: NodeProps<FlowNodeModel>) => import("react").JSX.Element>;
