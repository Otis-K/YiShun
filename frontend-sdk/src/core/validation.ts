import { analyzeTopology } from './topology';
import type {
  CanvasEdge,
  CanvasNode,
  GraphDocument,
  ValidationIssue,
  ValidationResult,
} from './types';
import type { NodeRegistry } from './registry';

const compatible = (source: string, target: string) => source === 'any' || target === 'any' || source === target;

export function validateGraph(graph: GraphDocument, registry: NodeRegistry): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeMap = new Map<string, CanvasNode>();
  const edgeIds = new Set<string>();

  for (const node of graph.nodes) {
    if (nodeMap.has(node.id)) {
      issues.push({ code: 'DUPLICATE_NODE_ID', severity: 'error', message: `节点 ID 重复：${node.id}`, nodeId: node.id });
      continue;
    }
    nodeMap.set(node.id, node);
    const definition = registry.get(node.type);
    if (!definition) {
      issues.push({ code: 'UNKNOWN_NODE_TYPE', severity: 'error', message: `未注册节点类型：${node.type}`, nodeId: node.id });
    } else {
      // Validators are host/plugin code. Give them an isolated node so an
      // accidental or malicious write cannot mutate engine state during validation.
      try {
        const pluginIssues = definition.validate?.(structuredClone(node)) ?? [];
        if (!Array.isArray(pluginIssues)) throw new TypeError('Node validator must return an array.');
        for (const issue of pluginIssues) {
          if (!issue || typeof issue !== 'object'
            || typeof issue.code !== 'string'
            || !['error', 'warning'].includes(issue.severity)
            || typeof issue.message !== 'string') {
            throw new TypeError('Node validator returned a malformed issue.');
          }
          issues.push(structuredClone({ ...issue, nodeId: issue.nodeId ?? node.id }));
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        issues.push({
          code: 'NODE_CONFIGURATION_INVALID',
          severity: 'error',
          message: `节点校验器异常：${error.message}`,
          nodeId: node.id,
          details: { validatorError: error.message },
        });
      }
    }
  }

  const connections = new Set<string>();
  const incomingByPort = new Map<string, CanvasEdge[]>();

  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({ code: 'DUPLICATE_EDGE_ID', severity: 'error', message: `连线 ID 重复：${edge.id}`, edgeId: edge.id });
    }
    edgeIds.add(edge.id);

    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source) issues.push({ code: 'MISSING_SOURCE_NODE', severity: 'error', message: `找不到源节点：${edge.source}`, edgeId: edge.id });
    if (!target) issues.push({ code: 'MISSING_TARGET_NODE', severity: 'error', message: `找不到目标节点：${edge.target}`, edgeId: edge.id });
    if (!source || !target) continue;

    if (source.id === target.id) {
      issues.push({ code: 'SELF_CONNECTION', severity: 'error', message: '节点不能连接自身', edgeId: edge.id, nodeId: source.id });
    }

    const connectionKey = `${edge.source}:${edge.sourcePort}->${edge.target}:${edge.targetPort}`;
    if (connections.has(connectionKey)) {
      issues.push({ code: 'DUPLICATE_CONNECTION', severity: 'error', message: '存在重复连线', edgeId: edge.id });
    }
    connections.add(connectionKey);

    const sourceDefinition = registry.get(source.type);
    const targetDefinition = registry.get(target.type);
    const sourcePort = sourceDefinition?.outputs.find(port => port.id === edge.sourcePort);
    const targetPort = targetDefinition?.inputs.find(port => port.id === edge.targetPort);
    if (!sourcePort) issues.push({ code: 'MISSING_SOURCE_PORT', severity: 'error', message: `源端口不存在：${edge.sourcePort}`, edgeId: edge.id, nodeId: source.id, portId: edge.sourcePort });
    if (!targetPort) issues.push({ code: 'MISSING_TARGET_PORT', severity: 'error', message: `目标端口不存在：${edge.targetPort}`, edgeId: edge.id, nodeId: target.id, portId: edge.targetPort });
    if (sourcePort && targetPort && !compatible(sourcePort.dataType, targetPort.dataType)) {
      issues.push({
        code: 'PORT_TYPE_MISMATCH',
        severity: 'error',
        message: `端口类型不兼容：${sourcePort.dataType} → ${targetPort.dataType}`,
        edgeId: edge.id,
        details: { sourceType: sourcePort.dataType, targetType: targetPort.dataType },
      });
    }

    const incomingKey = `${target.id}:${edge.targetPort}`;
    const incoming = incomingByPort.get(incomingKey) ?? [];
    incoming.push(edge);
    incomingByPort.set(incomingKey, incoming);
    if (targetPort && !targetPort.multiple && incoming.length > 1) {
      issues.push({ code: 'PORT_CARDINALITY', severity: 'error', message: `端口只允许一个输入：${targetPort.label}`, edgeId: edge.id, nodeId: target.id, portId: targetPort.id });
    }
  }

  for (const node of graph.nodes) {
    const definition = registry.get(node.type);
    for (const port of definition?.inputs ?? []) {
      if (port.required && !(incomingByPort.get(`${node.id}:${port.id}`)?.length)) {
        issues.push({ code: 'REQUIRED_INPUT_MISSING', severity: 'error', message: `缺少必填输入：${port.label}`, nodeId: node.id, portId: port.id });
      }
    }
  }

  const topology = analyzeTopology(graph);
  if (topology.cyclicNodeIds.length) {
    issues.push({
      code: 'CYCLE_DETECTED',
      severity: 'error',
      message: `工作流包含环路：${topology.cyclicNodeIds.join(', ')}`,
      details: { nodeIds: topology.cyclicNodeIds },
    });
  }

  return { valid: !issues.some(issue => issue.severity === 'error'), issues };
}

export class GraphValidationError extends Error {
  constructor(public readonly result: ValidationResult) {
    super(result.issues.map(issue => issue.message).join('; '));
    this.name = 'GraphValidationError';
  }
}
