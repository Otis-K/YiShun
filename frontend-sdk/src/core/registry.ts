import type { CanvasNodeData, NodeDefinition } from './types';

const normalizeDefinition = <TData extends CanvasNodeData>(definition: NodeDefinition<TData>): NodeDefinition => {
  if (!definition || typeof definition !== 'object') throw new TypeError('Node definition must be an object.');
  if (typeof definition.type !== 'string' || !definition.type.trim()) throw new Error('Node definition type is required.');
  if (typeof definition.title !== 'string' || !definition.title.trim()) throw new Error(`Node definition "${definition.type}" requires a title.`);
  if (typeof definition.category !== 'string' || !definition.category.trim()) throw new Error(`Node definition "${definition.type}" requires a category.`);
  if (!Array.isArray(definition.inputs) || !Array.isArray(definition.outputs)) {
    throw new TypeError(`Node definition "${definition.type}" requires input and output arrays.`);
  }
  if (typeof definition.createData !== 'function') {
    throw new TypeError(`Node definition "${definition.type}" requires a createData function.`);
  }
  if (definition.validate !== undefined && typeof definition.validate !== 'function') {
    throw new TypeError(`Node definition "${definition.type}" validate must be a function.`);
  }
  if (definition.execute !== undefined && typeof definition.execute !== 'function') {
    throw new TypeError(`Node definition "${definition.type}" execute must be a function.`);
  }
  const clonePorts = (ports: NodeDefinition['inputs'], direction: string) => Object.freeze(ports.map(port => {
    if (!port || typeof port !== 'object'
      || typeof port.id !== 'string' || !port.id.trim()
      || typeof port.label !== 'string' || !port.label.trim()
      || typeof port.dataType !== 'string' || !port.dataType.trim()) {
      throw new Error(`Node definition "${definition.type}" has an invalid ${direction} port.`);
    }
    if (port.required !== undefined && typeof port.required !== 'boolean') throw new TypeError(`${direction} port required must be boolean.`);
    if (port.multiple !== undefined && typeof port.multiple !== 'boolean') throw new TypeError(`${direction} port multiple must be boolean.`);
    return Object.freeze({ ...port });
  }));
  const inputs = clonePorts(definition.inputs, 'input');
  const outputs = clonePorts(definition.outputs, 'output');
  for (const [direction, ports] of [['input', inputs], ['output', outputs]] as const) {
    const ids = new Set<string>();
    for (const port of ports) {
      if (ids.has(port.id)) throw new Error(`Node definition "${definition.type}" has duplicate ${direction} port id "${port.id}".`);
      ids.add(port.id);
    }
  }
  return Object.freeze({
    ...definition,
    inputs,
    outputs,
  }) as unknown as NodeDefinition;
};

export class NodeRegistry {
  private readonly definitions = new Map<string, NodeDefinition>();
  private _revision = 0;

  get revision(): number {
    return this._revision;
  }

  register<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): () => void {
    const normalized = normalizeDefinition(definition);
    if (this.definitions.has(normalized.type)) {
      throw new Error(`Node type "${normalized.type}" is already registered.`);
    }
    this.definitions.set(normalized.type, normalized);
    this._revision += 1;
    return () => {
      if (this.definitions.get(normalized.type) === normalized) this.unregister(normalized.type);
    };
  }

  replace<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): void {
    const normalized = normalizeDefinition(definition);
    this.definitions.set(normalized.type, normalized);
    this._revision += 1;
  }

  unregister(type: string): boolean {
    const removed = this.definitions.delete(type);
    if (removed) this._revision += 1;
    return removed;
  }

  get(type: string): NodeDefinition | undefined {
    return this.definitions.get(type);
  }

  require(type: string): NodeDefinition {
    const definition = this.get(type);
    if (!definition) throw new Error(`Unknown node type "${type}".`);
    return definition;
  }

  list(): NodeDefinition[] {
    return [...this.definitions.values()];
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }
}
