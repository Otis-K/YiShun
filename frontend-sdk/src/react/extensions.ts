import type { ComponentType } from 'react';
import type { CanvasEngine } from '../core/engine';
import type { CanvasNode, DeepReadonly, NodeDefinition, PortDefinition, ValidationIssue } from '../core/types';

export type FlowCanvasReadonlyNode = DeepReadonly<CanvasNode>;
export type FlowCanvasReadonlyDefinition = Readonly<Omit<NodeDefinition, 'inputs' | 'outputs'>> & {
  readonly inputs: readonly Readonly<PortDefinition>[];
  readonly outputs: readonly Readonly<PortDefinition>[];
};

export interface FlowCanvasNodeRendererProps {
  node: FlowCanvasReadonlyNode;
  definition: FlowCanvasReadonlyDefinition;
  selected: boolean;
  readOnly: boolean;
}

export type FlowCanvasNodeRenderer = ComponentType<FlowCanvasNodeRendererProps>;

export interface FlowCanvasInspectorRendererProps {
  engine: CanvasEngine;
  node: FlowCanvasReadonlyNode;
  definition: FlowCanvasReadonlyDefinition;
  issues: readonly DeepReadonly<ValidationIssue>[];
  readOnly: boolean;
}

export type FlowCanvasInspectorRenderer = ComponentType<FlowCanvasInspectorRendererProps>;

export interface FlowCanvasRenderers {
  nodes?: Record<string, FlowCanvasNodeRenderer>;
  inspectors?: Record<string, FlowCanvasInspectorRenderer>;
}
