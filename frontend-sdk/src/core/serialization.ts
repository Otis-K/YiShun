import { CURRENT_SCHEMA_VERSION } from './types';
import type {
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  GraphDocument,
  ViewportState,
} from './types';

export type RawGraphDocument = Record<string, unknown>;
export type GraphMigration = (document: RawGraphDocument) => RawGraphDocument;

export interface RegisterMigrationOptions {
  replace?: boolean;
}

/** A strict, adjacent-version migration chain. */
export class GraphMigrationRegistry {
  private readonly migrations = new Map<number, Array<{ token: symbol; toVersion: number; migrate: GraphMigration }>>();

  constructor(readonly targetVersion: number) {
    if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) {
      throw new TypeError('Migration target version must be a non-negative safe integer.');
    }
  }

  register(
    fromVersion: number,
    toVersion: number,
    migrate: GraphMigration,
    options: RegisterMigrationOptions = {},
  ): () => void {
    if (!Number.isSafeInteger(fromVersion) || fromVersion < 0 || toVersion !== fromVersion + 1) {
      throw new TypeError('Graph migrations must connect adjacent non-negative versions.');
    }
    if (toVersion > this.targetVersion) {
      throw new RangeError(`Migration target ${toVersion} exceeds registry target ${this.targetVersion}.`);
    }
    const layers = this.migrations.get(fromVersion) ?? [];
    if (layers.length && !options.replace) {
      throw new Error(`A graph migration from version ${fromVersion} is already registered.`);
    }
    const entry = { token: Symbol(`${fromVersion}->${toVersion}`), toVersion, migrate };
    layers.push(entry);
    this.migrations.set(fromVersion, layers);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const current = this.migrations.get(fromVersion);
      if (!current) return;
      const index = current.findIndex(layer => layer.token === entry.token);
      if (index !== -1) current.splice(index, 1);
      if (!current.length) this.migrations.delete(fromVersion);
    };
  }

  migrate(document: RawGraphDocument): RawGraphDocument {
    let current = structuredClone(document);
    let version = readVersion(current);
    if (version > this.targetVersion) {
      throw new Error(`Unsupported graph schema version: ${version}.`);
    }

    while (version < this.targetVersion) {
      const layers = this.migrations.get(version);
      const entry = layers?.[layers.length - 1];
      if (!entry) throw new Error(`Missing graph migration: ${version} -> ${version + 1}.`);
      const result = entry.migrate(structuredClone(current));
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new TypeError(`Graph migration ${version} -> ${entry.toVersion} must return an object.`);
      }
      const resultVersion = readVersion(result);
      if (resultVersion !== entry.toVersion) {
        throw new Error(
          `Graph migration ${version} -> ${entry.toVersion} returned schema version ${resultVersion}.`,
        );
      }
      current = structuredClone(result);
      version = resultVersion;
    }
    return current;
  }
}

const readVersion = (document: RawGraphDocument): number => {
  const rawVersion = document.schemaVersion;
  if (rawVersion === undefined) return 0;
  if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion < 0) {
    throw new TypeError(`Invalid graph schema version: ${String(document.schemaVersion)}.`);
  }
  return rawVersion;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requireRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  return value;
};

const requireString = (value: unknown, path: string, allowEmpty = false): string => {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new TypeError(`${path} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
};

const requireFinite = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
};

const requireJsonValue = (value: unknown, path: string, ancestors = new Set<object>()): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-JSON value.`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a circular reference.`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    const allowedKeys = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`${path}[${index}] is a sparse array slot and cannot be represented without coercion.`);
      }
      allowedKeys.add(String(index));
      requireJsonValue(value[index], `${path}[${index}]`, ancestors);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length' || (typeof key === 'string' && allowedKeys.has(key))) continue;
      throw new TypeError(`${path} contains a non-JSON array property.`);
    }
  } else {
    const record = requireRecord(value, path);
    if (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects.`);
    }
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== 'string') throw new TypeError(`${path} contains a non-JSON symbol property.`);
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${path}.${key} is not a plain enumerable JSON property.`);
      }
      requireJsonValue(descriptor.value, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
};

/** Validates values stored in a graph so export can never silently lose data. */
export function assertJsonSerializable(value: unknown, path = 'value'): void {
  requireJsonValue(value, path);
}

const parseNode = (value: unknown, index: number): CanvasNode => {
  const path = `nodes[${index}]`;
  const node = requireRecord(value, path);
  const position = requireRecord(node.position, `${path}.position`);
  const data = requireRecord(node.data, `${path}.data`);
  requireJsonValue(data, `${path}.data`);
  requireString(data.title, `${path}.data.title`, true);

  const parsed: CanvasNode = {
    id: requireString(node.id, `${path}.id`),
    type: requireString(node.type, `${path}.type`),
    position: {
      x: requireFinite(position.x, `${path}.position.x`),
      y: requireFinite(position.y, `${path}.position.y`),
    },
    data: structuredClone(data) as CanvasNodeData,
  };
  if (node.width !== undefined) {
    parsed.width = requireFinite(node.width, `${path}.width`);
    if (parsed.width <= 0) throw new RangeError(`${path}.width must be greater than zero.`);
  }
  if (node.height !== undefined) {
    parsed.height = requireFinite(node.height, `${path}.height`);
    if (parsed.height <= 0) throw new RangeError(`${path}.height must be greater than zero.`);
  }
  if (node.parentId !== undefined) parsed.parentId = requireString(node.parentId, `${path}.parentId`);
  if (node.locked !== undefined) {
    if (typeof node.locked !== 'boolean') throw new TypeError(`${path}.locked must be a boolean.`);
    parsed.locked = node.locked;
  }
  return parsed;
};

const parseEdge = (value: unknown, index: number): CanvasEdge => {
  const path = `edges[${index}]`;
  const edge = requireRecord(value, path);
  const parsed: CanvasEdge = {
    id: requireString(edge.id, `${path}.id`),
    source: requireString(edge.source, `${path}.source`),
    sourcePort: requireString(edge.sourcePort, `${path}.sourcePort`),
    target: requireString(edge.target, `${path}.target`),
    targetPort: requireString(edge.targetPort, `${path}.targetPort`),
  };
  if (edge.label !== undefined) parsed.label = requireString(edge.label, `${path}.label`, true);
  if (edge.data !== undefined) {
    const data = requireRecord(edge.data, `${path}.data`);
    requireJsonValue(data, `${path}.data`);
    parsed.data = structuredClone(data);
  }
  return parsed;
};

const parseViewport = (value: unknown): ViewportState => {
  const viewport = requireRecord(value, 'viewport');
  const zoom = requireFinite(viewport.zoom, 'viewport.zoom');
  if (zoom <= 0) throw new RangeError('viewport.zoom must be greater than zero.');
  return {
    x: requireFinite(viewport.x, 'viewport.x'),
    y: requireFinite(viewport.y, 'viewport.y'),
    zoom,
  };
};

const defaultMigrations = new GraphMigrationRegistry(CURRENT_SCHEMA_VERSION);
defaultMigrations.register(0, 1, document => ({
  ...document,
  schemaVersion: 1,
  viewport: document.viewport ?? { x: 0, y: 0, zoom: 1 },
  metadata: document.metadata ?? {},
}));

/** Registers a migration used by deserializeGraph. Chains must be 0->1->2, without gaps. */
export function registerGraphMigration(
  fromVersion: number,
  toVersion: number,
  migrate: GraphMigration,
  options: RegisterMigrationOptions = {},
): () => void {
  return defaultMigrations.register(fromVersion, toVersion, migrate, options);
}

export function cloneGraph(graph: GraphDocument): GraphDocument {
  return structuredClone(graph);
}

export function createEmptyGraph(name = '未命名工作流'): GraphDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    metadata: {},
  };
}

export function serializeGraph(graph: GraphDocument, space = 2): string {
  if (!Number.isSafeInteger(space) || space < 0 || space > 10) {
    throw new RangeError('JSON indentation must be an integer between 0 and 10.');
  }
  // Run the same strict boundary used by imports so Date/BigInt/undefined,
  // circular values, and malformed positions cannot be silently transformed
  // by JSON.stringify into a different workflow.
  return JSON.stringify(deserializeGraph(graph), null, space);
}

export function deserializeGraph(
  input: string | GraphDocument | RawGraphDocument,
  migrations: GraphMigrationRegistry = defaultMigrations,
): GraphDocument {
  const parsed: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Graph document must be an object.');
  }
  if (migrations.targetVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Deserializer requires migration target ${CURRENT_SCHEMA_VERSION}, received ${migrations.targetVersion}.`,
    );
  }

  const migrated = migrations.migrate(parsed as RawGraphDocument);
  if (!Array.isArray(migrated.nodes) || !Array.isArray(migrated.edges)) {
    throw new Error('Graph document requires nodes and edges arrays.');
  }

  const nodes = migrated.nodes.map(parseNode);
  const edges = migrated.edges.map(parseEdge);
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Duplicate node id in graph document: ${node.id}.`);
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) throw new Error(`Duplicate edge id in graph document: ${edge.id}.`);
    edgeIds.add(edge.id);
  }
  const metadata = requireRecord(migrated.metadata ?? {}, 'metadata');
  requireJsonValue(metadata, 'metadata');

  return cloneGraph({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: migrated.id === undefined ? crypto.randomUUID() : requireString(migrated.id, 'id'),
    name: migrated.name === undefined
      ? '未命名工作流'
      : requireString(migrated.name, 'name', true),
    nodes,
    edges,
    viewport: parseViewport(migrated.viewport ?? { x: 0, y: 0, zoom: 1 }),
    metadata: structuredClone(metadata),
  });
}
