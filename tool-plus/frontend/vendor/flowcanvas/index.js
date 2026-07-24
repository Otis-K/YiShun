import { createRoot as e } from "react-dom/client";
import { Component as t, memo as n, useCallback as r, useEffect as i, useId as a, useMemo as o, useRef as s, useState as c, useSyncExternalStore as l } from "react";
import { Background as u, BackgroundVariant as d, ConnectionMode as f, Handle as p, MiniMap as m, Position as h, ReactFlow as g, ReactFlowProvider as _, SelectionMode as v, useReactFlow as y, useViewport as b } from "@xyflow/react";
import { ArrowRight as x, ArrowUp as ee, AtSign as S, AudioLines as te, Bot as ne, Boxes as C, Check as w, CheckCircle2 as re, ChevronDown as T, CircleCheck as E, CirclePlay as ie, Clapperboard as ae, CopyPlus as D, DatabaseZap as O, Download as oe, FilePlus2 as se, FileText as ce, FileUp as le, Hand as k, Image as ue, LoaderCircle as de, Maximize as fe, Maximize2 as pe, Minimize2 as me, Minus as he, Moon as ge, MousePointer2 as _e, PanelLeftClose as ve, PanelLeftOpen as ye, PanelRight as be, PanelTopClose as xe, Pause as Se, Play as Ce, Plus as we, Redo2 as Te, RotateCcw as Ee, Send as De, Sparkles as Oe, SquarePlus as ke, Sun as Ae, Trash2 as je, Undo2 as Me, Unlink2 as Ne, Upload as Pe, WandSparkles as Fe, X as Ie } from "lucide-react";
import { createPortal as Le } from "react-dom";
import { Fragment as A, jsx as j, jsxs as M } from "react/jsx-runtime";
//#region src/core/types.ts
var N = 1, Re = class {
	targetVersion;
	migrations = /* @__PURE__ */ new Map();
	constructor(e) {
		if (this.targetVersion = e, !Number.isSafeInteger(e) || e < 0) throw TypeError("Migration target version must be a non-negative safe integer.");
	}
	register(e, t, n, r = {}) {
		if (!Number.isSafeInteger(e) || e < 0 || t !== e + 1) throw TypeError("Graph migrations must connect adjacent non-negative versions.");
		if (t > this.targetVersion) throw RangeError(`Migration target ${t} exceeds registry target ${this.targetVersion}.`);
		let i = this.migrations.get(e) ?? [];
		if (i.length && !r.replace) throw Error(`A graph migration from version ${e} is already registered.`);
		let a = {
			token: Symbol(`${e}->${t}`),
			toVersion: t,
			migrate: n
		};
		i.push(a), this.migrations.set(e, i);
		let o = !1;
		return () => {
			if (o) return;
			o = !0;
			let t = this.migrations.get(e);
			if (!t) return;
			let n = t.findIndex((e) => e.token === a.token);
			n !== -1 && t.splice(n, 1), t.length || this.migrations.delete(e);
		};
	}
	migrate(e) {
		let t = structuredClone(e), n = ze(t);
		if (n > this.targetVersion) throw Error(`Unsupported graph schema version: ${n}.`);
		for (; n < this.targetVersion;) {
			let e = this.migrations.get(n), r = e?.[e.length - 1];
			if (!r) throw Error(`Missing graph migration: ${n} -> ${n + 1}.`);
			let i = r.migrate(structuredClone(t));
			if (!i || typeof i != "object" || Array.isArray(i)) throw TypeError(`Graph migration ${n} -> ${r.toVersion} must return an object.`);
			let a = ze(i);
			if (a !== r.toVersion) throw Error(`Graph migration ${n} -> ${r.toVersion} returned schema version ${a}.`);
			t = structuredClone(i), n = a;
		}
		return t;
	}
}, ze = (e) => {
	let t = e.schemaVersion;
	if (t === void 0) return 0;
	if (typeof t != "number" || !Number.isSafeInteger(t) || t < 0) throw TypeError(`Invalid graph schema version: ${String(e.schemaVersion)}.`);
	return t;
}, Be = (e) => !!e && typeof e == "object" && !Array.isArray(e), P = (e, t) => {
	if (!Be(e)) throw TypeError(`${t} must be an object.`);
	return e;
}, F = (e, t, n = !1) => {
	if (typeof e != "string" || !n && e.trim().length === 0) throw TypeError(`${t} must be ${n ? "a string" : "a non-empty string"}.`);
	return e;
}, I = (e, t) => {
	if (typeof e != "number" || !Number.isFinite(e)) throw TypeError(`${t} must be a finite number.`);
	return e;
}, L = (e, t, n = /* @__PURE__ */ new Set()) => {
	if (!(e === null || typeof e == "string" || typeof e == "boolean")) {
		if (typeof e == "number") {
			if (!Number.isFinite(e)) throw TypeError(`${t} contains a non-finite number.`);
			return;
		}
		if (typeof e != "object") throw TypeError(`${t} contains a non-JSON value.`);
		if (n.has(e)) throw TypeError(`${t} contains a circular reference.`);
		if (n.add(e), Array.isArray(e)) {
			let r = /* @__PURE__ */ new Set();
			for (let i = 0; i < e.length; i += 1) {
				if (!Object.prototype.hasOwnProperty.call(e, i)) throw TypeError(`${t}[${i}] is a sparse array slot and cannot be represented without coercion.`);
				r.add(String(i)), L(e[i], `${t}[${i}]`, n);
			}
			for (let n of Reflect.ownKeys(e)) if (!(n === "length" || typeof n == "string" && r.has(n))) throw TypeError(`${t} contains a non-JSON array property.`);
		} else {
			let r = P(e, t);
			if (Object.getPrototypeOf(r) !== Object.prototype && Object.getPrototypeOf(r) !== null) throw TypeError(`${t} must contain only plain JSON objects.`);
			for (let e of Reflect.ownKeys(r)) {
				if (typeof e != "string") throw TypeError(`${t} contains a non-JSON symbol property.`);
				let i = Object.getOwnPropertyDescriptor(r, e);
				if (!i?.enumerable || !("value" in i)) throw TypeError(`${t}.${e} is not a plain enumerable JSON property.`);
				L(i.value, `${t}.${e}`, n);
			}
		}
		n.delete(e);
	}
};
function Ve(e, t = "value") {
	L(e, t);
}
var He = (e, t) => {
	let n = `nodes[${t}]`, r = P(e, n), i = P(r.position, `${n}.position`), a = P(r.data, `${n}.data`);
	L(a, `${n}.data`), F(a.title, `${n}.data.title`, !0);
	let o = {
		id: F(r.id, `${n}.id`),
		type: F(r.type, `${n}.type`),
		position: {
			x: I(i.x, `${n}.position.x`),
			y: I(i.y, `${n}.position.y`)
		},
		data: structuredClone(a)
	};
	if (r.width !== void 0 && (o.width = I(r.width, `${n}.width`), o.width <= 0)) throw RangeError(`${n}.width must be greater than zero.`);
	if (r.height !== void 0 && (o.height = I(r.height, `${n}.height`), o.height <= 0)) throw RangeError(`${n}.height must be greater than zero.`);
	if (r.parentId !== void 0 && (o.parentId = F(r.parentId, `${n}.parentId`)), r.locked !== void 0) {
		if (typeof r.locked != "boolean") throw TypeError(`${n}.locked must be a boolean.`);
		o.locked = r.locked;
	}
	return o;
}, R = (e, t) => {
	let n = `edges[${t}]`, r = P(e, n), i = {
		id: F(r.id, `${n}.id`),
		source: F(r.source, `${n}.source`),
		sourcePort: F(r.sourcePort, `${n}.sourcePort`),
		target: F(r.target, `${n}.target`),
		targetPort: F(r.targetPort, `${n}.targetPort`)
	};
	if (r.label !== void 0 && (i.label = F(r.label, `${n}.label`, !0)), r.data !== void 0) {
		let e = P(r.data, `${n}.data`);
		L(e, `${n}.data`), i.data = structuredClone(e);
	}
	return i;
}, z = (e) => {
	let t = P(e, "viewport"), n = I(t.zoom, "viewport.zoom");
	if (n <= 0) throw RangeError("viewport.zoom must be greater than zero.");
	return {
		x: I(t.x, "viewport.x"),
		y: I(t.y, "viewport.y"),
		zoom: n
	};
}, Ue = new Re(1);
Ue.register(0, 1, (e) => ({
	...e,
	schemaVersion: 1,
	viewport: e.viewport ?? {
		x: 0,
		y: 0,
		zoom: 1
	},
	metadata: e.metadata ?? {}
}));
function We(e, t, n, r = {}) {
	return Ue.register(e, t, n, r);
}
function B(e) {
	return structuredClone(e);
}
function V(e = "未命名工作流") {
	return {
		schemaVersion: 1,
		id: crypto.randomUUID(),
		name: e,
		nodes: [],
		edges: [],
		viewport: {
			x: 0,
			y: 0,
			zoom: 1
		},
		metadata: {}
	};
}
function Ge(e, t = 2) {
	if (!Number.isSafeInteger(t) || t < 0 || t > 10) throw RangeError("JSON indentation must be an integer between 0 and 10.");
	return JSON.stringify(H(e), null, t);
}
function H(e, t = Ue) {
	let n = typeof e == "string" ? JSON.parse(e) : e;
	if (!n || typeof n != "object" || Array.isArray(n)) throw Error("Graph document must be an object.");
	if (t.targetVersion !== 1) throw Error(`Deserializer requires migration target 1, received ${t.targetVersion}.`);
	let r = t.migrate(n);
	if (!Array.isArray(r.nodes) || !Array.isArray(r.edges)) throw Error("Graph document requires nodes and edges arrays.");
	let i = r.nodes.map(He), a = r.edges.map(R), o = /* @__PURE__ */ new Set();
	for (let e of i) {
		if (o.has(e.id)) throw Error(`Duplicate node id in graph document: ${e.id}.`);
		o.add(e.id);
	}
	let s = /* @__PURE__ */ new Set();
	for (let e of a) {
		if (s.has(e.id)) throw Error(`Duplicate edge id in graph document: ${e.id}.`);
		s.add(e.id);
	}
	let c = P(r.metadata ?? {}, "metadata");
	return L(c, "metadata"), B({
		schemaVersion: 1,
		id: r.id === void 0 ? crypto.randomUUID() : F(r.id, "id"),
		name: r.name === void 0 ? "未命名工作流" : F(r.name, "name", !0),
		nodes: i,
		edges: a,
		viewport: z(r.viewport ?? {
			x: 0,
			y: 0,
			zoom: 1
		}),
		metadata: structuredClone(c)
	});
}
//#endregion
//#region src/autosave.ts
var U = class extends Error {
	status;
	code = "AUTOSAVE_FLUSH_FAILED";
	constructor(e) {
		super(e.error ? `Autosave flush failed: ${e.error}` : `Autosave flush did not persist revision ${e.revision}.`), this.status = e, this.name = "AutosaveFlushError";
	}
}, Ke = class {
	options;
	timer;
	queuedGraph;
	queuedRevision = 0;
	revision = 0;
	savedRevision = 0;
	currentState = "idle";
	lastError;
	chain = Promise.resolve();
	destroyed = !1;
	abortController = new AbortController();
	constructor(e) {
		this.options = e;
	}
	schedule(e) {
		return this.destroyed ? this.revision : (this.revision += 1, this.queuedRevision = this.revision, this.queuedGraph = B(e), this.timer && clearTimeout(this.timer), this.timer = setTimeout(() => this.enqueuePending(), Math.max(0, this.options.delay ?? 500)), this.emit("pending"), this.revision);
	}
	async flush() {
		this.timer &&= (clearTimeout(this.timer), void 0);
		let e = this.revision;
		this.enqueuePending(), await this.chain;
		let t = this.getStatus();
		if (t.savedRevision < e) throw new U(t);
		return t;
	}
	getStatus() {
		return {
			state: this.currentState,
			revision: this.revision,
			savedRevision: this.savedRevision,
			error: this.lastError
		};
	}
	destroy() {
		this.destroyed = !0, this.timer && clearTimeout(this.timer), this.timer = void 0, this.queuedGraph = void 0, this.abortController.abort();
	}
	enqueuePending() {
		if (this.destroyed || !this.queuedGraph) return;
		let e = this.queuedGraph, t = this.queuedRevision;
		this.queuedGraph = void 0, this.timer = void 0, this.chain = this.chain.catch(() => void 0).then(async () => {
			if (!this.destroyed) {
				this.emit("saving", t);
				try {
					if (await this.options.save(e, {
						revision: t,
						signal: this.abortController.signal
					}), this.destroyed || this.abortController.signal.aborted) return;
					this.savedRevision = Math.max(this.savedRevision, t), this.queuedGraph || this.savedRevision < this.revision ? this.emit("pending") : this.emit("saved", t);
				} catch (n) {
					if (this.destroyed && this.abortController.signal.aborted) return;
					let r = n instanceof Error ? n : Error(String(n));
					this.revision === t && (!this.queuedGraph || this.queuedRevision <= t) && (this.queuedGraph = e, this.queuedRevision = t), this.emit("error", t, r), this.reportError(r);
				}
			}
		});
	}
	emit(e, t = this.revision, n) {
		this.currentState = e, this.lastError = n?.message;
		let r = {
			state: e,
			revision: t,
			savedRevision: this.savedRevision,
			error: n?.message
		};
		try {
			this.options.onStatus?.(r);
		} catch (e) {
			this.reportError(e instanceof Error ? e : Error(String(e)));
		}
	}
	reportError(e) {
		try {
			this.options.onError?.(e);
		} catch {}
	}
}, qe = class {
	listeners = /* @__PURE__ */ new Map();
	on(e, t) {
		let n = this.listeners.get(e) ?? /* @__PURE__ */ new Set();
		return n.add(t), this.listeners.set(e, n), () => this.off(e, t);
	}
	off(e, t) {
		this.listeners.get(e)?.delete(t);
	}
	hasListeners(e) {
		return (this.listeners.get(e)?.size ?? 0) > 0;
	}
	emit(e, t) {
		for (let n of [...this.listeners.get(e) ?? []]) try {
			n(this.clonePayload(e, t));
		} catch (t) {
			if (e !== "error") {
				let n = t instanceof Error ? t : Error(String(t));
				this.emit("error", {
					error: n,
					source: `event-listener:${e}`
				});
			}
		}
	}
	clear() {
		this.listeners.clear();
	}
	clonePayload(e, t) {
		if (e !== "error") return structuredClone(t);
		let n = t, r = n.error, i = Object.assign(Error(r.message), structuredClone({ ...r }));
		return i.name = r.name, i.stack = r.stack, {
			error: i,
			source: n.source
		};
	}
}, W = class {
	limit;
	undoStack = [];
	redoStack = [];
	constructor(e = 100) {
		this.limit = e;
	}
	push(e) {
		this.undoStack.push(e), this.undoStack.length > this.limit && this.undoStack.shift(), this.redoStack = [];
	}
	undo() {
		let e = this.undoStack.pop();
		return e ? (e.undo(), this.redoStack.push(e), !0) : !1;
	}
	redo() {
		let e = this.redoStack.pop();
		return e ? (e.redo(), this.undoStack.push(e), !0) : !1;
	}
	clear() {
		this.undoStack = [], this.redoStack = [];
	}
	get canUndo() {
		return this.undoStack.length > 0;
	}
	get canRedo() {
		return this.redoStack.length > 0;
	}
	get undoLabel() {
		return this.undoStack.at(-1)?.label;
	}
	get redoLabel() {
		return this.redoStack.at(-1)?.label;
	}
}, Je = (e) => {
	if (!e || typeof e != "object") throw TypeError("Node definition must be an object.");
	if (typeof e.type != "string" || !e.type.trim()) throw Error("Node definition type is required.");
	if (typeof e.title != "string" || !e.title.trim()) throw Error(`Node definition "${e.type}" requires a title.`);
	if (typeof e.category != "string" || !e.category.trim()) throw Error(`Node definition "${e.type}" requires a category.`);
	if (!Array.isArray(e.inputs) || !Array.isArray(e.outputs)) throw TypeError(`Node definition "${e.type}" requires input and output arrays.`);
	if (typeof e.createData != "function") throw TypeError(`Node definition "${e.type}" requires a createData function.`);
	if (e.validate !== void 0 && typeof e.validate != "function") throw TypeError(`Node definition "${e.type}" validate must be a function.`);
	if (e.execute !== void 0 && typeof e.execute != "function") throw TypeError(`Node definition "${e.type}" execute must be a function.`);
	let t = (t, n) => Object.freeze(t.map((t) => {
		if (!t || typeof t != "object" || typeof t.id != "string" || !t.id.trim() || typeof t.label != "string" || !t.label.trim() || typeof t.dataType != "string" || !t.dataType.trim()) throw Error(`Node definition "${e.type}" has an invalid ${n} port.`);
		if (t.required !== void 0 && typeof t.required != "boolean") throw TypeError(`${n} port required must be boolean.`);
		if (t.multiple !== void 0 && typeof t.multiple != "boolean") throw TypeError(`${n} port multiple must be boolean.`);
		return Object.freeze({ ...t });
	})), n = t(e.inputs, "input"), r = t(e.outputs, "output");
	for (let [t, i] of [["input", n], ["output", r]]) {
		let n = /* @__PURE__ */ new Set();
		for (let r of i) {
			if (n.has(r.id)) throw Error(`Node definition "${e.type}" has duplicate ${t} port id "${r.id}".`);
			n.add(r.id);
		}
	}
	return Object.freeze({
		...e,
		inputs: n,
		outputs: r
	});
}, G = class {
	definitions = /* @__PURE__ */ new Map();
	_revision = 0;
	get revision() {
		return this._revision;
	}
	register(e) {
		let t = Je(e);
		if (this.definitions.has(t.type)) throw Error(`Node type "${t.type}" is already registered.`);
		return this.definitions.set(t.type, t), this._revision += 1, () => {
			this.definitions.get(t.type) === t && this.unregister(t.type);
		};
	}
	replace(e) {
		let t = Je(e);
		this.definitions.set(t.type, t), this._revision += 1;
	}
	unregister(e) {
		let t = this.definitions.delete(e);
		return t && (this._revision += 1), t;
	}
	get(e) {
		return this.definitions.get(e);
	}
	require(e) {
		let t = this.get(e);
		if (!t) throw Error(`Unknown node type "${e}".`);
		return t;
	}
	list() {
		return [...this.definitions.values()];
	}
	has(e) {
		return this.definitions.has(e);
	}
}, K = (e, t) => e.x <= t.x + t.width && e.x + e.width >= t.x && e.y <= t.y + t.height && e.y + e.height >= t.y, q = (e) => {
	for (let [t, n] of Object.entries(e)) if (!Number.isFinite(n)) throw RangeError(`Spatial rectangle ${t} must be finite.`);
	let t = e.width, n = e.height;
	return {
		x: t < 0 ? e.x + t : e.x,
		y: n < 0 ? e.y + n : e.y,
		width: Math.abs(t),
		height: Math.abs(n)
	};
}, Ye = class {
	cells = /* @__PURE__ */ new Map();
	entries = /* @__PURE__ */ new Map();
	entryCells = /* @__PURE__ */ new Map();
	oversizedEntries = /* @__PURE__ */ new Set();
	cellSize;
	defaultNodeWidth;
	defaultNodeHeight;
	constructor(e = {}) {
		let t = e.cellSize ?? 512, n = e.defaultNodeWidth ?? 280, r = e.defaultNodeHeight ?? 180;
		if (!Number.isFinite(t) || t <= 0) throw RangeError("Spatial cellSize must be finite and greater than zero.");
		if (!Number.isFinite(n) || n < 0) throw RangeError("Default node width must be finite and non-negative.");
		if (!Number.isFinite(r) || r < 0) throw RangeError("Default node height must be finite and non-negative.");
		this.cellSize = Math.max(32, Math.floor(t)), this.defaultNodeWidth = n, this.defaultNodeHeight = r;
	}
	get size() {
		return this.entries.size;
	}
	clear() {
		this.cells.clear(), this.entries.clear(), this.entryCells.clear(), this.oversizedEntries.clear();
	}
	rebuild(e) {
		this.clear();
		for (let t of e) this.upsert(t);
	}
	upsert(e) {
		this.remove(e.id);
		let t = q({
			x: e.position.x,
			y: e.position.y,
			width: e.width ?? this.defaultNodeWidth,
			height: e.height ?? this.defaultNodeHeight
		}), n = this.keysFor(t, 4096);
		if (this.entries.set(e.id, t), !n) {
			this.entryCells.set(e.id, []), this.oversizedEntries.add(e.id);
			return;
		}
		this.entryCells.set(e.id, n);
		for (let t of n) {
			let n = this.cells.get(t) ?? /* @__PURE__ */ new Set();
			n.add(e.id), this.cells.set(t, n);
		}
	}
	remove(e) {
		if (!this.entries.has(e)) return !1;
		for (let t of this.entryCells.get(e) ?? []) {
			let n = this.cells.get(t);
			n?.delete(e), n?.size === 0 && this.cells.delete(t);
		}
		return this.entries.delete(e), this.entryCells.delete(e), this.oversizedEntries.delete(e), !0;
	}
	query(e) {
		let t = q(e), n = this.keysFor(t, 1e5);
		if (!n) return [...this.entries].filter(([, e]) => K(e, t)).map(([e]) => e);
		let r = /* @__PURE__ */ new Set();
		for (let e of this.oversizedEntries) r.add(e);
		for (let e of n) for (let t of this.cells.get(e) ?? []) r.add(t);
		return [...r].filter((e) => K(this.entries.get(e), t));
	}
	keysFor(e, t) {
		let n = Math.floor(e.x / this.cellSize), r = Math.floor(e.y / this.cellSize), i = Math.floor((e.x + e.width) / this.cellSize), a = Math.floor((e.y + e.height) / this.cellSize), o = i - n + 1, s = a - r + 1;
		if (!Number.isSafeInteger(o) || !Number.isSafeInteger(s) || o * s > t) return;
		let c = [];
		for (let e = n; e <= i; e += 1) for (let t = r; t <= a; t += 1) c.push(`${e}:${t}`);
		return c;
	}
};
//#endregion
//#region src/core/topology.ts
function Xe(e) {
	let t = new Set(e.nodes.map((e) => e.id)), n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
	for (let e of t) n.set(e, 0), r.set(e, []);
	for (let i of e.edges) !t.has(i.source) || !t.has(i.target) || (r.get(i.source)?.push(i), n.set(i.target, (n.get(i.target) ?? 0) + 1));
	let i = [...t].filter((e) => n.get(e) === 0), a = [], o = [], s = /* @__PURE__ */ new Set();
	for (; i.length;) {
		let e = i;
		o.push(e);
		let t = [];
		for (let i of e) {
			a.push(i), s.add(i);
			for (let e of r.get(i) ?? []) {
				let r = (n.get(e.target) ?? 0) - 1;
				n.set(e.target, r), r === 0 && t.push(e.target);
			}
		}
		i = t;
	}
	return {
		order: a,
		layers: o,
		cyclicNodeIds: [...t].filter((e) => !s.has(e))
	};
}
function J(e, t, n) {
	if (t === n) return !0;
	let r = /* @__PURE__ */ new Map();
	for (let t of e.nodes) r.set(t.id, []);
	for (let t of e.edges) r.get(t.source)?.push(t.target);
	r.get(t)?.push(n);
	let i = [n], a = /* @__PURE__ */ new Set();
	for (; i.length;) {
		let e = i.pop();
		if (e === t) return !0;
		a.has(e) || (a.add(e), i.push(...r.get(e) ?? []));
	}
	return !1;
}
//#endregion
//#region src/core/validation.ts
var Ze = (e, t) => e === "any" || t === "any" || e === t;
function Qe(e, t) {
	let n = [], r = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Set();
	for (let i of e.nodes) {
		if (r.has(i.id)) {
			n.push({
				code: "DUPLICATE_NODE_ID",
				severity: "error",
				message: `节点 ID 重复：${i.id}`,
				nodeId: i.id
			});
			continue;
		}
		r.set(i.id, i);
		let e = t.get(i.type);
		if (!e) n.push({
			code: "UNKNOWN_NODE_TYPE",
			severity: "error",
			message: `未注册节点类型：${i.type}`,
			nodeId: i.id
		});
		else try {
			let t = e.validate?.(structuredClone(i)) ?? [];
			if (!Array.isArray(t)) throw TypeError("Node validator must return an array.");
			for (let e of t) {
				if (!e || typeof e != "object" || typeof e.code != "string" || !["error", "warning"].includes(e.severity) || typeof e.message != "string") throw TypeError("Node validator returned a malformed issue.");
				n.push(structuredClone({
					...e,
					nodeId: e.nodeId ?? i.id
				}));
			}
		} catch (e) {
			let t = e instanceof Error ? e : Error(String(e));
			n.push({
				code: "NODE_CONFIGURATION_INVALID",
				severity: "error",
				message: `节点校验器异常：${t.message}`,
				nodeId: i.id,
				details: { validatorError: t.message }
			});
		}
	}
	let a = /* @__PURE__ */ new Set(), o = /* @__PURE__ */ new Map();
	for (let s of e.edges) {
		i.has(s.id) && n.push({
			code: "DUPLICATE_EDGE_ID",
			severity: "error",
			message: `连线 ID 重复：${s.id}`,
			edgeId: s.id
		}), i.add(s.id);
		let e = r.get(s.source), c = r.get(s.target);
		if (e || n.push({
			code: "MISSING_SOURCE_NODE",
			severity: "error",
			message: `找不到源节点：${s.source}`,
			edgeId: s.id
		}), c || n.push({
			code: "MISSING_TARGET_NODE",
			severity: "error",
			message: `找不到目标节点：${s.target}`,
			edgeId: s.id
		}), !e || !c) continue;
		e.id === c.id && n.push({
			code: "SELF_CONNECTION",
			severity: "error",
			message: "节点不能连接自身",
			edgeId: s.id,
			nodeId: e.id
		});
		let l = `${s.source}:${s.sourcePort}->${s.target}:${s.targetPort}`;
		a.has(l) && n.push({
			code: "DUPLICATE_CONNECTION",
			severity: "error",
			message: "存在重复连线",
			edgeId: s.id
		}), a.add(l);
		let u = t.get(e.type), d = t.get(c.type), f = u?.outputs.find((e) => e.id === s.sourcePort), p = d?.inputs.find((e) => e.id === s.targetPort);
		f || n.push({
			code: "MISSING_SOURCE_PORT",
			severity: "error",
			message: `源端口不存在：${s.sourcePort}`,
			edgeId: s.id,
			nodeId: e.id,
			portId: s.sourcePort
		}), p || n.push({
			code: "MISSING_TARGET_PORT",
			severity: "error",
			message: `目标端口不存在：${s.targetPort}`,
			edgeId: s.id,
			nodeId: c.id,
			portId: s.targetPort
		}), f && p && !Ze(f.dataType, p.dataType) && n.push({
			code: "PORT_TYPE_MISMATCH",
			severity: "error",
			message: `端口类型不兼容：${f.dataType} → ${p.dataType}`,
			edgeId: s.id,
			details: {
				sourceType: f.dataType,
				targetType: p.dataType
			}
		});
		let m = `${c.id}:${s.targetPort}`, h = o.get(m) ?? [];
		h.push(s), o.set(m, h), p && !p.multiple && h.length > 1 && n.push({
			code: "PORT_CARDINALITY",
			severity: "error",
			message: `端口只允许一个输入：${p.label}`,
			edgeId: s.id,
			nodeId: c.id,
			portId: p.id
		});
	}
	for (let r of e.nodes) {
		let e = t.get(r.type);
		for (let t of e?.inputs ?? []) t.required && !o.get(`${r.id}:${t.id}`)?.length && n.push({
			code: "REQUIRED_INPUT_MISSING",
			severity: "error",
			message: `缺少必填输入：${t.label}`,
			nodeId: r.id,
			portId: t.id
		});
	}
	let s = Xe(e);
	return s.cyclicNodeIds.length && n.push({
		code: "CYCLE_DETECTED",
		severity: "error",
		message: `工作流包含环路：${s.cyclicNodeIds.join(", ")}`,
		details: { nodeIds: s.cyclicNodeIds }
	}), {
		valid: !n.some((e) => e.severity === "error"),
		issues: n
	};
}
var Y = class extends Error {
	result;
	constructor(e) {
		super(e.issues.map((e) => e.message).join("; ")), this.result = e, this.name = "GraphValidationError";
	}
}, $e = class extends Error {
	requirements;
	code = "CONFIGURATION_REQUIRED";
	constructor(e = "Workflow runtime configuration is required before execution.", t = []) {
		super(e), this.requirements = t, this.name = "RuntimeConfigurationRequiredError";
	}
};
function et(e) {
	return e instanceof $e || typeof e == "object" && !!e && "code" in e && e.code === "CONFIGURATION_REQUIRED" && "message" in e && typeof e.message == "string" && "requirements" in e && Array.isArray(e.requirements) && e.requirements.every((e) => typeof e == "string");
}
//#endregion
//#region src/runtime/local-runtime.ts
var tt = () => new DOMException("Workflow execution was cancelled.", "AbortError"), nt = /* @__PURE__ */ new Set([
	"status",
	"progress",
	"runMessage",
	"runError"
]), rt = (e) => Object.fromEntries(Object.entries(e).filter(([e]) => !nt.has(e))), it = (e) => {
	let t = /* @__PURE__ */ new WeakSet(), n = (e) => {
		if (e === null || typeof e == "string" || typeof e == "boolean") return e;
		if (typeof e == "number") return Number.isFinite(e) ? e : {
			$flowcanvas: "number",
			value: String(e)
		};
		if (e === void 0) return { $flowcanvas: "undefined" };
		if (typeof e == "bigint") return {
			$flowcanvas: "bigint",
			value: e.toString()
		};
		if (typeof e != "object") throw TypeError("Value is not deterministically cacheable.");
		if (t.has(e)) throw TypeError("Cannot cache workflow values containing circular references.");
		if (t.add(e), e instanceof Date) {
			let n = {
				$flowcanvas: "date",
				value: e.toISOString()
			};
			return t.delete(e), n;
		}
		if (e instanceof ArrayBuffer) {
			let n = {
				$flowcanvas: "array-buffer",
				value: Array.from(new Uint8Array(e))
			};
			return t.delete(e), n;
		}
		if (ArrayBuffer.isView(e)) {
			let n = new Uint8Array(e.buffer, e.byteOffset, e.byteLength), r = {
				$flowcanvas: e.constructor.name,
				value: Array.from(n)
			};
			return t.delete(e), r;
		}
		if (e instanceof Map) {
			let r = [...e.entries()].map(([e, t]) => [n(e), n(t)]);
			return r.sort((e, t) => JSON.stringify(e[0]).localeCompare(JSON.stringify(t[0]))), t.delete(e), {
				$flowcanvas: "map",
				value: r
			};
		}
		if (e instanceof Set) {
			let r = [...e].map(n).sort((e, t) => JSON.stringify(e).localeCompare(JSON.stringify(t)));
			return t.delete(e), {
				$flowcanvas: "set",
				value: r
			};
		}
		if (typeof Blob < "u" && e instanceof Blob) throw t.delete(e), TypeError("Blob and File values disable synchronous runtime caching.");
		if (Array.isArray(e)) {
			let r = e.map(n);
			return t.delete(e), r;
		}
		let r = Object.getPrototypeOf(e);
		if (r !== Object.prototype && r !== null) throw t.delete(e), TypeError(`Unsupported cache value type: ${e.constructor?.name ?? "object"}.`);
		let i = Object.fromEntries(Object.entries(e).sort(([e], [t]) => e.localeCompare(t)).map(([e, t]) => [e, n(t)]));
		return t.delete(e), i;
	};
	return JSON.stringify(n(e));
}, at = (e) => {
	try {
		return it(e);
	} catch {
		return;
	}
}, ot = class {
	cache = /* @__PURE__ */ new Map();
	maxCacheEntries;
	maxRetries;
	constructor(e = {}) {
		let t = e.maxCacheEntries ?? 256;
		if (!Number.isFinite(t) || t < 0) throw RangeError("maxCacheEntries must be a finite non-negative number.");
		this.maxCacheEntries = Math.floor(t);
		let n = e.maxRetries ?? 3;
		if (!Number.isSafeInteger(n) || n < 0 || n > 100) throw RangeError("maxRetries must be a safe integer between 0 and 100.");
		this.maxRetries = n;
	}
	get cacheSize() {
		return this.cache.size;
	}
	clearCache() {
		this.cache.clear();
	}
	async execute(e, t, n) {
		let r = Qe(e, t);
		if (!r.valid) throw new Y(r);
		let { runId: i } = n, a = Date.now(), o = Object.create(null), s = Object.create(null), c = Xe(e), l = new Map(e.nodes.map((e) => [e.id, e])), u = /* @__PURE__ */ new Map();
		for (let t of e.nodes) u.set(t.id, []);
		for (let t of e.edges) u.get(t.target)?.push(t);
		let d = (e) => n.onNodeState?.({ ...e });
		for (let t of e.nodes) o[t.id] = {
			nodeId: t.id,
			status: "queued",
			progress: 0,
			attempts: 0
		}, d(o[t.id]);
		let f = (e, t) => {
			o[e] = {
				...o[e],
				...t
			}, d(o[e]);
		}, p = /* @__PURE__ */ new Map();
		try {
			for (let e of c.order) {
				if (n.signal.aborted) throw tt();
				let r = l.get(e), i = t.require(r.type), a = u.get(e) ?? [], c = [...new Set(a.map((e) => e.source).filter((e) => o[e]?.status === "error"))];
				if (c.length) {
					let t = /* @__PURE__ */ Error(`Dependency failed: ${c.join(", ")}`);
					p.set(e, t), s[e] = {}, f(e, {
						status: "error",
						progress: 0,
						attempts: 0,
						startedAt: Date.now(),
						endedAt: Date.now(),
						error: t.message,
						message: "上游节点执行失败"
					});
					continue;
				}
				let d = Object.create(null);
				for (let e of a) {
					let t = structuredClone(s[e.source]?.[e.sourcePort]);
					if (i.inputs.find((t) => t.id === e.targetPort)?.multiple) {
						let n = Array.isArray(d[e.targetPort]) ? d[e.targetPort] : [];
						d[e.targetPort] = [...n, t];
					} else d[e.targetPort] = t;
				}
				let m = at({
					data: rt(r.data),
					inputs: d
				}), h = m === void 0 ? void 0 : `${t.revision}:${r.type}:${r.id}:${m}`, g = n.useCache === !1 || (n.refreshNodeIds ?? []).includes(e), _ = h && !g && r.data.cache !== !1 ? this.readCache(h) : void 0;
				if (_) {
					s[e] = _;
					let t = Date.now();
					f(e, {
						status: "success",
						progress: 1,
						attempts: 0,
						cached: !0,
						startedAt: t,
						endedAt: t
					});
					continue;
				}
				let v = Number(r.data.retryCount ?? 0), y = Number.isFinite(v) ? Math.min(this.maxRetries, Math.max(0, Math.floor(v))) + 1 : 1, b;
				f(e, {
					status: "running",
					progress: 0,
					startedAt: Date.now(),
					cached: !1
				});
				for (let t = 1; t <= y; t += 1) {
					if (n.signal.aborted) throw tt();
					f(e, {
						attempts: t,
						message: t > 1 ? `第 ${t} 次尝试` : void 0
					});
					try {
						let t = i.execute ? await i.execute({
							node: r,
							inputs: d,
							signal: n.signal,
							forceRefresh: g,
							emitProgress: (t, r) => {
								if (!Number.isFinite(t)) throw RangeError("Node progress must be a finite number.");
								if (r !== void 0 && typeof r != "string") throw TypeError("Node progress message must be a string.");
								n.signal.aborted || f(e, {
									progress: Math.min(1, Math.max(0, t)),
									message: r
								});
							}
						}) : { output: Object.values(d)[0] ?? r.data };
						if (n.signal.aborted) throw tt();
						if (!t || typeof t != "object" || Array.isArray(t)) throw TypeError(`Node executor "${r.type}" must return an object.`);
						let a = structuredClone(t);
						s[e] = a, h && r.data.cache !== !1 && this.writeCache(h, a), f(e, {
							status: "success",
							progress: 1,
							endedAt: Date.now(),
							error: void 0,
							message: void 0
						}), b = void 0;
						break;
					} catch (t) {
						if (n.signal.aborted) throw tt();
						if (b = t instanceof Error ? t : Error(String(t)), et(b)) throw p.set(e, b), s[e] = {}, f(e, {
							status: "error",
							endedAt: Date.now(),
							error: b.message
						}), b;
					}
				}
				if (b && (p.set(e, b), f(e, {
					status: "error",
					endedAt: Date.now(),
					error: b.message
				}), s[e] = {}, et(b) || n.stopOnError !== !1)) throw b;
			}
			return p.size ? {
				runId: i,
				status: "error",
				nodeStates: o,
				outputs: s,
				startedAt: a,
				endedAt: Date.now(),
				error: [...p].map(([e, t]) => `${e}: ${t.message}`).join("; ")
			} : {
				runId: i,
				status: "success",
				nodeStates: o,
				outputs: s,
				startedAt: a,
				endedAt: Date.now()
			};
		} catch (e) {
			let t = n.signal.aborted || e instanceof DOMException && e.name === "AbortError";
			if (t) for (let e of Object.values(o)) (e.status === "queued" || e.status === "running") && f(e.nodeId, {
				status: "cancelled",
				endedAt: Date.now()
			});
			else for (let e of Object.values(o)) e.status === "queued" && f(e.nodeId, {
				status: "error",
				endedAt: Date.now(),
				error: "Skipped because workflow stopped after an error."
			});
			if (et(e)) throw e;
			return {
				runId: i,
				status: t ? "cancelled" : "error",
				nodeStates: o,
				outputs: s,
				startedAt: a,
				endedAt: Date.now(),
				error: e instanceof Error ? e.message : String(e)
			};
		}
	}
	readCache(e) {
		let t = this.cache.get(e);
		if (t) return this.cache.delete(e), this.cache.set(e, t), structuredClone(t);
	}
	writeCache(e, t) {
		if (this.maxCacheEntries !== 0) for (this.cache.delete(e), this.cache.set(e, structuredClone(t)); this.cache.size > this.maxCacheEntries;) {
			let e = this.cache.keys().next().value;
			if (e === void 0) break;
			this.cache.delete(e);
		}
	}
}, st = (e, t) => JSON.stringify(e) === JSON.stringify(t), ct = (e, t) => e.nodeIds.length === t.nodeIds.length && e.edgeIds.length === t.edgeIds.length && e.nodeIds.every((e, n) => e === t.nodeIds[n]) && e.edgeIds.every((e, n) => e === t.edgeIds[n]), lt = (e, t, n = /* @__PURE__ */ new Set(["x", "y"])) => {
	if (!e || typeof e != "object" || Array.isArray(e) || !Number.isFinite(e.x) || !Number.isFinite(e.y)) throw RangeError(`${t} coordinates must be finite numbers.`);
	for (let r of Reflect.ownKeys(e)) if (typeof r != "string" || !n.has(r)) throw TypeError(`${t} contains an unsupported property: ${String(r)}.`);
}, ut = (e, t) => {
	if (e !== void 0 && (!Number.isFinite(e) || e <= 0)) throw RangeError(`${t} must be finite and greater than zero.`);
}, dt = /* @__PURE__ */ new Set([
	"type",
	"position",
	"data",
	"width",
	"height",
	"parentId",
	"locked"
]), ft = (e, t, n) => {
	let r = structuredClone(e);
	if (!r || typeof r != "object" || Array.isArray(r)) throw TypeError("Runtime result must be an object.");
	if (r.runId !== t) throw Error(`Runtime returned an unexpected runId: ${String(r.runId)}.`);
	if (![
		"success",
		"error",
		"cancelled"
	].includes(r.status)) throw TypeError(`Invalid runtime status: ${String(r.status)}.`);
	if (!r.nodeStates || typeof r.nodeStates != "object" || Array.isArray(r.nodeStates)) throw TypeError("Runtime result nodeStates must be an object.");
	if (!r.outputs || typeof r.outputs != "object" || Array.isArray(r.outputs)) throw TypeError("Runtime result outputs must be an object.");
	if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.endedAt) || r.endedAt < r.startedAt) throw TypeError("Runtime result timestamps must be finite and ordered.");
	r.nodeStates = Object.fromEntries(Object.entries(r.nodeStates).map(([e, t]) => {
		let r = mt(t, n);
		if (r.nodeId !== e) throw TypeError(`Runtime nodeStates key "${e}" does not match nodeId "${r.nodeId}".`);
		return [e, r];
	}));
	for (let [e, t] of Object.entries(r.outputs)) {
		if (!n.has(e)) throw TypeError(`Runtime returned output for unknown node: ${e}.`);
		if (!t || typeof t != "object" || Array.isArray(t)) throw TypeError(`Runtime output for node "${e}" must be an object.`);
	}
	return r;
}, pt = /* @__PURE__ */ new Set([
	"idle",
	"queued",
	"running",
	"success",
	"error",
	"cancelled"
]), mt = (e, t) => {
	let n = structuredClone(e);
	if (!n || typeof n != "object" || Array.isArray(n)) throw TypeError("Runtime node state must be an object.");
	if (typeof n.nodeId != "string" || !t.has(n.nodeId)) throw TypeError(`Runtime state references an unknown node: ${String(n.nodeId)}.`);
	if (!pt.has(n.status)) throw TypeError(`Invalid runtime node status: ${String(n.status)}.`);
	if (!Number.isFinite(n.progress) || n.progress < 0 || n.progress > 1) throw RangeError("Runtime node progress must be finite and between zero and one.");
	if (!Number.isSafeInteger(n.attempts) || n.attempts < 0) throw RangeError("Runtime node attempts must be a non-negative safe integer.");
	for (let e of ["message", "error"]) if (n[e] !== void 0 && typeof n[e] != "string") throw TypeError(`Runtime node ${e} must be a string.`);
	for (let e of ["startedAt", "endedAt"]) if (n[e] !== void 0 && !Number.isFinite(n[e])) throw RangeError(`Runtime node ${e} must be finite.`);
	if (n.cached !== void 0 && typeof n.cached != "boolean") throw TypeError("Runtime node cached must be boolean.");
	return n;
}, ht = /* @__PURE__ */ new Set([
	"success",
	"error",
	"cancelled"
]), gt = (e, t, n) => {
	let r = Object.create(null);
	for (let i of t) {
		let t = e.nodeStates[i] ?? n.get(i);
		if (t && ht.has(t.status)) {
			r[i] = t;
			continue;
		}
		let a = e.status === "success" ? "success" : e.status === "cancelled" ? "cancelled" : "error";
		r[i] = {
			nodeId: i,
			status: a,
			progress: a === "success" ? 1 : t?.progress ?? 0,
			attempts: t?.attempts ?? 0,
			startedAt: t?.startedAt ?? e.startedAt,
			endedAt: t?.endedAt ?? e.endedAt,
			message: t?.message,
			error: a === "error" ? t?.error ?? e.error ?? "Workflow execution failed." : void 0,
			cached: t?.cached
		};
	}
	return {
		...e,
		nodeStates: r
	};
}, _t = (e) => {
	let t = /* @__PURE__ */ new WeakMap(), n = (e) => {
		if (!e || typeof e != "object") return e;
		let r = t.get(e);
		if (r) return r;
		let i = new Proxy(e, {
			get: (e, t, r) => n(Reflect.get(e, t, r)),
			getOwnPropertyDescriptor: (e, t) => {
				let r = Reflect.getOwnPropertyDescriptor(e, t);
				return !r || !("value" in r) || r.configurable === !1 && r.writable === !1 ? r : {
					...r,
					value: n(r.value)
				};
			},
			set: () => {
				throw TypeError("FlowCanvas graph snapshots are read-only.");
			},
			deleteProperty: () => {
				throw TypeError("FlowCanvas graph snapshots are read-only.");
			},
			defineProperty: () => {
				throw TypeError("FlowCanvas graph snapshots are read-only.");
			},
			setPrototypeOf: () => {
				throw TypeError("FlowCanvas graph snapshots are read-only.");
			},
			preventExtensions: () => {
				throw TypeError("FlowCanvas graph snapshots are read-only.");
			}
		});
		return t.set(e, i), i;
	};
	return n(e);
}, vt = class extends Error {
	operation;
	code = "CANVAS_READ_ONLY";
	constructor(e) {
		super(`Canvas is read-only; operation is not allowed: ${e}.`), this.operation = e, this.name = "CanvasReadOnlyError";
	}
}, yt = class extends Error {
	code = "CANVAS_ENGINE_DESTROYED";
	constructor() {
		super("Canvas engine has been destroyed and can no longer be used."), this.name = "CanvasEngineDestroyedError";
	}
}, bt = class {
	registry = new G();
	events = new qe();
	history;
	graph;
	commandHistory;
	selection = {
		nodeIds: [],
		edgeIds: []
	};
	clipboard;
	runtime;
	migrations;
	activeRuns = /* @__PURE__ */ new Map();
	listeners = /* @__PURE__ */ new Set();
	spatialIndex = new Ye();
	spatialNodeMap = /* @__PURE__ */ new Map();
	spatialIndexDirty = !0;
	transactionContext;
	validationCache;
	validationRegistryRevision = -1;
	validationDeferredDirty = !1;
	readonlyViewSource;
	readonlyView;
	readOnly;
	version = 0;
	destroyed = !1;
	constructor(e = {}) {
		this.migrations = e.migrations, this.graph = e.graph ? H(e.graph, e.migrations) : V(), this.commandHistory = new W(e.historyLimit ?? 100);
		let t = this.commandHistory;
		this.history = Object.freeze({
			get canUndo() {
				return t.canUndo;
			},
			get canRedo() {
				return t.canRedo;
			},
			get undoLabel() {
				return t.undoLabel;
			},
			get redoLabel() {
				return t.redoLabel;
			}
		}), this.runtime = e.runtime ?? new ot(), this.readOnly = e.readOnly ?? !1, this.rebuildSpatialIndex();
	}
	subscribe = (e) => (this.assertAlive(), this.listeners.add(e), () => this.listeners.delete(e));
	getVersion = () => (this.assertAlive(), this.version);
	on(e, t) {
		return this.assertAlive(), this.events.on(e, t);
	}
	setReadOnly(e) {
		this.assertAlive(), this.readOnly !== e && (this.readOnly = e, this.notify());
	}
	isReadOnly() {
		return this.assertAlive(), this.readOnly;
	}
	getGraph() {
		return this.assertAlive(), B(this.graph);
	}
	getGraphSnapshot() {
		return this.assertAlive(), (this.readonlyViewSource !== this.graph || !this.readonlyView) && (this.readonlyViewSource = this.graph, this.readonlyView = _t(this.graph)), this.readonlyView;
	}
	exportGraph(e = 2) {
		return this.assertAlive(), Ge(this.graph, e);
	}
	importGraph(e) {
		this.assertWritable("导入工作流");
		try {
			this.graph = H(e, this.migrations), this.selection = {
				nodeIds: [],
				edgeIds: []
			}, this.commandHistory.clear(), this.validationCache = void 0, this.validationDeferredDirty = !1, this.rebuildSpatialIndex(), this.changed("导入工作流"), this.emitSelection();
		} catch (e) {
			let t = e instanceof Error ? e : Error(String(e));
			throw this.events.emit("error", {
				error: t,
				source: "graph:import"
			}), t;
		}
	}
	registerNodeType(e) {
		this.assertAlive();
		let t = this.registry.register(e);
		return this.validationCache = void 0, this.validationDeferredDirty = !1, this.notify(), () => {
			t(), this.validationCache = void 0, this.validationDeferredDirty = !1, this.notify();
		};
	}
	addNode(e, t, n) {
		this.assertWritable("添加节点"), lt(t, "Node position");
		let r = this.registry.require(e), i = structuredClone({
			...r.createData(),
			...n,
			title: n?.title ?? r.title
		});
		if (!i || typeof i != "object" || typeof i.title != "string") throw TypeError(`Node type "${e}" must create object data with a string title.`);
		Ve(i, `node(${e}).data`);
		let a = {
			id: crypto.randomUUID(),
			type: e,
			position: {
				x: t.x,
				y: t.y
			},
			data: i
		}, o = !this.spatialIndexDirty;
		return this.mutate("添加节点", (e) => e.nodes.push(a), { selection: {
			nodeIds: [a.id],
			edgeIds: []
		} }), o && !this.transactionContext && this.syncSpatialNode(a.id), structuredClone(a);
	}
	updateNode(e, t, n = {}) {
		if (!t || typeof t != "object" || Array.isArray(t)) throw TypeError("Node patch must be an object.");
		for (let e of Object.keys(t)) if (!dt.has(e)) throw TypeError(`Unsupported node patch field: ${e}.`);
		if (t.position && lt(t.position, "Node position"), ut(t.width, "Node width"), ut(t.height, "Node height"), t.type !== void 0 && (typeof t.type != "string" || !t.type.trim())) throw TypeError("Node type must be a non-empty string.");
		if (t.parentId !== void 0 && (typeof t.parentId != "string" || !t.parentId.trim())) throw TypeError("Node parentId must be a non-empty string.");
		if (t.locked !== void 0 && typeof t.locked != "boolean") throw TypeError("Node locked must be boolean.");
		if (t.data !== void 0 && (!t.data || typeof t.data != "object" || Array.isArray(t.data))) throw TypeError("Node data patch must be an object.");
		t.data !== void 0 && Ve(t.data, `node(${e}).data patch`);
		let r = t.position !== void 0 || t.width !== void 0 || t.height !== void 0, i = t.type !== void 0 || t.data !== void 0, a = !this.spatialIndexDirty;
		this.mutate("更新节点", (n) => {
			let r = n.nodes.find((t) => t.id === e);
			if (!r) throw Error(`Node not found: ${e}`);
			let { position: i, data: a } = t;
			if (t.type !== void 0 && (r.type = t.type), t.width !== void 0 && (r.width = t.width), t.height !== void 0 && (r.height = t.height), t.parentId !== void 0 && (r.parentId = t.parentId), t.locked !== void 0 && (r.locked = t.locked), i && (r.position = {
				x: i.x,
				y: i.y
			}), a) {
				let e = {
					...r.data,
					...structuredClone(a)
				};
				if (typeof e.title != "string") throw TypeError("Node data title must be a string.");
				r.data = e;
			}
		}, {
			record: n.record,
			transient: n.transient,
			affectsSpatialIndex: r,
			affectsValidation: i
		}), r && a && !this.transactionContext && this.syncSpatialNode(e);
	}
	updateNodeData(e, t, n = {}) {
		this.updateNode(e, { data: t }, n);
	}
	removeNodes(e) {
		let t = new Set(e), n = {
			nodeIds: this.selection.nodeIds.filter((e) => !t.has(e)),
			edgeIds: this.selection.edgeIds.filter((e) => {
				let n = this.graph.edges.find((t) => t.id === e);
				return n ? !t.has(n.source) && !t.has(n.target) : !1;
			})
		}, r = !this.spatialIndexDirty;
		if (this.mutate("删除节点", (e) => {
			e.nodes = e.nodes.filter((e) => !t.has(e.id)), e.edges = e.edges.filter((e) => !t.has(e.source) && !t.has(e.target));
		}, { selection: n }), r && !this.transactionContext) {
			for (let e of t) this.spatialIndex.remove(e), this.spatialNodeMap.delete(e);
			this.spatialIndexDirty = !1;
		}
	}
	addEdge(e) {
		if (this.assertWritable("创建连线"), !e || typeof e != "object" || Array.isArray(e)) throw TypeError("Edge input must be an object.");
		let t = /* @__PURE__ */ new Set([
			"id",
			"source",
			"sourcePort",
			"target",
			"targetPort",
			"label",
			"data"
		]);
		for (let n of Reflect.ownKeys(e)) if (typeof n != "string" || !t.has(n)) throw TypeError(`Unknown edge property: ${String(n)}.`);
		for (let [t, n] of Object.entries({
			source: e.source,
			sourcePort: e.sourcePort,
			target: e.target,
			targetPort: e.targetPort
		})) if (typeof n != "string" || !n.trim()) throw TypeError(`Edge ${t} must be a non-empty string.`);
		if (e.id !== void 0 && (typeof e.id != "string" || !e.id.trim())) throw TypeError("Edge id must be a non-empty string.");
		if (e.label !== void 0 && typeof e.label != "string") throw TypeError("Edge label must be a string.");
		if (e.data !== void 0) {
			if (!e.data || typeof e.data != "object" || Array.isArray(e.data)) throw TypeError("Edge data must be an object.");
			Ve(e.data, "edge.data");
		}
		let n = structuredClone({
			...e,
			id: e.id ?? crypto.randomUUID()
		}), r = B(this.graph);
		r.edges.push(n);
		let i = Qe(r, this.registry), a = /* @__PURE__ */ new Set([
			"DUPLICATE_EDGE_ID",
			"SELF_CONNECTION",
			"DUPLICATE_CONNECTION",
			"PORT_TYPE_MISMATCH",
			"PORT_CARDINALITY",
			"CYCLE_DETECTED",
			"MISSING_SOURCE_NODE",
			"MISSING_TARGET_NODE",
			"MISSING_SOURCE_PORT",
			"MISSING_TARGET_PORT"
		]), o = i.issues.filter((e) => a.has(e.code) && (e.edgeId === n.id || e.code === "CYCLE_DETECTED"));
		if (o.length) throw new Y({
			valid: !1,
			issues: o
		});
		return this.mutate("创建连线", (e) => e.edges.push(n), { affectsSpatialIndex: !1 }), structuredClone(n);
	}
	removeEdges(e) {
		let t = new Set(e);
		this.mutate("删除连线", (e) => {
			e.edges = e.edges.filter((e) => !t.has(e.id));
		}, {
			selection: {
				...this.selection,
				edgeIds: this.selection.edgeIds.filter((e) => !t.has(e))
			},
			affectsSpatialIndex: !1
		});
	}
	setViewport(e, t = { record: !1 }) {
		if (lt(e, "Viewport", /* @__PURE__ */ new Set([
			"x",
			"y",
			"zoom"
		])), !Number.isFinite(e.zoom) || e.zoom <= 0) throw RangeError("Viewport zoom must be finite and greater than zero.");
		this.mutate("更新视口", (t) => {
			t.viewport = {
				x: e.x,
				y: e.y,
				zoom: e.zoom
			};
		}, {
			record: t.record === !0,
			affectsSpatialIndex: !1,
			affectsValidation: !1,
			allowReadOnly: !0
		});
	}
	setSelection(e) {
		this.assertAlive();
		let t = this.normalizeSelection(e);
		if (!ct(t, this.selection)) {
			if (this.selection = t, this.transactionContext) {
				this.transactionContext.selectionTouched = !0;
				return;
			}
			this.emitSelection(), this.notify();
		}
	}
	getSelection() {
		return this.assertAlive(), structuredClone(this.selection);
	}
	copySelection() {
		this.assertAlive();
		let e = new Set(this.selection.nodeIds);
		return this.clipboard = {
			nodes: this.graph.nodes.filter((t) => e.has(t.id)).map((e) => structuredClone(e)),
			edges: this.graph.edges.filter((t) => e.has(t.source) && e.has(t.target)).map((e) => structuredClone(e))
		}, structuredClone(this.clipboard);
	}
	pasteClipboard(e = {
		x: 32,
		y: 32
	}) {
		if (this.assertWritable("粘贴节点"), lt(e, "Clipboard offset"), !this.clipboard?.nodes.length) return [];
		let t = /* @__PURE__ */ new Map(), n = this.clipboard.nodes.map((n) => {
			let r = crypto.randomUUID();
			return t.set(n.id, r), {
				...structuredClone(n),
				id: r,
				position: {
					x: n.position.x + e.x,
					y: n.position.y + e.y
				}
			};
		}), r = this.clipboard.edges.map((e) => ({
			...structuredClone(e),
			id: crypto.randomUUID(),
			source: t.get(e.source),
			target: t.get(e.target)
		})), i = n.map((e) => e.id);
		return this.mutate("粘贴节点", (e) => {
			e.nodes.push(...n), e.edges.push(...r);
		}, { selection: {
			nodeIds: i,
			edgeIds: []
		} }), this.clipboard = {
			nodes: n,
			edges: r
		}, i;
	}
	duplicateSelection() {
		return this.copySelection(), this.pasteClipboard();
	}
	captureSnapshot() {
		return this.assertAlive(), B(this.graph);
	}
	commitSnapshot(e, t) {
		if (this.assertAlive(), typeof e != "string" || !e.trim()) throw TypeError("Snapshot label must be a non-empty string.");
		let n = H(t, this.migrations), r = B(this.graph);
		if (st(n, r)) return;
		let i = this.getSelection();
		this.commandHistory.push({
			label: e,
			undo: () => this.restoreState({
				graph: n,
				selection: i
			}, `撤销${e}`),
			redo: () => this.restoreState({
				graph: r,
				selection: i
			}, `重做${e}`)
		}), this.validationCache = void 0, this.validationDeferredDirty = !1, this.changed(e);
	}
	executeCommand(e, t, n = {}) {
		let r = typeof e == "string" ? {
			label: e,
			execute: t
		} : e;
		if (typeof r.execute != "function") throw TypeError("Canvas command execute function is required.");
		let i = typeof e == "string" ? n : t ?? {};
		return this.transaction(r.label, r.execute, i);
	}
	transaction(e, t, n = {}) {
		if (this.assertWritable(e), this.transactionContext) return t(this);
		let r = {
			label: e,
			record: n.record !== !1,
			before: this.captureState(),
			graphTouched: !1,
			selectionTouched: !1
		};
		this.transactionContext = r;
		let i;
		try {
			if (i = t(this), i && typeof i.then == "function") throw TypeError("CanvasEngine.transaction callbacks must be synchronous.");
		} catch (e) {
			throw this.graph = B(r.before.graph), this.selection = structuredClone(r.before.selection), this.spatialIndexDirty = !0, this.validationCache = void 0, this.validationDeferredDirty = !1, e;
		} finally {
			this.transactionContext = void 0;
		}
		let a = r.graphTouched && !st(r.before.graph, this.graph), o = !ct(r.before.selection, this.selection);
		if (a && r.record) {
			let t = this.captureState();
			this.commandHistory.push({
				label: e,
				undo: () => this.restoreState(r.before, `撤销${e}`),
				redo: () => this.restoreState(t, `重做${e}`)
			});
		}
		return a && (this.validationCache = void 0, this.validationDeferredDirty = !1, this.changed(e)), o && (this.emitSelection(), a || this.notify()), i;
	}
	undo() {
		return this.assertWritable("撤销"), this.commandHistory.undo();
	}
	redo() {
		return this.assertWritable("重做"), this.commandHistory.redo();
	}
	validate() {
		this.assertAlive(), this.validationDeferredDirty &&= (this.validationCache = void 0, !1);
		let e = this.getValidationSnapshot();
		return this.events.emit("validation:change", e), e;
	}
	getValidationSnapshot() {
		return this.assertAlive(), (!this.validationCache || this.validationRegistryRevision !== this.registry.revision) && (this.validationCache = Qe(this.graph, this.registry), this.validationRegistryRevision = this.registry.revision), structuredClone(this.validationCache);
	}
	queryNodeIds(e) {
		return this.assertAlive(), this.ensureSpatialIndex(), this.spatialIndex.query(e);
	}
	queryNodes(e) {
		return this.assertAlive(), this.ensureSpatialIndex(), this.spatialIndex.query(e).map((e) => structuredClone(this.spatialNodeMap.get(e)));
	}
	rebuildSpatialIndex() {
		this.assertAlive(), this.spatialIndex.rebuild(this.graph.nodes), this.spatialNodeMap = new Map(this.graph.nodes.map((e) => [e.id, e])), this.spatialIndexDirty = !1;
	}
	async run(e = {}) {
		return this.executeGraph(this.getGraph(), e);
	}
	async runNode(e, t = {}) {
		this.assertAlive();
		let n = this.getGraph();
		if (!n.nodes.some((t) => t.id === e)) throw Error(`Node not found: ${e}`);
		let r = /* @__PURE__ */ new Set([e]), i = [e];
		for (; i.length;) {
			let e = i.shift();
			for (let t of n.edges) t.target !== e || r.has(t.source) || (r.add(t.source), i.push(t.source));
		}
		let a = {
			...n,
			nodes: n.nodes.filter((e) => r.has(e.id)),
			edges: n.edges.filter((e) => r.has(e.source) && r.has(e.target)),
			metadata: {
				...n.metadata,
				runScope: {
					kind: "node",
					nodeId: e
				}
			}
		};
		return this.executeGraph(a, {
			...t,
			refreshNodeIds: [.../* @__PURE__ */ new Set([...t.refreshNodeIds ?? [], e])]
		});
	}
	async executeGraph(e, t) {
		this.assertAlive();
		let n;
		try {
			if (n = Qe(e, this.registry), !n.valid) throw new Y(n);
		} catch (e) {
			let t = e instanceof Error ? e : Error(String(e));
			throw this.events.emit("error", {
				error: t,
				source: "run:validation"
			}), t;
		}
		let r = new AbortController(), i = crypto.randomUUID(), a = Date.now(), o = new Set(e.nodes.map((e) => e.id)), s = {
			token: Symbol(i),
			runId: i,
			controller: r,
			nodeIds: o
		}, c = /* @__PURE__ */ new Map();
		this.activeRuns.set(i, s), this.events.emit("run:start", {
			runId: i,
			nodeIds: [...o]
		});
		let l = (e) => {
			let t = gt(e, o, c);
			if (this.activeRuns.get(i)?.token === s.token) for (let e of Object.values(t.nodeStates)) this.applyRuntimeState(e), this.events.emit("run:node", e);
			return t;
		};
		try {
			let n = await this.runtime.execute(B(e), this.registry, {
				...t,
				runId: i,
				signal: r.signal,
				onNodeState: (e) => {
					if (this.activeRuns.get(i)?.token !== s.token) return;
					let t = mt(e, o);
					c.set(t.nodeId, t), this.applyRuntimeState(t), this.events.emit("run:node", t);
				}
			});
			if (r.signal.aborted) {
				let e = {
					runId: i,
					status: "cancelled",
					nodeStates: {},
					outputs: {},
					startedAt: a,
					endedAt: Date.now()
				};
				try {
					let t = ft(n, i, o);
					t.status === "cancelled" && (e = t);
				} catch {}
				return e = l(e), this.events.emit("run:end", e), e;
			}
			let u = l(ft(n, i, o));
			return u.status === "error" && this.events.emit("error", {
				error: Error(u.error ?? `Workflow run ${i} failed.`),
				source: `runtime:${i}`
			}), this.events.emit("run:end", u), u;
		} catch (e) {
			let t = e instanceof Error ? e : Error(String(e));
			if (r.signal.aborted || t.name === "AbortError") {
				let e = l({
					runId: i,
					status: "cancelled",
					nodeStates: {},
					outputs: {},
					startedAt: a,
					endedAt: Date.now()
				});
				return this.events.emit("run:end", e), e;
			}
			this.events.emit("error", {
				error: t,
				source: `runtime:${i}`
			});
			let n = l({
				runId: i,
				status: "error",
				nodeStates: {},
				outputs: {},
				startedAt: a,
				endedAt: Date.now(),
				error: t.message
			});
			throw this.events.emit("run:end", n), t;
		} finally {
			this.activeRuns.get(i)?.token === s.token && this.activeRuns.delete(i);
		}
	}
	cancel() {
		for (let e of this.activeRuns.values()) e.controller.abort();
	}
	cancelNode(e) {
		for (let t of this.activeRuns.values()) t.nodeIds.has(e) && t.controller.abort();
	}
	isRunning() {
		return this.activeRuns.size > 0;
	}
	isNodeRunning(e) {
		return [...this.activeRuns.values()].some((t) => t.nodeIds.has(e));
	}
	clearRuntimeCache() {
		this.assertAlive(), this.runtime.clearCache?.();
	}
	destroy() {
		this.destroyed ||= (this.cancel(), this.activeRuns.clear(), this.listeners.clear(), this.events.clear(), !0);
	}
	assertAlive() {
		if (this.destroyed) throw new yt();
	}
	assertWritable(e) {
		if (this.assertAlive(), this.readOnly) throw new vt(e);
	}
	normalizeSelection(e) {
		let t = new Set(this.graph.nodes.map((e) => e.id)), n = new Set(this.graph.edges.map((e) => e.id));
		return {
			nodeIds: [...new Set(e.nodeIds)].filter((e) => t.has(e)).sort(),
			edgeIds: [...new Set(e.edgeIds)].filter((e) => n.has(e)).sort()
		};
	}
	captureState() {
		return {
			graph: B(this.graph),
			selection: this.getSelection()
		};
	}
	applyRuntimeState(e) {
		let t = this.graph.nodes.find((t) => t.id === e.nodeId);
		t && (t.data = {
			...t.data,
			status: e.status,
			progress: e.progress,
			runMessage: e.message,
			runError: e.error
		}, e.message === void 0 && delete t.data.runMessage, e.error === void 0 && delete t.data.runError, this.notify());
	}
	mutate(e, t, n = {}) {
		if (this.assertAlive(), n.allowReadOnly || this.assertWritable(e), this.transactionContext) {
			t(this.graph), this.transactionContext.graphTouched = !0, n.selection && (this.selection = this.normalizeSelection(n.selection), this.transactionContext.selectionTouched = !0), n.affectsSpatialIndex !== !1 && (this.spatialIndexDirty = !0), n.affectsValidation !== !1 && (n.transient ? this.validationDeferredDirty = !0 : (this.validationCache = void 0, this.validationDeferredDirty = !1));
			return;
		}
		if (n.record === !1) {
			t(this.graph);
			let r = this.selection;
			n.selection && (this.selection = this.normalizeSelection(n.selection)), n.affectsSpatialIndex !== !1 && (this.spatialIndexDirty = !0), n.affectsValidation !== !1 && (n.transient ? this.validationDeferredDirty = !0 : (this.validationCache = void 0, this.validationDeferredDirty = !1)), n.transient ? this.notify() : this.changed(e), ct(r, this.selection) || this.emitSelection();
			return;
		}
		let r = this.captureState(), i, a, o;
		try {
			t(this.graph), n.selection && (this.selection = this.normalizeSelection(n.selection)), i = this.captureState(), a = !st(r.graph, i.graph), o = !ct(r.selection, i.selection);
		} catch (e) {
			throw this.graph = r.graph, this.selection = r.selection, this.spatialIndexDirty = !0, this.validationCache = void 0, this.validationDeferredDirty = !1, e;
		}
		!a && !o || (a && (this.commandHistory.push({
			label: e,
			undo: () => this.restoreState(r, `撤销${e}`),
			redo: () => this.restoreState(i, `重做${e}`)
		}), n.affectsSpatialIndex !== !1 && (this.spatialIndexDirty = !0), n.affectsValidation !== !1 && (this.validationCache = void 0, this.validationDeferredDirty = !1), this.changed(e)), o && (this.emitSelection(), a || this.notify()));
	}
	restoreState(e, t) {
		let n = this.selection;
		this.graph = B(e.graph), this.selection = this.normalizeSelection(e.selection), this.spatialIndexDirty = !0, this.validationCache = void 0, this.validationDeferredDirty = !1, this.changed(t), ct(n, this.selection) || this.emitSelection();
	}
	changed(e) {
		if (this.version += 1, this.events.hasListeners("graph:change") && this.events.emit("graph:change", {
			graph: this.getGraph(),
			label: e
		}), this.events.hasListeners("validation:change")) {
			let e = this.getValidationSnapshot();
			this.events.emit("validation:change", e);
		}
		this.notify(!1);
	}
	emitSelection() {
		this.events.emit("selection:change", this.getSelection());
	}
	notify(e = !0) {
		e && (this.version += 1);
		for (let e of [...this.listeners]) try {
			e();
		} catch (e) {
			let t = e instanceof Error ? e : Error(String(e));
			this.events.emit("error", {
				error: t,
				source: "subscriber"
			});
		}
	}
	ensureSpatialIndex() {
		this.spatialIndexDirty && this.rebuildSpatialIndex();
	}
	syncSpatialNode(e) {
		let t = this.graph.nodes.find((t) => t.id === e);
		t ? (this.spatialIndex.upsert(t), this.spatialNodeMap.set(e, t)) : (this.spatialIndex.remove(e), this.spatialNodeMap.delete(e)), this.spatialIndexDirty = !1;
	}
}, xt = [
	"text",
	"image",
	"video",
	"audio"
];
function St(e) {
	let t = e.references.map((e) => typeof e == "string" ? "file" : e.kind);
	return t.includes("video") ? "mixed2video" : e.firstFrame || e.lastFrame ? "image2video" : t.length ? t.includes("image") ? "image2video" : "mixed2video" : "text2video";
}
var Ct = Object.freeze([
	{
		mode: "text",
		nodeType: "prompt",
		label: "文本生成",
		shortLabel: "文本",
		placeholder: "输入你的故事、场景或角色设定",
		creditCost: 1,
		accept: "text/plain,text/markdown,application/json,.txt,.md,.json"
	},
	{
		mode: "image",
		nodeType: "image",
		label: "图片生成",
		shortLabel: "图片",
		placeholder: "描述你想要生成的图片，或输入 @ 引用角色",
		creditCost: 5,
		accept: "image/*"
	},
	{
		mode: "video",
		nodeType: "video",
		label: "视频生成",
		shortLabel: "视频",
		placeholder: "结合图片，描述你想生成的角色动作和画面动态",
		creditCost: 20,
		accept: "image/*,video/*,audio/*"
	},
	{
		mode: "audio",
		nodeType: "audio",
		label: "音频生成",
		shortLabel: "音频",
		placeholder: "输入你想要创作的音乐内容",
		creditCost: 3
	}
]), wt = new Map(Ct.map((e) => [e.mode, e])), Tt = new Map(Ct.map((e) => [e.nodeType, e])), X = (e, t) => typeof e == "string" ? e : t, Et = (e, t, n, r) => {
	let i = Number(e);
	return Number.isInteger(i) ? Math.min(r, Math.max(n, i)) : t;
}, Dt = (e) => e && typeof e == "object" && !Array.isArray(e) ? e : {}, Ot = (e) => e === "image" || e === "video" || e === "audio" || e === "text" || e === "file" ? e : "file", kt = (e) => {
	let t = Number(e);
	return Number.isFinite(t) && t >= 0 ? t : void 0;
}, At = (e, t = "") => {
	if (typeof e == "string") return e;
	let n = Dt(e);
	if (!Object.keys(n).length) return t;
	let r = X(n.name ?? n.title ?? n.fileName, ""), i = X(n.id, r);
	if (!i && !r) return t;
	let a = {
		id: i || r,
		name: r || i,
		kind: Ot(n.kind ?? n.mediaType)
	}, o = X(n.mimeType, ""), s = X(n.url ?? n.preview, ""), c = kt(n.size), l = kt(n.lastModified);
	return o && (a.mimeType = o), s && (a.url = s), c !== void 0 && (a.size = c), l !== void 0 && (a.lastModified = l), a;
}, jt = (e) => Array.isArray(e) ? e.map((e) => At(e)).filter((e) => e !== "").slice(0, 14) : [];
function Z(e) {
	return typeof e == "string" && xt.includes(e);
}
function Mt(e) {
	return Tt.get(e)?.mode;
}
function Nt(e) {
	return wt.get(e)?.nodeType ?? "prompt";
}
function Pt(e) {
	return Tt.has(e);
}
function Ft(e) {
	return wt.get(e) ?? Ct[0];
}
function It() {
	return {
		text: {
			prompt: "",
			model: "GMLM 3.1",
			references: []
		},
		image: {
			prompt: "",
			model: "nano-banana-pro(特价版 1)",
			references: [],
			ratio: "16:9",
			quality: "标准画质 · 2K",
			panorama: !1,
			count: 1
		},
		video: {
			prompt: "",
			model: "seedance-2.0-pro(431)",
			references: [],
			resolution: "720p",
			duration: 5,
			firstFrame: "",
			lastFrame: "",
			modeType: "text2video",
			ratio: "16:9",
			enableSound: "off"
		},
		audio: {
			prompt: "",
			model: "Mureka V9",
			references: [],
			lyricsMode: "自动生成"
		}
	};
}
function Lt(e, t = { title: "" }, n = "text") {
	let r = Dt(e), i = It(), a = Dt(r.text), o = Dt(r.image), s = Dt(r.video), c = Dt(r.audio), l = X(t.prompt, ""), u = X(t.model, "");
	return {
		text: {
			prompt: X(a.prompt, n === "text" ? l : i.text.prompt),
			model: X(a.model, n === "text" && u ? u : i.text.model),
			references: jt(a.references)
		},
		image: {
			prompt: X(o.prompt, n === "image" ? l : i.image.prompt),
			model: X(o.model, n === "image" && u ? u : i.image.model),
			references: jt(o.references),
			ratio: X(o.ratio, X(t.ratio, i.image.ratio)),
			quality: X(o.quality, X(t.quality, i.image.quality)),
			panorama: typeof o.panorama == "boolean" ? o.panorama : !!t.panorama,
			count: Et(o.count ?? t.count, i.image.count, 1, 4)
		},
		video: {
			prompt: X(s.prompt, n === "video" ? l : i.video.prompt),
			model: X(s.model, n === "video" && u ? u : i.video.model),
			references: jt(s.references),
			resolution: X(s.resolution, X(t.resolution, i.video.resolution)),
			duration: Et(s.duration ?? t.duration, i.video.duration, 4, 15),
			firstFrame: At(s.firstFrame, At(t.firstFrame)),
			lastFrame: At(s.lastFrame, At(t.lastFrame)),
			modeType: X(s.modeType, X(t.modeType, i.video.modeType)),
			ratio: X(s.ratio, X(t.ratio, i.video.ratio)),
			enableSound: X(s.enableSound, X(t.enableSound, i.video.enableSound))
		},
		audio: {
			prompt: X(c.prompt, n === "audio" ? l : i.audio.prompt),
			model: X(c.model, n === "audio" && u ? u : i.audio.model),
			references: jt(c.references),
			lyricsMode: X(c.lyricsMode, X(t.lyricsMode, i.audio.lyricsMode))
		}
	};
}
function Rt(e, t) {
	let n = structuredClone(t);
	n.video.modeType = St(n.video);
	let r = n[e], i = {
		generationMode: e,
		generationDrafts: n,
		prompt: r.prompt,
		model: r.model
	};
	return e === "image" && Object.assign(i, {
		ratio: t.image.ratio,
		quality: t.image.quality,
		panorama: t.image.panorama,
		count: t.image.count
	}), e === "video" && Object.assign(i, {
		resolution: n.video.resolution,
		duration: n.video.duration,
		firstFrame: n.video.firstFrame,
		lastFrame: n.video.lastFrame,
		modeType: n.video.modeType,
		ratio: n.video.ratio,
		enableSound: n.video.enableSound
	}), e === "audio" && Object.assign(i, { lyricsMode: t.audio.lyricsMode }), i;
}
function zt(e, t) {
	let n = Ft(e).creditCost;
	return e === "image" ? n * t.image.count : n;
}
//#endregion
//#region src/builtins.ts
var Bt = (e, t) => new Promise((n, r) => {
	if (t.aborted) {
		r(new DOMException("Cancelled", "AbortError"));
		return;
	}
	let i = () => {
		clearTimeout(a), r(new DOMException("Cancelled", "AbortError"));
	}, a = setTimeout(() => {
		t.removeEventListener("abort", i), n();
	}, e);
	t.addEventListener("abort", i, { once: !0 });
}), Vt = (e, t) => ({
	title: e,
	description: t,
	status: "idle",
	progress: 0,
	retryCount: 0,
	cache: !0
}), Ht = (e, t, n, r = {}) => {
	let i = It();
	return Object.assign(i[e], r), {
		...Vt(t, n),
		...Rt(e, i)
	};
}, Ut = [
	{
		type: "blank",
		title: "空白节点",
		category: "素材",
		description: "空白媒体容器，可嵌入图片、视频和音频。",
		icon: "image",
		color: "#9da3ad",
		inputs: [{
			id: "input",
			label: "输入",
			dataType: "any"
		}],
		outputs: [{
			id: "output",
			label: "输出",
			dataType: "any",
			multiple: !0
		}],
		createData: () => ({
			...Vt("空白节点", "拖入或上传图片、视频、音频后会嵌入到这里"),
			embeddedMedia: []
		}),
		execute: ({ node: e, inputs: t, emitProgress: n }) => (n(1, "空白节点已读取"), { output: {
			input: t.input,
			media: e.data.embeddedMedia ?? [],
			preview: e.data.preview,
			previewKind: e.data.previewKind,
			fileName: e.data.fileName
		} })
	},
	{
		type: "prompt",
		title: "场景脚本",
		category: "创作",
		description: "输入脚本、提示词或镜头描述",
		icon: "text",
		color: "#79e6c5",
		inputs: [],
		outputs: [{
			id: "text",
			label: "文本",
			dataType: "text"
		}],
		createData: () => Ht("text", "场景脚本", "输入脚本、提示词或镜头描述", { prompt: "雨夜的旧车站，女主在站台尽头认出多年未见的故人。" }),
		validate: (e) => e.data.prompt?.toString().trim() ? [] : [{
			code: "NODE_CONFIGURATION_INVALID",
			severity: "error",
			message: "提示词不能为空",
			nodeId: e.id
		}],
		execute: ({ node: e }) => ({ text: e.data.prompt ?? "" })
	},
	{
		type: "image",
		title: "图片生成",
		category: "生成",
		description: "根据文本和参考素材生成画面",
		icon: "image",
		color: "#80aefa",
		inputs: [{
			id: "prompt",
			label: "提示词",
			dataType: "text"
		}, {
			id: "reference",
			label: "参考图",
			dataType: "image",
			multiple: !0
		}],
		outputs: [{
			id: "image",
			label: "图像",
			dataType: "image"
		}],
		createData: () => Ht("image", "图片生成", "根据文本和参考素材生成画面"),
		execute: async ({ inputs: e, signal: t, emitProgress: n, node: r }) => (n(.2, "解析提示词"), await Bt(180, t), n(.7, "生成画面"), await Bt(260, t), { image: {
			kind: "image",
			prompt: e.prompt ?? r.data.prompt,
			model: r.data.model,
			preview: r.data.preview
		} })
	},
	{
		type: "video",
		title: "视频生成",
		category: "生成",
		description: "根据提示词和首帧生成镜头",
		icon: "video",
		color: "#f0ba7b",
		inputs: [
			{
				id: "prompt",
				label: "提示词 / 上游内容",
				dataType: "any"
			},
			{
				id: "image",
				label: "首帧 / 参考素材",
				dataType: "any",
				multiple: !0
			},
			{
				id: "lastFrame",
				label: "尾帧 / 延续素材",
				dataType: "any"
			}
		],
		outputs: [{
			id: "video",
			label: "视频",
			dataType: "video",
			multiple: !0
		}],
		createData: () => Ht("video", "视频生成", "根据提示词和首尾帧生成镜头"),
		execute: async ({ inputs: e, signal: t, emitProgress: n, node: r }) => {
			for (let [e, r] of [
				[.15, "准备素材"],
				[.45, "生成关键帧"],
				[.78, "合成镜头"]
			]) n(e, r), await Bt(180, t);
			return { video: {
				kind: "video",
				prompt: e.prompt ?? r.data.prompt,
				image: e.image,
				lastFrame: e.lastFrame ?? r.data.lastFrame,
				model: r.data.model,
				duration: r.data.duration
			} };
		}
	},
	{
		type: "audio",
		title: "音频生成",
		category: "生成",
		description: "根据台词生成角色语音",
		icon: "audio",
		color: "#73d6a4",
		inputs: [{
			id: "text",
			label: "台词",
			dataType: "text"
		}],
		outputs: [{
			id: "audio",
			label: "音频",
			dataType: "audio"
		}],
		createData: () => Ht("audio", "音频生成", "根据描述生成音乐或角色语音"),
		execute: async ({ inputs: e, signal: t, emitProgress: n, node: r }) => (n(.5, "合成语音"), await Bt(280, t), { audio: {
			kind: "audio",
			text: e.text ?? r.data.prompt,
			model: r.data.model,
			lyricsMode: r.data.lyricsMode
		} })
	},
	{
		type: "compose",
		title: "镜头合成",
		category: "输出",
		description: "合并视频、配音和字幕",
		icon: "output",
		color: "#c8ccd2",
		inputs: [{
			id: "video",
			label: "视频",
			dataType: "video",
			required: !0
		}, {
			id: "audio",
			label: "音频",
			dataType: "audio"
		}],
		outputs: [{
			id: "output",
			label: "成片",
			dataType: "video"
		}],
		createData: () => ({
			...Vt("镜头合成", "合并视频、配音和字幕"),
			resolution: "1080p"
		}),
		execute: async ({ inputs: e, signal: t, emitProgress: n, node: r }) => (n(.35, "对齐轨道"), await Bt(180, t), n(.8, "导出成片"), await Bt(220, t), { output: {
			kind: "video",
			video: e.video,
			audio: e.audio,
			resolution: r.data.resolution
		} })
	}
];
function Wt(e) {
	for (let t of Ut) e(t);
}
//#endregion
//#region src/plugins.ts
var Gt = (e) => {
	typeof e == "function" ? e() : e?.dispose();
}, Kt = class {
	installed = /* @__PURE__ */ new Map();
	use(e, t) {
		if (!e.id.trim()) throw Error("FlowCanvas plugin id is required.");
		if (this.installed.has(e.id)) throw Error(`FlowCanvas plugin "${e.id}" is already installed.`);
		let n = e.install(t);
		return this.installed.set(e.id, {
			plugin: e,
			cleanup: n
		}), () => this.unuse(e.id);
	}
	unuse(e) {
		let t = this.installed.get(e);
		return t ? (this.installed.delete(e), Gt(t.cleanup), !0) : !1;
	}
	has(e) {
		return this.installed.has(e);
	}
	list() {
		return [...this.installed.values()].map((e) => e.plugin);
	}
	destroy() {
		let e = [];
		for (let t of [...this.installed.keys()].reverse()) try {
			this.unuse(t);
		} catch (t) {
			e.push(t);
		}
		if (e.length) throw AggregateError(e, "One or more FlowCanvas plugin cleanups failed.");
	}
}, qt = (e) => {
	if (!Number.isFinite(e) || e <= 0) return "0:00";
	let t = Math.floor(e);
	return `${Math.floor(t / 60)}:${`${t % 60}`.padStart(2, "0")}`;
};
function Jt({ src: e, title: t, className: n }) {
	let r = s(null), [i, a] = c(!1), [o, l] = c(0), [u, d] = c(0), f = () => {
		let e = r.current;
		e && (l(Number.isFinite(e.currentTime) ? e.currentTime : 0), d(Number.isFinite(e.duration) ? e.duration : 0));
	}, p = () => {
		let e = r.current;
		e && (e.paused ? e.play().then(() => a(!0)).catch(() => a(!1)) : (e.pause(), a(!1)));
	}, m = (e) => {
		let t = r.current;
		!t || !Number.isFinite(e) || (t.currentTime = e, l(e));
	};
	return /* @__PURE__ */ M("div", {
		className: `${n} fc-video-preview fc-node__drag-zone`,
		children: [/* @__PURE__ */ j("video", {
			ref: r,
			className: "nowheel",
			src: e,
			draggable: !1,
			muted: !0,
			playsInline: !0,
			preload: "metadata",
			"aria-label": `${t}视频预览`,
			onPause: () => {
				a(!1), f();
			},
			onPlay: () => {
				a(!0), f();
			},
			onLoadedMetadata: f,
			onDurationChange: f,
			onTimeUpdate: f,
			onClick: p
		}), /* @__PURE__ */ M("div", {
			className: "fc-video-preview__controls nodrag nowheel",
			onPointerDown: (e) => e.stopPropagation(),
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ j("button", {
					className: "fc-video-preview__toggle",
					type: "button",
					"aria-label": `${i ? "暂停" : "播放"}视频预览`,
					onClick: p,
					children: j(i ? Se : Ce, { size: 14 })
				}),
				/* @__PURE__ */ j("input", {
					className: "fc-video-preview__progress",
					type: "range",
					min: "0",
					max: u || 0,
					step: "0.01",
					value: u ? Math.min(o, u) : 0,
					"aria-label": "视频播放进度",
					onChange: (e) => m(Number(e.currentTarget.value))
				}),
				/* @__PURE__ */ M("span", {
					className: "fc-video-preview__time",
					children: [
						qt(o),
						" / ",
						qt(u)
					]
				})
			]
		})]
	});
}
//#endregion
//#region src/react/GenerationNodePanel.tsx
var Yt = {
	idle: "待生成",
	queued: "排队中",
	running: "生成中",
	success: "已完成",
	succeeded: "已完成",
	completed: "已完成",
	error: "失败",
	cancelled: "已取消"
}, Xt = (e) => [
	"success",
	"succeeded",
	"completed",
	"complete"
].includes(String(e ?? "").toLowerCase()), Zt = 24, Qt = {
	text: [
		"GMLM 3.1",
		"DeepSeek V3",
		"Qwen Max"
	],
	image: ["nano-banana-pro(特价版 1)"],
	video: ["seedance-2.0-pro(431)"],
	audio: [
		"Mureka V9",
		"Suno V4",
		"Eleven Music"
	]
}, $t = {
	"GMLM 3.1": "极致推理，全能文本模型 Pro",
	"DeepSeek V3": "深度推理与复杂内容创作",
	"Qwen Max": "通义千问旗舰文本模型",
	"nano-banana-pro(特价版 1)": "支持 1K、2K、4K 与多种画幅的图片生成模型",
	"即梦图片 3.0": "中文创意与商业视觉生成",
	"Flux 1.1": "写实细节与构图增强模型",
	"Vidu Q2": "高一致性图生视频模型",
	"Kling 2.1": "复杂运动与镜头语言增强",
	"Seedance 1.0": "多镜头叙事视频生成模型",
	"seedance-2.0-fast": "Seedance 2.0 稳定快速渠道，支持全参数视频生成",
	"seedance-2.0-pro(431)": "Seedance 2.0 Pro 特价渠道，固定 720p，支持首尾帧与多模态参考",
	"Mureka V9": "歌曲、配乐与人声生成模型",
	"Suno V4": "完整音乐与歌词创作模型",
	"Eleven Music": "高品质音乐与音效生成模型"
}, en = {
	"nano-banana-pro(特价版 1)": "Nano Banana Pro",
	"seedance-2.0-fast": "Seedance 2.0 Fast",
	"seedance-2.0-pro(431)": "Seedance 2.0 Pro (431)"
}, tn = {
	"nano-banana-pro(特价版 1)": ["4K", "支持 14 个参考"],
	"seedance-2.0-fast": [
		"720P",
		"4–15 秒",
		"支持混合素材"
	],
	"seedance-2.0-pro(431)": [
		"固定 720P",
		"4–15 秒",
		"4 图 / 3 视频 / 1 音频"
	],
	"GMLM 3.1": ["长文本", "推理"],
	"DeepSeek V3": ["推理", "中文"],
	"Qwen Max": ["长文本", "多语言"],
	"Mureka V9": ["音乐", "人声"],
	"Suno V4": ["歌曲", "歌词"],
	"Eleven Music": ["音乐", "音效"]
}, nn = (e) => en[e] ?? e, rn = {
	生成模式: {
		text2video: "文生视频",
		image2video: "图生视频 / 首尾帧",
		mixed2video: "参考生视频"
	},
	生成声音: {
		off: "关闭声音",
		on: "生成声音"
	}
}, an = {
	生成模式: {
		text2video: "只提交提示词，不携带任何素材",
		image2video: "首帧可单独使用；尾帧需与首帧配对，不能混入参考素材",
		mixed2video: "参考素材最多 4 张图片、3 个视频、1 段音频"
	},
	视频分辨率: {
		"480p": "旧 Seedance 渠道低成本输出",
		"720p": "Seedance Pro(431) 当前唯一支持的分辨率"
	},
	视频时长: Object.fromEntries(Array.from({ length: 12 }, (e, t) => [`${t + 4}秒`, `Seedance 支持 ${t + 4} 秒视频`])),
	生成声音: {
		off: "不生成音轨",
		on: "仅旧 Seedance 渠道支持"
	},
	图片画质: {
		"标准画质 · 1K": "Nano Banana Pro 支持",
		"标准画质 · 2K": "Nano Banana Pro 支持",
		"高清画质 · 4K": "Nano Banana Pro 支持"
	}
}, on = (e, t) => rn[e]?.[t] ?? t;
function sn({ label: e, value: t, options: n, disabled: r, onChange: a, size: o = "medium" }) {
	let [l, u] = c(!1), [d, f] = c(null), [p, m] = c({
		left: 0,
		top: 0
	}), h = s(null), g = s(null);
	i(() => {
		if (!l) return;
		let e = (e) => {
			let t = e.target;
			!h.current?.contains(t) && !g.current?.contains(t) && u(!1);
		};
		return window.addEventListener("pointerdown", e, !0), () => window.removeEventListener("pointerdown", e, !0);
	}, [l]);
	let _ = l && d ? Le(/* @__PURE__ */ M("div", {
		ref: g,
		className: "fc-generation-select__menu fc-generation-select__menu--floating nodrag nowheel",
		style: p,
		role: "listbox",
		"aria-label": `${e}选项`,
		children: [/* @__PURE__ */ M("header", { children: [/* @__PURE__ */ j("strong", { children: e }), /* @__PURE__ */ j("small", { children: "选项按当前模型 API 能力提供" })] }), n.map((n) => /* @__PURE__ */ M("button", {
			type: "button",
			role: "option",
			"aria-selected": n === t,
			className: n === t ? "is-selected" : "",
			onClick: (e) => {
				e.stopPropagation(), a(n), u(!1);
			},
			children: [/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j("strong", { children: on(e, n) }), /* @__PURE__ */ j("small", { children: an[e]?.[n] ?? `提交参数：${n}` })] }), n === t && /* @__PURE__ */ j(w, { size: 14 })]
		}, n))]
	}), d) : null;
	return /* @__PURE__ */ M(A, { children: [/* @__PURE__ */ j("div", {
		ref: h,
		className: `fc-generation-select fc-generation-select--${o} nodrag nowheel${l ? " is-open" : ""}`,
		children: /* @__PURE__ */ M("button", {
			type: "button",
			"aria-label": e,
			"aria-haspopup": "listbox",
			"aria-expanded": l,
			disabled: r,
			title: `${e}：${on(e, t)}`,
			onClick: (e) => {
				if (e.stopPropagation(), l) {
					u(!1);
					return;
				}
				let t = e.currentTarget.closest(".fc-sdk");
				if (t) {
					let r = t.getBoundingClientRect(), i = e.currentTarget.getBoundingClientRect(), a = Math.min(360, 72 + n.length * 50), o = i.top - r.top - a - 6;
					f(t), m({
						left: Math.max(12, Math.min(i.left - r.left, r.width - 312)),
						top: o >= 12 ? o : i.bottom - r.top + 6
					});
				}
				u(!0);
			},
			children: [/* @__PURE__ */ j("span", { children: on(e, t) }), /* @__PURE__ */ j(T, { size: 12 })]
		})
	}), _] });
}
function cn({ label: e, value: t, options: n, disabled: r, onChange: i }) {
	let [a, o] = c(!1);
	return /* @__PURE__ */ M("div", {
		className: `fc-model-select nodrag nowheel${a ? " is-open" : ""}`,
		onBlur: (e) => {
			e.currentTarget.contains(e.relatedTarget) || o(!1);
		},
		children: [/* @__PURE__ */ M("button", {
			className: "fc-model-select__trigger",
			type: "button",
			"aria-label": e,
			"aria-haspopup": "listbox",
			"aria-expanded": a,
			disabled: r,
			onPointerDown: (e) => e.stopPropagation(),
			onClick: (e) => {
				e.stopPropagation(), o((e) => !e);
			},
			children: [
				/* @__PURE__ */ j(Oe, { size: 14 }),
				/* @__PURE__ */ j("span", {
					title: t,
					children: nn(t)
				}),
				/* @__PURE__ */ j(T, { size: 13 })
			]
		}), /* @__PURE__ */ j("div", {
			className: "fc-model-select__menu",
			role: "listbox",
			"aria-label": `${e}选项`,
			hidden: !a,
			children: n.map((e, n) => /* @__PURE__ */ M("button", {
				type: "button",
				role: "option",
				"aria-selected": e === t,
				className: e === t ? "is-selected" : "",
				onPointerDown: (e) => e.stopPropagation(),
				onClick: (t) => {
					t.stopPropagation(), i(e), o(!1);
				},
				children: [
					/* @__PURE__ */ j("span", {
						className: "fc-model-select__mark",
						children: n === 2 ? /* @__PURE__ */ j("small", { children: "万相" }) : /* @__PURE__ */ j(Oe, { size: 17 })
					}),
					/* @__PURE__ */ M("span", {
						className: "fc-model-select__copy",
						children: [
							/* @__PURE__ */ j("strong", { children: nn(e) }),
							/* @__PURE__ */ j("small", { children: $t[e] ?? "智能生成模型" }),
							/* @__PURE__ */ j("span", {
								className: "fc-model-select__badges",
								children: (tn[e] ?? []).map((e) => /* @__PURE__ */ j("i", { children: e }, e))
							})
						]
					}),
					e === t && /* @__PURE__ */ j(w, {
						className: "fc-model-select__check",
						size: 17
					})
				]
			}, e))
		})]
	});
}
var ln = (e) => {
	let t = e.data.generationMode;
	return Z(t) ? t : Mt(e.type) ?? "text";
}, un = (e) => e.startsWith("image/") ? "image" : e.startsWith("video/") ? "video" : e.startsWith("audio/") ? "audio" : e.startsWith("text/") ? "text" : "file", dn = (e) => {
	if (typeof URL > "u" || typeof URL.createObjectURL != "function") return "";
	try {
		return URL.createObjectURL(e);
	} catch {
		return "";
	}
}, fn = (e) => {
	let t = e.type || "application/octet-stream", n = dn(e), r = {
		id: `${e.name}-${e.size}-${e.lastModified}`,
		name: e.name,
		kind: un(t),
		mimeType: t,
		size: Number.isFinite(e.size) ? e.size : 0,
		lastModified: Number.isFinite(e.lastModified) ? e.lastModified : 0
	};
	return n && (r.url = n), r;
}, Q = (e) => typeof e == "string" ? e : e.id || e.name, $ = (e) => typeof e == "string" ? e : e.name || e.id, pn = (e) => typeof e == "string" ? "" : e.url ?? "", mn = (e) => typeof e == "string" ? void 0 : e.kind, hn = (e) => typeof e == "string" ? "" : e.mimeType ?? "", gn = (e, t, n = 24) => {
	let r = /* @__PURE__ */ new Map();
	for (let n of [...e, ...t]) {
		let e = Q(n);
		e && r.set(e, n);
	}
	return [...r.values()].slice(0, n);
}, _n = (e, t, n, r = "", i = "") => {
	if (!r || i && r !== i) return {};
	let a = [
		t,
		n,
		...e
	].find((e) => pn(e) && pn(e) !== i) ?? "";
	return a ? {
		preview: pn(a),
		previewKind: mn(a) ?? "",
		mimeType: hn(a),
		fileName: $(a)
	} : {
		preview: "",
		previewKind: "",
		mimeType: "",
		fileName: ""
	};
};
function vn({ source: e, kind: t, alt: n }) {
	return t === "video" ? /* @__PURE__ */ j(Jt, {
		src: e,
		title: n,
		className: "fc-generation-node__video-preview"
	}) : t === "audio" ? /* @__PURE__ */ j("div", {
		className: "fc-generation-node__audio-preview nodrag nowheel",
		children: /* @__PURE__ */ j("audio", {
			src: e,
			controls: !0,
			preload: "metadata",
			"aria-label": n
		})
	}) : /* @__PURE__ */ j("img", {
		src: e,
		alt: n
	});
}
function yn({ reference: e }) {
	let t = pn(e), n = mn(e);
	return t && n === "image" ? /* @__PURE__ */ j("img", {
		src: t,
		alt: ""
	}) : t && n === "video" ? /* @__PURE__ */ j("video", {
		src: t,
		muted: !0,
		preload: "metadata",
		"aria-hidden": "true"
	}) : j(n === "video" ? ae : n === "audio" ? te : n === "image" ? ue : S, {
		"aria-hidden": "true",
		size: 13
	});
}
function bn({ node: e, definition: t, readOnly: n, running: r, onUpdateData: a, onCaptureSnapshot: o, onCommitSnapshot: l, onDraftChange: u, onChangeMode: d, onRun: f, onCancel: p, onNotify: m, getReferences: h, connectedReferences: g, onDisconnectReference: _ }) {
	let v = ln(e), y = Lt(e.data.generationDrafts, e.data, v), b = y[v], ne = Ft(v), C = typeof e.data.status == "string" ? e.data.status : "idle", re = typeof e.data.preview == "string" ? e.data.preview : "", T = e.data.previewKind === "video" || e.data.previewKind === "audio" || e.data.previewKind === "image" ? e.data.previewKind : void 0, [E, ie] = c(!1), [D, O] = c(null), [se, ce] = c("image"), [k, fe] = c("reference"), [he, ge] = c(!1), [ve, ye] = c(null), [be, xe] = c({
		left: 0,
		top: 0
	}), [Se, Ce] = c(""), [Te, Ee] = c(b.prompt), De = s(null), ke = s(null), Ae = s(null), je = s("reference"), Me = s(!1), Ne = s(!1), Fe = s(void 0);
	i(() => {
		!Me.current && !Ne.current && Ee(b.prompt);
	}, [
		b.prompt,
		v,
		e.id
	]), i(() => {
		let e = ke.current;
		e && (e.style.height = "auto", e.style.height = `${Math.max(64, e.scrollHeight)}px`);
	}, [Te, v]), i(() => {
		if (!D && !he) return;
		let t = (t) => {
			let n = t.target;
			Ae.current?.contains(n) || (n?.closest("[data-flowcanvas-floating-owner]"))?.getAttribute("data-flowcanvas-floating-owner") !== e.id && (O(null), ge(!1));
		};
		return window.addEventListener("pointerdown", t, !0), () => window.removeEventListener("pointerdown", t, !0);
	}, [
		D,
		he,
		e.id
	]);
	let N = (e, t = {}, n) => {
		let r = structuredClone(y);
		Object.assign(r[v], e), a({
			...Rt(v, r),
			status: "idle",
			progress: 0,
			runMessage: "",
			runError: "",
			...t
		}, n);
	}, Re = () => {
		if (!Me.current) return;
		Me.current = !1, Ne.current = !1;
		let e = Fe.current;
		Fe.current = void 0, e && l("编辑生成提示词", e), u(!1);
	}, ze = () => {
		n || Me.current || (Me.current = !0, Fe.current = o(), u(!0, Re));
	}, Be = (e) => {
		n || (ze(), Ee(e), N({ prompt: e }, {}, {
			record: !1,
			transient: !0
		}));
	}, P = (e) => {
		Ne.current = !1, e.currentTarget.value !== Te && Be(e.currentTarget.value);
	}, F = (e = "reference") => {
		n || (je.current = e, De.current?.click());
	}, I = (e, t = 460) => {
		let n = e.closest(".fc-sdk");
		if (!n) return;
		let r = n.getBoundingClientRect(), i = e.getBoundingClientRect(), a = i.right - r.left + 12, o = a + t <= r.width - 12 ? a : Math.max(12, i.left - r.left - t - 12), s = Math.max(12, Math.min(i.top - r.top - 8, r.height - 590));
		xe({
			left: o,
			top: s
		});
	}, L = (e, t, n = "reference") => {
		if (D === e && k === n) {
			O(null);
			return;
		}
		I(t), ge(!1), Ce(""), e === "asset" && ce("image"), fe(n), O(e);
	}, Ve = (e) => {
		let t = je.current, n = Array.from(e.currentTarget.files ?? []);
		if (e.currentTarget.value = "", !n.length) return;
		let r = v === "video" && t !== "reference" ? n.filter((e) => (e.type || "").startsWith("image/")).slice(0, 1) : n.filter((e) => /^(image|video|audio)\//.test(e.type || "") || v !== "video");
		if (!r.length) {
			m(t === "reference" ? "参考素材仅支持图片、视频或音频" : "首帧和尾帧必须选择图片");
			return;
		}
		let i = v === "image" ? 14 : Zt, a = Math.max(0, i - b.references.length), o = r.map(fn).slice(0, t === "reference" ? a : 1);
		if (!o.length) {
			m(`当前模型最多支持 ${i} 个参考素材`);
			return;
		}
		let s = o.map((e) => e.name), c = o[0], l = c?.url ? {
			preview: c.url,
			previewKind: c.kind,
			mimeType: c.mimeType,
			fileName: c.name
		} : {};
		if (v === "video" && t !== "reference") N({
			[t]: c ?? s[0] ?? "",
			modeType: y.video.modeType === "mixed2video" ? "mixed2video" : "image2video"
		});
		else if (v === "video") {
			let e = o.some((e) => e.kind === "video" || e.kind === "audio");
			N({
				references: gn(b.references, o),
				modeType: e ? "mixed2video" : y.video.modeType === "text2video" ? "image2video" : y.video.modeType
			}, l);
		} else N({ references: gn(b.references, o, i) }, l);
		n.length > o.length && m(`已达到当前模型的 ${i} 个参考素材上限`), m(`已添加 ${s.length} 个本地素材引用`);
	}, He = (e) => ({
		id: `node:${e.sourceNodeId || e.id}`,
		name: e.title,
		kind: e.kind ?? "file",
		mimeType: e.mimeType,
		url: e.preview
	}), R = (e) => k === "firstFrame" || k === "lastFrame" || v === "image" ? e.kind === "image" : e.kind === "image" || e.kind === "video" || e.kind === "audio", z = async (e) => {
		if (!e.preview) return;
		let t = e.kind === "video" ? "mp4" : e.kind === "audio" ? "mp3" : "png", n = (e.title || `flowcanvas-${e.kind || "asset"}`).replace(/[\\/:*?\"<>|]/g, "_"), r = document.createElement("a");
		r.download = n.toLowerCase().endsWith(`.${t}`) ? n : `${n}.${t}`;
		try {
			let t = await fetch(e.preview);
			if (!t.ok) throw Error(`HTTP ${t.status}`);
			let n = URL.createObjectURL(await t.blob());
			r.href = n, r.click(), window.setTimeout(() => URL.revokeObjectURL(n), 1e3);
		} catch {
			r.href = e.preview, r.target = "_blank", r.rel = "noopener", r.click();
		}
		m(`已导出素材：${e.title}`);
	}, Ue = (e) => {
		if (!R(e)) {
			m(k === "reference" ? "当前节点不支持使用这种素材" : "首帧和尾帧只能选择图片素材");
			return;
		}
		let t = He(e);
		if (v === "video" && (k === "firstFrame" || k === "lastFrame")) {
			if (t.kind !== "image") {
				m("首帧和尾帧只能选择图片素材");
				return;
			}
			N({
				[k]: t,
				modeType: "image2video"
			});
		} else {
			let e = v === "video" ? t.kind === "video" || t.kind === "audio" ? "mixed2video" : y.video.modeType === "text2video" ? "image2video" : y.video.modeType : void 0;
			N({
				references: gn(b.references, [t], v === "image" ? 14 : Zt),
				...e ? { modeType: e } : {}
			});
		}
		O(null), m(`已添加画布素材：${e.title}`);
	}, We = (e) => {
		let t = String(e.prompt || "").trim(), n = t ? `@${e.title}「${t}」` : `@${e.title}`, r = e.preview && e.kind ? gn(b.references, [He(e)], v === "image" ? 14 : Zt) : b.references;
		N({
			references: r,
			prompt: `${b.prompt.trimEnd()}${b.prompt.trim() ? " " : ""}${n} `
		}), O(null), m(`已在提示词中引用：${e.title}`);
	}, B = (e) => {
		if (n) return;
		let t = pn(e), r = b.references.filter((t) => Q(t) !== Q(e));
		if (N({ references: r }, _n(r, y.video.firstFrame, y.video.lastFrame, re, t)), t.startsWith("blob:") && typeof URL < "u") try {
			URL.revokeObjectURL(t);
		} catch {}
		m(`已移除素材：${$(e)}`);
	}, V = (e) => {
		if (n) return;
		let t = y.video[e];
		if (!t) return;
		let r = pn(t), i = T === "image" && !!r && re === r;
		N({ [e]: "" }, i ? {
			preview: "",
			previewKind: "",
			mimeType: "",
			fileName: ""
		} : {});
		let a = qe.get(Q(t));
		if (a?.sourceNodeId && _(a.sourceNodeId, a.targetPort, a.id), r.startsWith("blob:") && typeof URL < "u") try {
			URL.revokeObjectURL(r);
		} catch {}
		m(`已移除${e === "firstFrame" ? "首帧" : "尾帧"}素材${a ? "并断开对应连线" : ""}`);
	}, Ge = (e) => N(e === "seedance-2.0-pro(431)" ? {
		model: e,
		resolution: "720p",
		ratio: [
			"16:9",
			"9:16",
			"1:1"
		].includes(y.video.ratio) ? y.video.ratio : "16:9",
		enableSound: "off"
	} : { model: e }), H = b.prompt.trim().length > 0, U = C === "running" || C === "queued", Ke = (D ? h().filter((t) => t.id !== e.id) : []).filter((e) => D === "mention" ? !0 : !Xt(e.status) || !e.preview || !e.kind ? !1 : e.kind === se).filter((e) => {
		let t = Se.trim().toLowerCase();
		return !t || `${e.title} ${e.prompt || ""}`.toLowerCase().includes(t);
	}), qe = new Map(g.map((e) => [`node:${e.sourceNodeId || e.id}`, e])), W = v === "video" && y.video.model === "seedance-2.0-pro(431)", Je = g.filter((e) => Xt(e.status) && e.preview && e.kind).map((e) => He(e)), G = gn(b.references, Je, 24), K = y.video.firstFrame, q = y.video.lastFrame, Ye = `fc-generation-node${E ? " is-expanded" : ""}`, Xe = b.references.find((e) => typeof e != "string" && e.url), J = v === "video" && T === "image" ? "" : re, Ze = J || (v === "video" ? "" : pn(Xe ?? "")), Qe = J ? T : v === "video" ? void 0 : mn(Xe ?? ""), Y = Ae.current?.closest(".fc-sdk"), $e = ve && Y ? Le(/* @__PURE__ */ j("div", {
		className: "fc-generation-media-preview-backdrop nodrag nowheel",
		"data-flowcanvas-floating-owner": e.id,
		role: "dialog",
		"aria-label": "素材预览",
		onPointerDown: () => ye(null),
		children: /* @__PURE__ */ M("article", {
			onPointerDown: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ j("button", {
					type: "button",
					"aria-label": "关闭素材预览",
					onClick: () => ye(null),
					children: /* @__PURE__ */ j(Ie, { size: 18 })
				}),
				/* @__PURE__ */ j("div", {
					className: "fc-generation-media-preview-content",
					children: /* @__PURE__ */ j(vn, {
						source: pn(ve),
						kind: mn(ve),
						alt: $(ve)
					})
				}),
				/* @__PURE__ */ j("strong", { children: $(ve) })
			]
		})
	}), Y) : null, et = D && Y ? Le(/* @__PURE__ */ M("div", {
		className: "fc-generation-reference-popover fc-generation-floating-panel nodrag nowheel",
		style: be,
		"data-flowcanvas-floating-owner": e.id,
		role: "listbox",
		"aria-label": D === "asset" ? "选择画布素材" : "插入节点引用",
		children: [
			/* @__PURE__ */ M("header", { children: [
				/* @__PURE__ */ j("strong", { children: D === "asset" ? "选择画布素材" : "插入 @ 节点引用" }),
				/* @__PURE__ */ j("small", { children: D === "asset" ? "加入参考素材，不改写提示词" : "插入节点上下文；媒体节点同时加入素材" }),
				D === "asset" && /* @__PURE__ */ M("div", {
					className: "fc-generation-reference-tabs",
					role: "tablist",
					"aria-label": "素材类型",
					children: [/* @__PURE__ */ M("button", {
						type: "button",
						role: "tab",
						"aria-selected": se === "image",
						onClick: () => ce("image"),
						children: [/* @__PURE__ */ j(ue, { size: 14 }), "图片"]
					}), /* @__PURE__ */ M("button", {
						type: "button",
						role: "tab",
						"aria-selected": se === "video",
						onClick: () => ce("video"),
						children: [/* @__PURE__ */ j(ae, { size: 14 }), "视频"]
					})]
				}),
				/* @__PURE__ */ j("input", {
					"aria-label": "搜索画布节点",
					value: Se,
					onChange: (e) => Ce(e.target.value),
					placeholder: "搜索节点名称或提示词"
				})
			] }),
			/* @__PURE__ */ j("div", {
				className: "fc-generation-reference-popover__grid",
				children: Ke.length ? Ke.map((e) => {
					let t = `node:${e.sourceNodeId || e.id}`, n = k === "firstFrame" ? Q(K) === t : k === "lastFrame" ? Q(q) === t : G.some((e) => Q(e) === t), r = R(e), i = /* @__PURE__ */ M(A, { children: [
						/* @__PURE__ */ j("span", {
							className: "fc-generation-reference-popover__thumb",
							children: e.preview && e.kind === "image" ? /* @__PURE__ */ j("img", {
								src: e.preview,
								alt: ""
							}) : e.preview && e.kind === "video" ? /* @__PURE__ */ j("video", {
								src: e.preview,
								muted: !0,
								preload: "metadata",
								"aria-hidden": "true"
							}) : e.kind === "image" ? /* @__PURE__ */ j(ue, { size: 16 }) : e.kind === "video" ? /* @__PURE__ */ j(ae, { size: 16 }) : e.kind === "audio" ? /* @__PURE__ */ j(te, { size: 16 }) : /* @__PURE__ */ j(S, { size: 16 })
						}),
						/* @__PURE__ */ M("span", {
							className: "fc-generation-reference-popover__copy",
							children: [/* @__PURE__ */ j("strong", { children: e.title }), /* @__PURE__ */ M("small", { children: [
								e.kind,
								" · ",
								Yt[e.status || "idle"] ?? e.status ?? "待生成"
							] })]
						}),
						e.prompt && /* @__PURE__ */ j("span", {
							className: "fc-generation-material-tooltip",
							role: "tooltip",
							children: e.prompt
						})
					] });
					return D === "mention" ? /* @__PURE__ */ M("button", {
						type: "button",
						role: "option",
						"aria-selected": n,
						className: "fc-generation-reference-card",
						onClick: () => We(e),
						children: [i, /* @__PURE__ */ j("span", {
							className: "fc-generation-reference-popover__state",
							children: n ? /* @__PURE__ */ j(w, { size: 14 }) : `#${e.id.slice(-5)}`
						})]
					}, e.id) : /* @__PURE__ */ M("article", {
						role: "option",
						"aria-selected": n,
						className: "fc-generation-reference-card",
						children: [
							/* @__PURE__ */ j("button", {
								className: "fc-generation-reference-card__preview",
								type: "button",
								"aria-label": `预览素材 ${e.title}`,
								onClick: () => ye(He(e)),
								children: i
							}),
							/* @__PURE__ */ j("button", {
								className: "fc-generation-reference-card__export",
								type: "button",
								"aria-label": `导出素材 ${e.title}`,
								title: "导出素材",
								onClick: () => void z(e),
								children: /* @__PURE__ */ j(oe, { size: 13 })
							}),
							/* @__PURE__ */ j("button", {
								className: "fc-generation-reference-card__use",
								type: "button",
								"aria-label": `使用素材 ${e.title}`,
								title: r ? "使用素材" : "当前节点不支持此素材类型",
								disabled: !r,
								onClick: () => Ue(e),
								children: j(n ? w : we, { size: 13 })
							})
						]
					}, e.id);
				}) : /* @__PURE__ */ j("p", { children: D === "asset" ? `当前画布暂无可用${se === "image" ? "图片" : "视频"}素材` : "没有匹配的画布节点" })
			}),
			D === "asset" && /* @__PURE__ */ M("button", {
				className: "fc-generation-reference-popover__upload",
				type: "button",
				onClick: () => {
					O(null), F(k);
				},
				children: [
					/* @__PURE__ */ j("span", {
						className: "fc-generation-reference-popover__thumb",
						children: /* @__PURE__ */ j(Pe, { size: 16 })
					}),
					/* @__PURE__ */ M("span", {
						className: "fc-generation-reference-popover__copy",
						children: [/* @__PURE__ */ j("strong", { children: "上传本地素材" }), /* @__PURE__ */ j("small", { children: k === "reference" ? "支持图片、视频和音频" : "首帧/尾帧仅支持图片" })]
					}),
					/* @__PURE__ */ j(we, { size: 14 })
				]
			})
		]
	}), Y) : null, tt = he && Y ? Le(/* @__PURE__ */ M("div", {
		className: "fc-generation-reference-popover fc-generation-reference-library fc-generation-floating-panel nodrag nowheel",
		style: be,
		"data-flowcanvas-floating-owner": e.id,
		role: "dialog",
		"aria-label": "全部参考素材",
		children: [/* @__PURE__ */ M("header", { children: [/* @__PURE__ */ j("strong", { children: "全部参考素材" }), /* @__PURE__ */ M("small", { children: [
			"共 ",
			G.length,
			" 项，可在这里预览或移除"
		] })] }), /* @__PURE__ */ j("div", {
			className: "fc-generation-reference-library__grid",
			children: G.map((e) => {
				let t = qe.get(Q(e));
				return /* @__PURE__ */ M("article", { children: [
					/* @__PURE__ */ j("span", { children: /* @__PURE__ */ j(yn, { reference: e }) }),
					/* @__PURE__ */ j("strong", {
						title: $(e),
						children: $(e)
					}),
					/* @__PURE__ */ j("button", {
						type: "button",
						"aria-label": `移除素材 ${$(e)}`,
						disabled: n,
						onClick: () => t?.sourceNodeId ? _(t.sourceNodeId, t.targetPort, t.id) : B(e),
						children: /* @__PURE__ */ j(Ie, { size: 12 })
					})
				] }, Q(e));
			})
		})]
	}), Y) : null, nt = G.length > 0 && /* @__PURE__ */ j("div", {
		className: "fc-generation-reference-chips",
		"aria-label": "已选参考素材",
		children: /* @__PURE__ */ M("div", {
			className: "fc-generation-reference-chips__list",
			children: [G.slice(0, 3).map((e) => {
				let t = qe.get(Q(e)), r = t?.prompt || "";
				return /* @__PURE__ */ M("span", {
					className: `fc-generation-reference-chip${t ? " is-connected" : ""}`,
					title: $(e),
					children: [
						/* @__PURE__ */ j("span", {
							className: "fc-generation-reference-chip__preview",
							children: /* @__PURE__ */ j(yn, { reference: e })
						}),
						/* @__PURE__ */ j("button", {
							type: "button",
							"aria-label": `移除素材 ${$(e)}`,
							disabled: n,
							onClick: () => t?.sourceNodeId ? _(t.sourceNodeId, t.targetPort, t.id) : B(e),
							children: /* @__PURE__ */ j(Ie, { size: 10 })
						}),
						r && /* @__PURE__ */ j("span", {
							className: "fc-generation-material-tooltip",
							role: "tooltip",
							children: r
						})
					]
				}, Q(e));
			}), G.length > 3 && /* @__PURE__ */ M("button", {
				className: "fc-generation-reference-chips__more",
				type: "button",
				"aria-label": `查看全部 ${G.length} 个参考素材`,
				onClick: (e) => {
					I(e.currentTarget), O(null), ge((e) => !e);
				},
				children: ["+", G.length - 3]
			})]
		})
	});
	return /* @__PURE__ */ M(A, { children: [
		/* @__PURE__ */ M("div", {
			ref: Ae,
			className: Ye,
			"data-generation-mode": v,
			children: [
				/* @__PURE__ */ M("header", {
					className: "fc-generation-node__heading fc-node__header fc-node__drag-zone",
					children: [
						/* @__PURE__ */ j("span", {
							className: "fc-generation-node__badge",
							style: { color: t.color },
							children: /* @__PURE__ */ j(we, { size: 11 })
						}),
						/* @__PURE__ */ j("strong", { children: e.data.title }),
						/* @__PURE__ */ M("span", {
							className: `fc-node__status fc-node__status--${C}`,
							children: [/* @__PURE__ */ j("i", {}), Yt[C] ?? "待生成"]
						})
					]
				}),
				/* @__PURE__ */ M("div", {
					className: "fc-generation-node__preview fc-node__drag-zone",
					children: [
						Ze ? /* @__PURE__ */ j(vn, {
							source: Ze,
							kind: Qe,
							alt: `${String(e.data.title)}预览`
						}) : /* @__PURE__ */ j("button", {
							className: "nodrag",
							type: "button",
							disabled: n || !ne.accept,
							onClick: () => F(),
							"aria-label": "添加节点素材",
							children: /* @__PURE__ */ j(le, { size: 26 })
						}),
						U && /* @__PURE__ */ M("div", {
							className: "fc-generation-node__waiting",
							"aria-hidden": "true",
							children: [/* @__PURE__ */ j(de, { size: 34 }), /* @__PURE__ */ j("span", { children: C === "queued" ? "等待中" : "生成中" })]
						}),
						C === "error" && /* @__PURE__ */ M("div", {
							className: "fc-generation-node__error",
							role: "alert",
							children: [/* @__PURE__ */ j("strong", { children: "生成失败" }), /* @__PURE__ */ j("span", { children: String(e.data.runError || e.data.runMessage || "模型平台未返回失败详情") })]
						}),
						U && /* @__PURE__ */ M("div", {
							className: "fc-generation-node__running",
							role: "status",
							children: [/* @__PURE__ */ j("span", { children: String(e.data.runMessage || (C === "queued" ? "排队中" : "生成中")) }), /* @__PURE__ */ M("strong", { children: [Math.round(Number(e.data.progress ?? 0) * 100), "%"] })]
						}),
						U && /* @__PURE__ */ j("div", {
							className: "fc-generation-node__progress",
							children: /* @__PURE__ */ j("span", { style: { width: `${Math.round(Number(e.data.progress ?? 0) * 100)}%` } })
						})
					]
				}),
				/* @__PURE__ */ M("section", {
					className: "fc-generation-composer nodrag nowheel",
					"aria-label": `${ne.label}输入面板`,
					children: [/* @__PURE__ */ M("div", {
						className: "fc-generation-tabs",
						role: "tablist",
						"aria-label": "生成类型",
						children: [xt.map((e) => {
							let t = Ft(e);
							return /* @__PURE__ */ j("button", {
								type: "button",
								role: "tab",
								"aria-label": t.label,
								"aria-selected": v === e,
								className: v === e ? "is-active" : "",
								disabled: n,
								onClick: () => d(e),
								children: t.label
							}, e);
						}), /* @__PURE__ */ j("button", {
							className: "fc-generation-expand",
							type: "button",
							"aria-label": E ? "收起输入面板" : "展开输入面板",
							onClick: () => ie((e) => !e),
							children: j(E ? me : pe, { size: 15 })
						})]
					}), /* @__PURE__ */ M("div", {
						className: "fc-generation-input",
						"data-mode": v,
						children: [
							(v === "text" || v === "image") && /* @__PURE__ */ M("div", {
								className: "fc-generation-material-row",
								children: [/* @__PURE__ */ M("div", {
									className: "fc-generation-attachments",
									children: [/* @__PURE__ */ M("button", {
										type: "button",
										disabled: n,
										onClick: () => F(),
										children: [/* @__PURE__ */ j(Pe, { size: 15 }), /* @__PURE__ */ j("span", { children: "上传" })]
									}), /* @__PURE__ */ M("button", {
										type: "button",
										title: "从画布已生成素材中选择",
										disabled: n,
										onClick: (e) => L("asset", e.currentTarget),
										children: [/* @__PURE__ */ j(_e, { size: 15 }), /* @__PURE__ */ j("span", { children: "选择素材" })]
									})]
								}), nt]
							}),
							v === "video" && /* @__PURE__ */ M("div", {
								className: "fc-generation-material-row",
								children: [/* @__PURE__ */ M("div", {
									className: "fc-generation-frames",
									children: [
										/* @__PURE__ */ M("div", {
											className: "fc-generation-frame-slot",
											children: [/* @__PURE__ */ M("button", {
												className: K ? "is-selected" : "",
												type: "button",
												title: K ? "在画布中央预览首帧" : "从画布素材中选择首帧",
												disabled: n,
												onClick: (e) => K ? ye(K) : L("asset", e.currentTarget, "firstFrame"),
												children: [j(K ? ue : we, { size: 16 }), /* @__PURE__ */ j("span", { children: "首帧" })]
											}), K && /* @__PURE__ */ j("button", {
												className: "fc-generation-remove-media",
												type: "button",
												"aria-label": "移除首帧素材",
												disabled: n,
												onClick: () => V("firstFrame"),
												children: /* @__PURE__ */ j(Ie, { size: 10 })
											})]
										}),
										/* @__PURE__ */ j(x, { size: 16 }),
										/* @__PURE__ */ M("div", {
											className: "fc-generation-frame-slot",
											children: [/* @__PURE__ */ M("button", {
												className: q ? "is-selected" : "",
												type: "button",
												title: q ? "在画布中央预览尾帧" : "从画布素材中选择尾帧",
												disabled: n,
												onClick: (e) => q ? ye(q) : L("asset", e.currentTarget, "lastFrame"),
												children: [j(q ? ue : we, { size: 16 }), /* @__PURE__ */ j("span", { children: "尾帧" })]
											}), q && /* @__PURE__ */ j("button", {
												className: "fc-generation-remove-media",
												type: "button",
												"aria-label": "移除尾帧素材",
												disabled: n,
												onClick: () => V("lastFrame"),
												children: /* @__PURE__ */ j(Ie, { size: 10 })
											})]
										}),
										/* @__PURE__ */ j("div", {
											className: "fc-generation-frame-slot",
											children: /* @__PURE__ */ M("button", {
												type: "button",
												title: "选择画布素材或上传图片、视频和音频",
												disabled: n,
												onClick: (e) => L("asset", e.currentTarget, "reference"),
												children: [/* @__PURE__ */ j(_e, { size: 15 }), /* @__PURE__ */ j("span", { children: "选择素材" })]
											})
										})
									]
								}), nt]
							}),
							/* @__PURE__ */ j("textarea", {
								ref: ke,
								className: "nodrag nowheel",
								"data-flowcanvas-ignore-shortcuts": !0,
								"aria-label": `${ne.label}描述`,
								readOnly: n,
								value: Te,
								placeholder: ne.placeholder,
								onPointerDown: (e) => e.stopPropagation(),
								onFocus: ze,
								onCompositionStart: () => {
									ze(), Ne.current = !0;
								},
								onCompositionEnd: P,
								onChange: (e) => Be(e.target.value),
								onBlur: Re
							}),
							/* @__PURE__ */ M("footer", {
								className: "fc-generation-parameters",
								children: [/* @__PURE__ */ M("div", {
									className: "fc-generation-parameters__left",
									children: [
										/* @__PURE__ */ j(cn, {
											label: `${ne.label}模型`,
											value: b.model,
											options: Qt[v],
											disabled: n,
											onChange: Ge
										}),
										v === "image" && /* @__PURE__ */ M(A, { children: [
											/* @__PURE__ */ j(sn, {
												size: "compact",
												label: "图片比例",
												value: y.image.ratio,
												options: [
													"auto",
													"1:1",
													"16:9",
													"9:16",
													"4:3",
													"3:4",
													"3:2",
													"2:3",
													"5:4",
													"4:5",
													"21:9"
												],
												disabled: n,
												onChange: (e) => N({ ratio: e })
											}),
											/* @__PURE__ */ j(sn, {
												size: "wide",
												label: "图片画质",
												value: y.image.quality,
												options: [
													"标准画质 · 1K",
													"标准画质 · 2K",
													"高清画质 · 4K"
												],
												disabled: n,
												onChange: (e) => N({ quality: e })
											}),
											/* @__PURE__ */ j("button", {
												className: "fc-generation-reference-button",
												type: "button",
												title: "在提示词中插入 @ 节点引用",
												"aria-label": "插入节点引用",
												disabled: n,
												onClick: (e) => L("mention", e.currentTarget),
												children: /* @__PURE__ */ j(S, { size: 15 })
											}),
											/* @__PURE__ */ j(sn, {
												size: "compact",
												label: "图片数量",
												value: "1张",
												options: ["1张"],
												disabled: !0,
												onChange: () => {}
											})
										] }),
										v === "video" && /* @__PURE__ */ M(A, { children: [
											/* @__PURE__ */ j(sn, {
												size: "compact",
												label: "视频比例",
												value: y.video.ratio,
												options: W ? [
													"16:9",
													"9:16",
													"1:1"
												] : [
													"adaptive",
													"16:9",
													"4:3",
													"1:1",
													"3:4",
													"9:16",
													"21:9"
												],
												disabled: n,
												onChange: (e) => N({ ratio: e })
											}),
											/* @__PURE__ */ j(sn, {
												size: "medium",
												label: "视频分辨率",
												value: W ? "720p" : y.video.resolution,
												options: W ? ["720p"] : ["480p", "720p"],
												disabled: n || W,
												onChange: (e) => N({ resolution: e })
											}),
											/* @__PURE__ */ j(sn, {
												size: "compact",
												label: "视频时长",
												value: `${y.video.duration}秒`,
												options: Array.from({ length: 12 }, (e, t) => `${t + 4}秒`),
												disabled: n,
												onChange: (e) => N({ duration: Number.parseInt(e, 10) })
											}),
											!W && /* @__PURE__ */ j(sn, {
												size: "compact",
												label: "生成声音",
												value: y.video.enableSound,
												options: ["off", "on"],
												disabled: n,
												onChange: (e) => N({ enableSound: e })
											}),
											/* @__PURE__ */ j("button", {
												className: "fc-generation-reference-button",
												type: "button",
												title: "在提示词中插入 @ 节点引用",
												"aria-label": "插入节点引用",
												disabled: n,
												onClick: (e) => L("mention", e.currentTarget),
												children: /* @__PURE__ */ j(S, { size: 15 })
											})
										] }),
										v === "audio" && /* @__PURE__ */ j(A, { children: /* @__PURE__ */ j(sn, {
											size: "wide",
											label: "歌词生成方式",
											value: y.audio.lyricsMode,
											options: [
												"自动生成",
												"纯音乐",
												"自定义歌词"
											],
											disabled: n,
											onChange: (e) => N({ lyricsMode: e })
										}) })
									]
								}), /* @__PURE__ */ M("div", {
									className: "fc-generation-submit-group",
									children: [/* @__PURE__ */ M("span", {
										className: "fc-generation-credit",
										title: "预计消耗",
										children: [/* @__PURE__ */ j(Oe, { size: 13 }), zt(v, y)]
									}), /* @__PURE__ */ j("button", {
										className: "fc-generation-submit",
										type: "button",
										"aria-label": U ? "取消当前节点" : C === "success" ? "重新生成当前节点" : "生成当前节点",
										title: U ? "取消生成" : C === "success" ? "重新生成（不会复用缓存）" : "开始生成",
										disabled: n || !U && !H,
										onClick: U ? p : () => {
											let e = (e) => G.filter((t) => mn(t) === e).length;
											if (v === "image" && e("image") > 14) {
												m("当前模型最多支持 14 张参考图片，请先移除多余素材");
												return;
											}
											if (W) {
												let t = [
													[
														"image",
														4,
														"参考图片"
													],
													[
														"video",
														3,
														"参考视频"
													],
													[
														"audio",
														1,
														"参考音频"
													]
												].find(([t, n]) => e(t) > n);
												if (t) {
													m(`Seedance 2.0 Pro 最多支持 ${t[1]} 个${t[2]}，请先移除多余素材`);
													return;
												}
												if ((K || q) && G.length) {
													m("Seedance 2.0 Pro 的首尾帧模式不能同时使用参考图片、视频或音频");
													return;
												}
											}
											f();
										},
										children: /* @__PURE__ */ j(ee, { size: 17 })
									})]
								})]
							})
						]
					})]
				}),
				/* @__PURE__ */ j("input", {
					ref: De,
					className: "fc-generation-file-input nodrag",
					type: "file",
					tabIndex: -1,
					hidden: !0,
					multiple: je.current === "reference",
					accept: ne.accept,
					onChange: Ve
				})
			]
		}),
		et,
		tt,
		$e
	] });
}
//#endregion
//#region src/react/PluginBoundary.tsx
var xn = class extends t {
	state = {};
	static getDerivedStateFromError(e) {
		return { error: e };
	}
	componentDidCatch(e, t) {
		this.props.onError(e, t);
	}
	componentDidUpdate(e) {
		this.state.error && e.resetKey !== this.props.resetKey && this.setState({ error: void 0 });
	}
	render() {
		return this.state.error ? this.props.fallback : this.props.children;
	}
}, Sn = {
	text: ce,
	image: ue,
	video: ae,
	audio: te,
	output: xe
}, Cn = {
	idle: "待运行",
	queued: "队列中",
	running: "运行中",
	success: "已完成",
	error: "失败",
	cancelled: "已取消"
}, wn = (e, t) => Object.prototype.hasOwnProperty.call(e, t) ? e[t] : void 0, Tn = (e) => {
	let t = e.previewKind ?? e.mediaType ?? e.assetKind;
	if (t === "image" || t === "video" || t === "audio") return t;
	let n = typeof e.mimeType == "string" ? e.mimeType : "";
	if (n.startsWith("image/")) return "image";
	if (n.startsWith("video/")) return "video";
	if (n.startsWith("audio/")) return "audio";
}, En = (e) => !!e && typeof e == "object" && !Array.isArray(e), Dn = (e) => {
	let t = e.kind ?? e.previewKind ?? e.mediaType ?? e.assetKind;
	if (t === "image" || t === "video" || t === "audio") return t;
	let n = typeof e.mimeType == "string" ? e.mimeType : "";
	if (n.startsWith("image/")) return "image";
	if (n.startsWith("video/")) return "video";
	if (n.startsWith("audio/")) return "audio";
}, On = (e) => Array.isArray(e.embeddedMedia) ? e.embeddedMedia.filter(En) : [], kn = (e) => typeof e.preview == "string" ? e.preview : typeof e.url == "string" ? e.url : "", An = (e, t) => String(e.name ?? e.fileName ?? e.title ?? t);
function jn({ src: e, kind: t, title: n }) {
	return t === "video" ? /* @__PURE__ */ j(Jt, {
		src: e,
		title: n,
		className: "fc-node__preview fc-node__preview--video"
	}) : t === "audio" ? /* @__PURE__ */ j("div", {
		className: "fc-node__preview fc-node__preview--audio fc-node__drag-zone nodrag nowheel",
		children: /* @__PURE__ */ j("audio", {
			src: e,
			controls: !0,
			preload: "metadata",
			"aria-label": `${n}音频预览`
		})
	}) : /* @__PURE__ */ j("img", {
		className: "fc-node__preview fc-node__drag-zone",
		src: e,
		width: "232",
		height: "124",
		alt: `${n}预览`
	});
}
function Mn() {
	return /* @__PURE__ */ M("div", {
		className: "fc-node__preview fc-node__blank-preview fc-node__drag-zone",
		children: [/* @__PURE__ */ j(le, { size: 28 }), /* @__PURE__ */ j("span", { children: "拖入图片、视频或音频" })]
	});
}
function Nn({ items: e, title: t }) {
	if (e.length === 1) {
		let n = e[0];
		return /* @__PURE__ */ j(jn, {
			src: kn(n),
			kind: Dn(n),
			title: An(n, t)
		});
	}
	return /* @__PURE__ */ M("div", {
		className: "fc-node__media-stack fc-node__drag-zone",
		"data-media-count": e.length,
		children: [e.slice(0, 4).map((e, n) => {
			let r = kn(e), i = Dn(e);
			return !r || !i ? null : /* @__PURE__ */ M("figure", {
				className: "fc-node__media-item",
				children: [/* @__PURE__ */ j(jn, {
					src: r,
					kind: i,
					title: An(e, `${t} ${n + 1}`)
				}), /* @__PURE__ */ j("figcaption", { children: An(e, `素材 ${n + 1}`) })]
			}, `${r}-${n}`);
		}), e.length > 4 && /* @__PURE__ */ M("span", {
			className: "fc-node__media-more",
			children: ["+", e.length - 4]
		})]
	});
}
var Pn = n(({ data: e, selected: t }) => {
	let n = e.definition, r = e.renderer, i = wn(Sn, n.icon ?? "text") ?? ce, a = e.status ?? "idle", o = typeof e.preview == "string" ? e.preview : void 0, s = On(e).filter((e) => kn(e) && Dn(e)), c = s.length ? s : o ? [{
		preview: o,
		previewKind: Tn(e),
		name: e.fileName ?? e.title
	}] : [], l = c.length ? Dn(c[0]) : Tn(e), u = Pt(n.type) || Z(e.generationMode), d = n.type === "blank", f = !u && (d || !!(c.length && (l === "image" || l === "video" || l === "audio"))), m = l ?? (d ? "blank" : "asset"), g = u ? 82 : f ? 138 : 48;
	return /* @__PURE__ */ M("article", {
		className: `fc-node fc-node--${a}${u ? " fc-node--generation" : ""}${f ? ` fc-node--media fc-node--media-${m}` : ""}${t ? " is-selected" : ""}`,
		"data-node-type": n.type,
		children: [
			n.inputs.length > 0 && /* @__PURE__ */ j(p, {
				id: "__auto_input__",
				type: "target",
				position: h.Left,
				className: "fc-port fc-port--input fc-port--auto",
				isConnectable: !e.readOnly,
				style: { top: g },
				title: "智能素材输入"
			}, "__auto_input__"),
			n.outputs.length > 0 && /* @__PURE__ */ j(p, {
				id: "__auto_output__",
				type: "source",
				position: h.Right,
				className: "fc-port fc-port--output fc-port--auto",
				isConnectable: !e.readOnly,
				style: { top: g },
				title: "智能素材输出"
			}, "__auto_output__"),
			r ? /* @__PURE__ */ j("div", {
				className: "fc-node__custom",
				children: /* @__PURE__ */ j(xn, {
					resetKey: r,
					fallback: /* @__PURE__ */ j("p", {
						className: "fc-node__error",
						children: "自定义节点渲染失败"
					}),
					onError: (t) => e.onRendererError(t),
					children: /* @__PURE__ */ j(r, {
						node: e.node,
						definition: n,
						selected: t,
						readOnly: e.readOnly
					})
				})
			}) : u ? /* @__PURE__ */ j(bn, {
				node: e.node,
				definition: n,
				readOnly: e.readOnly,
				running: e.running,
				onUpdateData: e.onUpdateData,
				onCaptureSnapshot: e.onCaptureSnapshot,
				onCommitSnapshot: e.onCommitSnapshot,
				onDraftChange: e.onDraftChange,
				onChangeMode: e.onChangeGenerationMode,
				onRun: e.onRunNode,
				onCancel: e.onCancelRun,
				onNotify: e.onNotify,
				getReferences: e.getReferences,
				connectedReferences: e.connectedReferences,
				onDisconnectReference: e.onDisconnectReference
			}) : /* @__PURE__ */ M(A, { children: [
				/* @__PURE__ */ M("header", {
					className: "fc-node__header fc-node__drag-zone",
					children: [
						/* @__PURE__ */ j("span", {
							className: "fc-node__icon",
							style: { color: n.color },
							children: /* @__PURE__ */ j(i, { size: 13 })
						}),
						/* @__PURE__ */ j("strong", { children: e.title }),
						/* @__PURE__ */ M("span", {
							className: `fc-node__status fc-node__status--${a}`,
							children: [/* @__PURE__ */ j("i", {}), wn(Cn, a) ?? "未知状态"]
						})
					]
				}),
				c.length ? /* @__PURE__ */ j(Nn, {
					items: c,
					title: String(e.title || n.title)
				}) : d ? /* @__PURE__ */ j(Mn, {}) : null,
				/* @__PURE__ */ M("div", {
					className: "fc-node__body",
					children: [
						e.prompt && /* @__PURE__ */ j("p", { children: String(e.prompt) }),
						!e.prompt && !c.length && !d && /* @__PURE__ */ j("p", { children: e.description ?? n.description }),
						a === "running" && /* @__PURE__ */ j("div", {
							className: "fc-node__progress",
							children: /* @__PURE__ */ j("span", { style: { width: `${Math.round((e.progress ?? 0) * 100)}%` } })
						}),
						!!e.runError && /* @__PURE__ */ j("p", {
							className: "fc-node__error",
							children: String(e.runError)
						}),
						/* @__PURE__ */ M("footer", { children: [/* @__PURE__ */ j("span", { children: n.category }), /* @__PURE__ */ j("span", { children: a === "running" ? `${Math.round((e.progress ?? 0) * 100)}%` : /* @__PURE__ */ M(A, { children: [
							/* @__PURE__ */ j(Ce, { size: 9 }),
							" ",
							n.type
						] }) })] })
					]
				})
			] })
		]
	});
});
Pn.displayName = "FlowNode";
//#endregion
//#region src/react/Inspector.tsx
function Fn({ engine: e, node: t, definition: n, issues: r, onClose: a, readOnly: o = !1, renderer: l, assistant: u, tab: d, onTabChange: f, onDraftChange: p }) {
	let [m, h] = c(""), [g, _] = c([]), [v, y] = c(t?.data.title ?? ""), [b, x] = c(t?.data.prompt?.toString() ?? ""), [ee, te] = c(!1), C = s(void 0), w = s(void 0);
	i(() => {
		let n = () => {
			let t = w.current;
			t && (w.current = void 0, e.commitSnapshot("编辑节点属性", t.before), p?.(!1));
		};
		return n(), y(t?.data.title ?? ""), x(t?.data.prompt?.toString() ?? ""), n;
	}, [
		e,
		t?.id,
		p
	]), i(() => {
		w.current?.field !== "title" && y(t?.data.title ?? "");
	}, [t?.data.title]), i(() => {
		w.current?.field !== "prompt" && x(t?.data.prompt?.toString() ?? "");
	}, [t?.data.prompt]), i(() => {
		!u && d === "assistant" && f("properties");
	}, [
		u,
		f,
		d
	]), i(() => () => C.current?.abort(), []);
	let re = t ? r.filter((e) => e.nodeId === t.id) : r, T = (t) => {
		let n = w.current;
		n && (w.current = void 0, e.commitSnapshot(t, n.before), p?.(!1));
	}, ie = (n) => {
		if (!t || o) return;
		let r = w.current;
		r?.nodeId === t.id && r.field === n || (r && e.commitSnapshot("编辑节点属性", r.before), w.current = {
			nodeId: t.id,
			field: n,
			before: e.captureSnapshot()
		}, p?.(!0, () => T("编辑节点属性")));
	}, ae = (n) => {
		!t || o || (ie("title"), y(n), e.updateNodeData(t.id, { title: n }, {
			record: !1,
			transient: !0
		}));
	}, oe = (n) => {
		!t || o || (ie("prompt"), x(n), e.updateNodeData(t.id, { prompt: n }, {
			record: !1,
			transient: !0
		}));
	}, se = async () => {
		let n = m.trim();
		if (!u || !n || ee) return;
		let r = new AbortController();
		C.current?.abort(), C.current = r, _((e) => [...e, {
			role: "user",
			text: n
		}]), h(""), te(!0);
		try {
			let i = await u.send({
				message: n,
				graph: e.getGraph(),
				node: t ? structuredClone(t) : void 0,
				signal: r.signal
			});
			if (r.signal.aborted) return;
			let a = (typeof i == "string" ? i : i.message).trim();
			if (!a) throw Error("AI 助手返回了空内容");
			_((e) => [...e, {
				role: "assistant",
				text: a
			}]);
		} catch (e) {
			if (r.signal.aborted) return;
			let t = e instanceof Error ? e.message : String(e);
			_((e) => [...e, {
				role: "error",
				text: `请求失败：${t}`
			}]);
		} finally {
			C.current === r && (C.current = void 0, te(!1));
		}
	};
	return /* @__PURE__ */ M("aside", {
		className: "fc-inspector",
		"aria-label": "节点属性",
		children: [
			/* @__PURE__ */ M("header", {
				className: "fc-inspector__head",
				children: [/* @__PURE__ */ j("strong", { children: t?.data.title ?? "画布检查器" }), /* @__PURE__ */ j("button", {
					type: "button",
					onClick: a,
					"aria-label": "收起属性面板",
					children: "››"
				})]
			}),
			/* @__PURE__ */ M("div", {
				className: `fc-inspector__tabs${u ? "" : " is-single"}`,
				role: "tablist",
				children: [/* @__PURE__ */ j("button", {
					className: d === "properties" ? "is-active" : "",
					type: "button",
					role: "tab",
					"aria-selected": d === "properties",
					onClick: () => f("properties"),
					children: "节点属性"
				}), u && /* @__PURE__ */ j("button", {
					className: d === "assistant" ? "is-active" : "",
					type: "button",
					role: "tab",
					"aria-selected": d === "assistant",
					onClick: () => f("assistant"),
					children: "AI 助手"
				})]
			}),
			d === "properties" ? /* @__PURE__ */ j("div", {
				className: "fc-inspector__scroll",
				children: t ? l && n ? /* @__PURE__ */ j(xn, {
					resetKey: l,
					fallback: /* @__PURE__ */ j("div", {
						className: "fc-inspector__empty",
						children: "自定义属性面板渲染失败，请检查插件。"
					}),
					onError: (n) => e.events.emit("error", {
						error: n,
						source: `renderer:inspector:${t.type}`
					}),
					children: /* @__PURE__ */ j(l, {
						engine: e,
						node: t,
						definition: n,
						issues: re,
						readOnly: o
					})
				}) : /* @__PURE__ */ M(A, { children: [
					/* @__PURE__ */ M("section", {
						className: "fc-inspector__summary",
						children: [/* @__PURE__ */ j("span", { children: /* @__PURE__ */ j(Oe, { size: 14 }) }), /* @__PURE__ */ M("div", { children: [/* @__PURE__ */ j("strong", { children: n?.title ?? "未知节点类型" }), /* @__PURE__ */ M("small", { children: [
							t.type,
							" · ",
							t.id.slice(0, 8)
						] })] })]
					}),
					/* @__PURE__ */ M("section", {
						className: "fc-inspector__section",
						children: [
							/* @__PURE__ */ j("h3", { children: "基础信息" }),
							/* @__PURE__ */ M("label", {
								className: "fc-field",
								children: [/* @__PURE__ */ j("span", { children: "节点名称" }), /* @__PURE__ */ j("input", {
									readOnly: o,
									value: v,
									onFocus: () => ie("title"),
									onChange: (e) => ae(e.target.value),
									onBlur: () => T("编辑节点名称")
								})]
							}),
							"prompt" in t.data && /* @__PURE__ */ M("label", {
								className: "fc-field",
								children: [/* @__PURE__ */ j("span", { children: "内容" }), /* @__PURE__ */ M("div", {
									className: "fc-prompt-editor",
									children: [
										/* @__PURE__ */ M("header", { children: [/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j(Fe, { size: 12 }), /* @__PURE__ */ j("b", { children: "场景描述" })] }), !o && /* @__PURE__ */ j("button", {
											type: "button",
											title: "引用节点",
											onClick: () => {
												let n = `${b}@${t.data.title} `;
												x(n), e.updateNodeData(t.id, { prompt: n });
											},
											children: /* @__PURE__ */ j(S, { size: 12 })
										})] }),
										/* @__PURE__ */ j("textarea", {
											readOnly: o,
											value: b,
											onFocus: () => ie("prompt"),
											onChange: (e) => oe(e.target.value),
											onBlur: () => T("编辑节点内容")
										}),
										/* @__PURE__ */ M("footer", { children: [/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j(E, { size: 11 }), o ? "只读" : w.current?.field === "prompt" ? "编辑中" : "已同步"] }), /* @__PURE__ */ M("small", { children: [
											"Prompt · ",
											[...b].length,
											" 字"
										] })] })
									]
								})]
							})
						]
					}),
					/* @__PURE__ */ M("section", {
						className: "fc-inspector__section",
						children: [
							/* @__PURE__ */ j("h3", { children: "执行设置" }),
							/* @__PURE__ */ M("label", {
								className: "fc-field",
								children: [/* @__PURE__ */ j("span", { children: "重试次数" }), /* @__PURE__ */ M("select", {
									disabled: o,
									value: Number(t.data.retryCount ?? 0),
									onChange: (n) => {
										o || e.updateNodeData(t.id, { retryCount: Number(n.target.value) });
									},
									children: [
										/* @__PURE__ */ j("option", {
											value: "0",
											children: "不重试"
										}),
										/* @__PURE__ */ j("option", {
											value: "1",
											children: "1 次"
										}),
										/* @__PURE__ */ j("option", {
											value: "2",
											children: "2 次"
										}),
										/* @__PURE__ */ j("option", {
											value: "3",
											children: "3 次"
										})
									]
								})]
							}),
							/* @__PURE__ */ M("button", {
								className: "fc-setting-row",
								disabled: o,
								type: "button",
								onClick: () => {
									o || e.updateNodeData(t.id, { cache: t.data.cache === !1 });
								},
								children: [
									/* @__PURE__ */ j("span", {
										className: "fc-setting-row__icon",
										children: /* @__PURE__ */ j(O, { size: 13 })
									}),
									/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j("strong", { children: "缓存运行结果" }), /* @__PURE__ */ j("small", { children: t.data.cache === !1 ? "已关闭" : "已开启" })] }),
									/* @__PURE__ */ j("i", { className: t.data.cache === !1 ? "" : "is-on" })
								]
							})
						]
					}),
					/* @__PURE__ */ M("section", {
						className: "fc-inspector__section",
						children: [/* @__PURE__ */ j("h3", { children: "节点校验" }), /* @__PURE__ */ j("div", {
							className: `fc-validation-summary ${re.length ? "has-issues" : ""}`,
							children: re.length ? re.map((e) => /* @__PURE__ */ j("p", { children: e.message }, `${e.code}-${e.portId ?? ""}`)) : /* @__PURE__ */ M("p", { children: [/* @__PURE__ */ j(E, { size: 12 }), "校验通过"] })
						})]
					}),
					!o && /* @__PURE__ */ M("section", {
						className: "fc-inspector__section",
						children: [/* @__PURE__ */ j("h3", { children: "节点操作" }), /* @__PURE__ */ M("div", {
							className: "fc-inspector__actions",
							children: [/* @__PURE__ */ M("button", {
								type: "button",
								onClick: () => e.duplicateSelection(),
								children: [/* @__PURE__ */ j(D, { size: 13 }), "复制"]
							}), /* @__PURE__ */ M("button", {
								className: "is-danger",
								type: "button",
								onClick: () => e.removeNodes([t.id]),
								children: [/* @__PURE__ */ j(je, { size: 13 }), "删除"]
							})]
						})]
					})
				] }) : /* @__PURE__ */ j("div", {
					className: "fc-inspector__empty",
					children: "选择一个节点以编辑属性"
				})
			}) : u ? /* @__PURE__ */ M("div", {
				className: "fc-assistant",
				children: [
					/* @__PURE__ */ M("div", {
						className: "fc-assistant__context",
						children: [/* @__PURE__ */ j("span", { children: /* @__PURE__ */ j(ne, { size: 14 }) }), /* @__PURE__ */ M("div", { children: [/* @__PURE__ */ j("strong", { children: "画布上下文已连接" }), /* @__PURE__ */ M("small", { children: [
							e.getGraphSnapshot().nodes.length,
							" 个节点 · ",
							r.length,
							" 项校验信息"
						] })] })]
					}),
					/* @__PURE__ */ M("div", {
						className: "fc-assistant__messages",
						"aria-live": "polite",
						children: [
							!g.length && /* @__PURE__ */ j("p", { children: "可询问当前图结构、端口、校验或运行状态。" }),
							g.map((e, t) => /* @__PURE__ */ j("p", {
								className: `is-${e.role}`,
								children: e.text
							}, `${e.role}-${t}`)),
							ee && /* @__PURE__ */ j("p", {
								className: "is-pending",
								children: "正在请求…"
							})
						]
					}),
					/* @__PURE__ */ M("div", {
						className: "fc-assistant__compose",
						children: [/* @__PURE__ */ j("textarea", {
							disabled: ee,
							value: m,
							onChange: (e) => h(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && !e.shiftKey && (e.preventDefault(), se());
							},
							placeholder: "询问当前画布…"
						}), /* @__PURE__ */ j("button", {
							disabled: ee || !m.trim(),
							type: "button",
							onClick: () => void se(),
							"aria-label": "发送",
							children: /* @__PURE__ */ j(De, { size: 13 })
						})]
					})
				]
			}) : null
		]
	});
}
//#endregion
//#region src/react/asset-export.ts
var In = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif": ".gif",
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
	"audio/mpeg": ".mp3",
	"audio/wav": ".wav",
	"audio/x-wav": ".wav",
	"audio/ogg": ".ogg",
	"audio/mp4": ".m4a",
	"text/plain": ".txt",
	"application/json": ".json"
}, Ln = {
	image: "image/png",
	video: "video/mp4",
	audio: "audio/mpeg",
	text: "text/plain",
	json: "application/json",
	file: "application/octet-stream"
}, Rn = (e) => {
	try {
		let t = new URL(e, window.location.href).pathname, n = /\.[A-Za-z0-9]{2,5}$/.exec(t);
		return n ? n[0].toLowerCase() : "";
	} catch {
		return "";
	}
}, zn = (e) => e.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 120) || "衣瞬素材", Bn = (e, t, n, r = "") => {
	let i = zn(e);
	return /\.[A-Za-z0-9]{2,5}$/.test(i) ? i : `${i}${In[n] || Rn(r) || (t === "json" ? ".json" : t === "text" ? ".txt" : t === "image" ? ".png" : t === "video" ? ".mp4" : t === "audio" ? ".mp3" : ".bin")}`;
}, Vn = (e, t) => {
	let n = String(t.kind || t.previewKind || t.mediaType || t.assetKind || "");
	if ([
		"image",
		"video",
		"audio",
		"text",
		"file"
	].includes(n)) return n;
	let r = String(t.mimeType || "");
	return r.startsWith("image/") ? "image" : r.startsWith("video/") ? "video" : r.startsWith("audio/") ? "audio" : e.type === "image" ? "image" : e.type === "video" || e.type === "compose" ? "video" : e.type === "audio" ? "audio" : "file";
}, Hn = (e, t, n) => {
	let r = String(t.preview || t.url || "");
	if (!r) return;
	let i = Vn(e, t), a = String(t.mimeType || Ln[i]), o = String(t.title || t.name || t.fileName || e.data.title || "衣瞬素材"), s = n === void 0 ? o : `${o}-${n + 1}`;
	return {
		nodeId: e.id,
		nodeTitle: String(e.data.title || e.type),
		kind: i,
		name: Bn(String(t.fileName || t.name || s), i, a, r),
		mimeType: a,
		source: r
	};
};
function Un(e) {
	let t = e.data, n = (Array.isArray(t.embeddedMedia) ? t.embeddedMedia : []).flatMap((t, n) => {
		if (!t || typeof t != "object" || Array.isArray(t)) return [];
		let r = Hn(e, t, n);
		return r ? [r] : [];
	});
	if (n.length) return n;
	let r = Hn(e, t);
	if (r) return [r];
	if (e.type === "json_input") {
		let n = String(t.prompt ?? "{}"), r = n;
		try {
			r = JSON.stringify(JSON.parse(n), null, 2);
		} catch {}
		return [{
			nodeId: e.id,
			nodeTitle: String(t.title || "JSON 输入"),
			kind: "json",
			name: Bn(String(t.fileName || t.title || "衣瞬_JSON"), "json", "application/json"),
			mimeType: "application/json",
			text: r
		}];
	}
	if ([
		"prompt",
		"text_input",
		"text_transform",
		"merge"
	].includes(e.type)) {
		let n = String(t.text ?? t.prompt ?? "");
		return n ? [{
			nodeId: e.id,
			nodeTitle: String(t.title || "文本"),
			kind: "text",
			name: Bn(String(t.fileName || t.title || "衣瞬_文本"), "text", "text/plain"),
			mimeType: "text/plain",
			text: n
		}] : [];
	}
	return [];
}
function Wn(e, t) {
	let n = new Set(t);
	return e.filter((e) => n.has(e.id)).flatMap(Un);
}
var Gn = async (e) => {
	if (e.text !== void 0) return new Blob([e.text], { type: `${e.mimeType};charset=utf-8` });
	if (!e.source) throw Error(`素材“${e.name}”没有可保存的内容。`);
	let t = await fetch(e.source);
	if (!t.ok) throw Error(`读取素材“${e.name}”失败（HTTP ${t.status}）。`);
	return t.blob();
}, Kn = async (e, t) => {
	let n = await e.createWritable();
	if (t.text !== void 0) {
		await n.write(new Blob([t.text], { type: `${t.mimeType};charset=utf-8` })), await n.close();
		return;
	}
	if (!t.source) throw Error(`素材“${t.name}”没有可保存的内容。`);
	let r = await fetch(t.source);
	if (!r.ok) throw Error(`读取素材“${t.name}”失败（HTTP ${r.status}）。`);
	r.body && typeof r.body.pipeTo == "function" ? await r.body.pipeTo(n) : (await n.write(await r.blob()), await n.close());
}, qn = (e) => [{
	description: `${e.kind === "image" ? "图片" : e.kind === "video" ? "视频" : e.kind === "audio" ? "音频" : e.kind === "json" ? "JSON" : "文本"}文件`,
	accept: { [e.mimeType]: [In[e.mimeType] || `.${e.name.split(".").pop() || "bin"}`] }
}], Jn = (e) => {
	let t = /* @__PURE__ */ new Map();
	return e.map((e) => {
		let n = (t.get(e.name.toLowerCase()) || 0) + 1;
		if (t.set(e.name.toLowerCase(), n), n === 1) return e;
		let r = e.name.lastIndexOf("."), i = r > 0 ? `${e.name.slice(0, r)}-${n}${e.name.slice(r)}` : `${e.name}-${n}`;
		return {
			...e,
			name: i
		};
	});
}, Yn = async (e) => {
	let t = await Gn(e), n = URL.createObjectURL(t), r = document.createElement("a");
	r.href = n, r.download = e.name, r.hidden = !0, document.body.appendChild(r), r.click(), r.remove(), window.setTimeout(() => URL.revokeObjectURL(n), 3e4);
}, Xn = () => (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
async function Zn(e, t = 0) {
	let n = Jn(e);
	if (!n.length) return {
		saved: 0,
		skipped: t,
		cancelled: !1,
		method: "none"
	};
	let r = window;
	try {
		if (n.length === 1 && r.showSaveFilePicker) {
			let e = n[0];
			return await Kn(await r.showSaveFilePicker({
				suggestedName: e.name,
				types: qn(e)
			}), e), {
				saved: 1,
				skipped: t,
				cancelled: !1,
				method: "picker"
			};
		}
		if (n.length > 1 && r.showDirectoryPicker) {
			let e = await (await r.showDirectoryPicker({ mode: "readwrite" })).getDirectoryHandle(`衣瞬导出_${Xn()}`, { create: !0 });
			for (let t of n) await Kn(await e.getFileHandle(t.name, { create: !0 }), t);
			let i = {
				schemaVersion: 1,
				exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
				assets: n.map((e) => ({
					nodeId: e.nodeId,
					nodeTitle: e.nodeTitle,
					kind: e.kind,
					fileName: e.name,
					mimeType: e.mimeType
				}))
			};
			return await Kn(await e.getFileHandle("manifest.json", { create: !0 }), {
				nodeId: "manifest",
				nodeTitle: "导出清单",
				kind: "json",
				name: "manifest.json",
				mimeType: "application/json",
				text: JSON.stringify(i, null, 2)
			}), {
				saved: n.length,
				skipped: t,
				cancelled: !1,
				method: "directory"
			};
		}
		for (let e of n) await Yn(e);
		return {
			saved: n.length,
			skipped: t,
			cancelled: !1,
			method: "download"
		};
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") return {
			saved: 0,
			skipped: t,
			cancelled: !0,
			method: "none"
		};
		throw e;
	}
}
//#endregion
//#region src/react/FlowCanvasApp.tsx
var Qn = { flowcanvas: Pn }, $n = (e, t) => e === "any" || t === "any" || e === t, er = (e, t) => e && Object.prototype.hasOwnProperty.call(e, t) ? e[t] : void 0, tr = (e) => ({
	type: e,
	title: `未知节点 · ${e}`,
	category: "未注册",
	description: `节点类型“${e}”尚未注册，数据已保留。`,
	color: "#e98289",
	icon: "text",
	inputs: [],
	outputs: [],
	createData: () => ({ title: `未知节点 · ${e}` })
}), nr = {
	idle: "尚未保存",
	saving: "正在保存",
	saved: "已保存",
	error: "保存失败"
}, rr = (e) => e.message ?? er(nr, e.status) ?? "保存状态未知", ir = "__auto_input__", ar = "__auto_output__", or = /* @__PURE__ */ new Set([
	"image",
	"video",
	"audio"
]), sr = (e) => {
	let t = e.data?.previewKind ?? e.data?.mediaType ?? e.data?.assetKind;
	if (t === "image" || t === "video" || t === "audio" || t === "text" || t === "file") return t;
	let n = typeof e.data?.mimeType == "string" ? e.data.mimeType : "";
	return n.startsWith("image/") ? "image" : n.startsWith("video/") ? "video" : n.startsWith("audio/") ? "audio" : n.startsWith("text/") ? "text" : "file";
}, cr = (e) => typeof e.data?.preview == "string" ? e.data.preview : "", lr = (e, t) => {
	let n = String(e.data?.fileName ?? e.data?.title ?? `素材 ${t + 1}`), r = typeof e.data?.mimeType == "string" && e.data.mimeType ? e.data.mimeType : void 0, i = cr(e) || void 0, a = typeof e.data?.size == "number" ? e.data.size : void 0, o = typeof e.data?.lastModified == "number" ? e.data.lastModified : void 0;
	return {
		id: String(e.data?.id ?? `${n}-${e.data?.size ?? 0}-${e.data?.lastModified ?? t}`),
		name: n,
		kind: sr(e),
		...r ? { mimeType: r } : {},
		...i ? { url: i } : {},
		...a === void 0 ? {} : { size: a },
		...o === void 0 ? {} : { lastModified: o }
	};
}, ur = (e) => Array.isArray(e) ? e.filter((e) => !!e && typeof e == "object" && !Array.isArray(e)) : [], dr = (e) => !!(e && (e.type === "blank" || e.type === "local_asset" || Pt(e.type) || Z(e.data.generationMode))), fr = (e, t) => {
	if (!e || !or.has(t)) return !1;
	if (e.type === "blank" || e.type === "local_asset") return !0;
	let n = Z(e.data.generationMode) ? e.data.generationMode : Mt(e.type);
	return n === "image" ? t === "image" : n === "video" ? t === "image" || t === "video" || t === "audio" : n === "audio" && t === "audio";
}, pr = (e) => e.id || e.name, mr = (e, t, n = 24) => [...e.filter((e) => (typeof e == "string" ? e : pr(e)) !== pr(t)), t].slice(-n), hr = (e, t, n) => {
	let r = (e instanceof Element ? e : void 0)?.closest(".react-flow__node")?.getAttribute("data-id");
	if (r) return r;
	if (Number.isFinite(t) && Number.isFinite(n)) return document.elementFromPoint(Number(t), Number(n))?.closest(".react-flow__node")?.getAttribute("data-id") ?? void 0;
}, gr = (e) => String((e.data.generationMode === "image" || e.type === "image" ? "image" : void 0) ?? (e.data.generationMode === "video" || e.type === "video" ? "video" : void 0) ?? (e.data.generationMode === "audio" || e.type === "audio" ? "audio" : void 0) ?? e.data.previewKind ?? e.data.mediaType ?? e.data.assetKind ?? ""), _r = (e) => {
	let t = gr(e), n = String(e.data.previewKind ?? "").toLowerCase(), r = [
		...!n || !t || n === t ? [e.data.preview] : [],
		e.data.resultUrl,
		e.data.result_url,
		e.data.videoUrl,
		e.data.remoteUrl,
		e.data.url
	];
	for (let e of r) if (typeof e == "string" && e.trim()) return e.trim();
	let i = [...ur(e.data.embeddedMedia)].reverse().find((e) => (typeof e.url == "string" || typeof e.preview == "string") && (!t || !e.kind || e.kind === t));
	return i ? String(i.url ?? i.preview ?? "").trim() : "";
}, vr = (e, t) => {
	let n = String(e.data.status ?? "idle").toLowerCase();
	return [
		"success",
		"succeeded",
		"completed",
		"complete"
	].includes(n) ? "success" : [
		"error",
		"failed",
		"failure"
	].includes(n) ? "error" : ["queued", "pending"].includes(n) ? "queued" : [
		"running",
		"in_progress",
		"processing"
	].includes(n) ? "running" : t && or.has(gr(e)) ? "success" : n;
}, yr = (e) => {
	let t = Z(e.data.generationMode) ? e.data.generationMode : Mt(e.type);
	if (!t) return "";
	let n = Lt(e.data.generationDrafts, e.data, t);
	return String(n[t].prompt ?? e.data.prompt ?? "");
}, br = (e, t) => {
	if (Pt(t.type) || Z(e.data.generationMode)) {
		let t = yr(e).split(/\r?\n/).reduce((e, t) => {
			let n = [...t].reduce((e, t) => e + (/^[\x00-\xff]$/.test(t) ? .55 : 1), 0);
			return e + Math.max(1, Math.ceil(n / 48));
		}, 0);
		return {
			width: 720,
			height: 664 + Math.max(0, t - 3) * 23
		};
	}
	if (t.type === "blank") return {
		width: 420,
		height: 290
	};
	let n = gr(e);
	return n === "audio" ? {
		width: 320,
		height: 180
	} : n === "image" || n === "video" ? {
		width: 420,
		height: 290
	} : {
		width: 232,
		height: 150
	};
};
function xr({ engine: e, theme: t, onThemeChange: n, readOnly: p = !1, renderers: h, services: _, saveState: x }) {
	let ee = l(e.subscribe, e.getVersion, e.getVersion), S = e.getGraphSnapshot(), w = e.getSelection(), T = e.getValidationSnapshot(), E = y(), D = b(), O = a().replace(/:/g, ""), le = s(void 0), de = s(/* @__PURE__ */ new Map()), pe = s(/* @__PURE__ */ new Map()), me = s(null), xe = s(null), Ce = s(null), De = s(void 0), Oe = s(void 0), Fe = s(!1), [Ie, Le] = c(!1), [N, Re] = c(() => e.getSelection().nodeIds.length > 0), [ze, Be] = c("properties"), [P, F] = c("select"), [I, L] = c(!1), [Ve, He] = c(""), [R, z] = c(null), Ue = s(/* @__PURE__ */ new Set()), [We, B] = c(e.isRunning()), [V, Ge] = c(!1), H = s(void 0), [U, Ke] = c(!1);
	i(() => {
		if (!R) return;
		let e = (e) => {
			e.target?.closest(".fc-context-menu") || z(null);
		};
		return window.addEventListener("pointerdown", e, !0), () => window.removeEventListener("pointerdown", e, !0);
	}, [R]);
	let qe = r((e, t) => {
		H.current = e ? t : void 0, Ke(e);
	}, []);
	i(() => (Fe.current = !0, () => {
		Fe.current = !1, De.current?.abort(), window.clearTimeout(Oe.current);
	}), []), i(() => {
		let t = e.on("run:start", ({ runId: e }) => {
			Ue.current.add(e), B(!0);
		}), n = e.on("run:end", ({ runId: e }) => {
			Ue.current.delete(e), B(Ue.current.size > 0);
		});
		return B(e.isRunning()), () => {
			t(), n();
		};
	}, [e]), i(() => {
		E.setViewport({
			x: S.viewport.x,
			y: S.viewport.y,
			zoom: S.viewport.zoom
		});
	}, [
		S.id,
		S.viewport.x,
		S.viewport.y,
		S.viewport.zoom,
		E
	]), i(() => {
		p && Le(!1);
	}, [p]);
	let W = r((e) => {
		window.clearTimeout(Oe.current), He(e), Oe.current = window.setTimeout(() => He(""), 2200);
	}, []), Je = r((t, n, r) => {
		e.updateNodeData(t, n, r);
	}, [e]), G = r((t, n) => {
		let r = e.getGraph().nodes.find((e) => e.id === t);
		if (!r) return;
		let i = Nt(n);
		if (!e.registry.has(i)) {
			W(`未注册“${n}”对应的节点类型：${i}`);
			return;
		}
		let a = Z(r.data.generationMode) ? r.data.generationMode : Mt(r.type) ?? "text", o = Lt(r.data.generationDrafts, r.data, a), s = e.registry.get(i), c = Ft(n);
		e.updateNode(t, {
			type: i,
			data: {
				...Rt(n, o),
				title: s?.title ?? c.label,
				description: s?.description ?? c.placeholder,
				status: "idle",
				progress: 0,
				runMessage: "",
				runError: ""
			}
		});
	}, [e, W]), K = r((t) => e.getGraph().nodes.filter((e) => e.id !== t).flatMap((t) => {
		let n = _r(t), r = gr(t), i = typeof t.data.preview == "string" && t.data.preview.trim() ? void 0 : [...ur(t.data.embeddedMedia)].reverse().find((e) => e.url === n), a = t.data.previewOrigin === "input" && typeof t.data.fileName == "string" ? t.data.fileName : "";
		return [{
			id: t.id,
			sourceNodeId: t.id,
			title: String(a || i?.name || t.data.title || e.registry.get(t.type)?.title || t.type),
			type: t.type,
			status: vr(t, n),
			prompt: typeof t.data.prompt == "string" ? t.data.prompt : "",
			preview: n,
			kind: r,
			mimeType: typeof t.data.mimeType == "string" ? t.data.mimeType : ""
		}, ...ur(t.data.embeddedMedia).map((e, i) => {
			let a = String(e.url ?? "").trim();
			if (!(!a || !or.has(e.kind)) && !(a === n && e.kind === r)) return {
				id: `asset:${t.id}:${e.id || i}`,
				title: e.name || `本地素材 ${i + 1}`,
				type: "local_asset",
				status: "success",
				prompt: typeof e.prompt == "string" ? String(e.prompt) : "",
				preview: a,
				kind: e.kind,
				mimeType: e.mimeType ?? ""
			};
		}).filter((e) => !!e)];
	}), [e]), q = r((t) => {
		let n = e.getGraph(), r = /* @__PURE__ */ new Set([
			"reference",
			"image",
			"lastFrame"
		]);
		return n.edges.filter((e) => e.target === t && r.has(e.targetPort)).map((t) => {
			let r = n.nodes.find((e) => e.id === t.source);
			if (r) return {
				id: t.id,
				sourceNodeId: r.id,
				title: String(r.data.title || e.registry.get(r.type)?.title || r.type),
				type: r.type,
				status: vr(r, _r(r)),
				prompt: typeof r.data.prompt == "string" ? r.data.prompt : "",
				preview: _r(r),
				kind: gr(r),
				mimeType: typeof r.data.mimeType == "string" ? r.data.mimeType : "",
				targetPort: t.targetPort,
				connected: !0
			};
		}).filter((e) => !!e);
	}, [e]), Ye = r((t, n, r, i) => {
		let a = e.getGraph().edges.filter((e) => e.target === t && e.source === n && [
			"reference",
			"image",
			"lastFrame"
		].includes(e.targetPort) && (!r || e.targetPort === r) && (!i || e.id === i)).map((e) => e.id);
		a.length && (e.removeEdges(a), W("已断开参考素材连线"));
	}, [e, W]), Xe = r(async (t) => {
		try {
			let n = await e.runNode(t, { refreshNodeIds: [t] });
			W(n.status === "success" ? "当前节点生成完成" : n.status === "cancelled" ? "当前节点生成已取消" : `当前节点生成失败：${n.error}`);
		} catch (e) {
			if (et(e)) {
				W(`请先完成配置：${e.message}`);
				try {
					await _?.configuration?.onRequired(e);
				} catch (e) {
					W(`打开配置失败：${e instanceof Error ? e.message : String(e)}`);
				}
			} else W(`当前节点生成失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}, [
		e,
		W,
		_?.configuration
	]), J = S.nodes.find((e) => w.nodeIds.includes(e.id)), Ze = J ? e.registry.get(J.type) ?? tr(J.type) : void 0, Qe = o(() => {
		let t = new Set(w.nodeIds), n = /* @__PURE__ */ new Set(), r = S.nodes.map((r) => {
			n.add(r.id);
			let i = t.has(r.id), a = e.registry.get(r.type) ?? tr(r.type), o = er(h?.nodes, r.type), { width: s, height: c } = br(r, a), l = S.edges.filter((e) => e.source === r.id || e.target === r.id).map((e) => `${e.id}:${e.sourcePort}:${e.targetPort}`).join("|"), u = de.current.get(r.id);
			if (u && u.data === r.data && u.position === r.position && u.definition === a && u.renderer === o && u.readOnly === p && u.running === We && u.selected === i && u.width === r.width && u.height === r.height && u.edgeSignature === l) return u.model;
			let d = {
				id: r.id,
				type: "flowcanvas",
				position: {
					x: r.position.x,
					y: r.position.y
				},
				width: s,
				height: c,
				initialWidth: s,
				initialHeight: c,
				measured: {
					width: s,
					height: c
				},
				style: {
					width: s,
					height: c
				},
				data: {
					...r.data,
					definition: a,
					node: r,
					renderer: o,
					onRendererError: (t) => e.events.emit("error", {
						error: t,
						source: `renderer:node:${r.type}`
					}),
					readOnly: p,
					running: We,
					onUpdateData: (e, t) => Je(r.id, e, t),
					onCaptureSnapshot: () => e.captureSnapshot(),
					onCommitSnapshot: (t, n) => e.commitSnapshot(t, n),
					onDraftChange: qe,
					onChangeGenerationMode: (e) => G(r.id, e),
					onRunNode: () => {
						Xe(r.id);
					},
					onCancelRun: () => e.cancelNode(r.id),
					onNotify: W,
					getReferences: () => K(r.id),
					connectedReferences: q(r.id),
					onDisconnectReference: (e, t, n) => Ye(r.id, e, t, n)
				},
				selected: i,
				draggable: !p && !r.locked
			};
			return de.current.set(r.id, {
				data: r.data,
				position: r.position,
				definition: a,
				renderer: o,
				readOnly: p,
				running: We,
				selected: i,
				width: r.width,
				height: r.height,
				edgeSignature: l,
				model: d
			}), d;
		});
		for (let e of de.current.keys()) n.has(e) || de.current.delete(e);
		return r;
	}, [
		ee,
		S.nodes,
		S.edges,
		w.nodeIds,
		e.registry,
		p,
		h?.nodes,
		We,
		Je,
		G,
		Xe,
		W,
		K,
		q,
		Ye,
		qe,
		e
	]), $e = o(() => {
		let e = new Set(w.edgeIds), t = /* @__PURE__ */ new Set(), n = S.edges.map((n) => {
			t.add(n.id);
			let r = e.has(n.id), i = pe.current.get(n.id);
			if (i && i.edge === n && i.selected === r) return i.model;
			let a = {
				id: n.id,
				source: n.source,
				target: n.target,
				sourceHandle: ar,
				targetHandle: ir,
				selected: r,
				className: "fc-edge"
			};
			return pe.current.set(n.id, {
				edge: n,
				selected: r,
				model: a
			}), a;
		});
		for (let e of pe.current.keys()) t.has(e) || pe.current.delete(e);
		return n;
	}, [
		ee,
		S.edges,
		w.edgeIds
	]), tt = (t) => {
		let n = p ? [] : t.filter((e) => e.type === "remove").map((e) => e.id);
		n.length && e.removeNodes(n);
		let r = new Set(n), i = new Set(w.nodeIds.filter((e) => !r.has(e))), a = n.length > 0;
		for (let n of t) !p && n.type === "position" && n.position && e.updateNode(n.id, { position: n.position }, {
			record: !1,
			transient: !0
		}), n.type === "select" && !r.has(n.id) && (a = !0, n.selected ? i.add(n.id) : i.delete(n.id));
		a && e.setSelection({
			nodeIds: [...i],
			edgeIds: n.length ? [] : w.edgeIds
		});
	}, nt = (t) => {
		let n = p ? [] : t.filter((e) => e.type === "remove").map((e) => e.id);
		n.length && e.removeEdges(n);
		let r = new Set(n), i = new Set(w.edgeIds.filter((e) => !r.has(e))), a = n.length > 0;
		for (let e of t) e.type === "select" && !r.has(e.id) && (a = !0, e.selected ? i.add(e.id) : i.delete(e.id));
		a && e.setSelection({
			nodeIds: w.nodeIds,
			edgeIds: [...i]
		});
	}, rt = (t) => {
		if (!t.source || !t.target || !t.sourceHandle || !t.targetHandle) return;
		let n = S.nodes.find((e) => e.id === t.source), r = S.nodes.find((e) => e.id === t.target), i = n && e.registry.get(n.type), a = r && e.registry.get(r.type), o = t.sourceHandle === ar ? i?.outputs[0] : i?.outputs.find((e) => e.id === t.sourceHandle), s = t.targetHandle === ir ? void 0 : a?.inputs.find((e) => e.id === t.targetHandle);
		if (o && a?.inputs.length && (t.targetHandle === ir || s)) {
			let e = a?.inputs.filter((e) => $n(o.dataType, e.dataType)) ?? [], n = o.dataType === "text" ? [
				"prompt",
				"text",
				"input"
			] : r?.type === "image" ? ["reference", "input"] : r?.type === "video" ? [
				"reference",
				"image",
				"input"
			] : ["input", "reference"], i = s && $n(o.dataType, s.dataType) ? s : n.map((t) => e.find((e) => e.id === t)).find(Boolean) ?? e[0];
			return i ? {
				source: t.source,
				sourceHandle: o.id,
				target: t.target,
				targetHandle: i.id
			} : void 0;
		}
	}, it = (t) => {
		if (p) return;
		let n = rt(t);
		if (!(!n?.source || !n.target || !n.sourceHandle || !n.targetHandle)) try {
			e.addEdge({
				source: n.source,
				sourcePort: n.sourceHandle,
				target: n.target,
				targetPort: n.targetHandle
			});
		} catch (e) {
			W(e instanceof Y ? e.result.issues[0]?.message ?? e.message : String(e));
		}
	}, at = () => {
		if (p) return;
		let t = [...w.nodeIds], n = [...w.edgeIds];
		if (!t.length && !n.length) {
			W("请先选中要删除的节点或连线");
			return;
		}
		H.current?.(), H.current = void 0, t.length && e.removeNodes(t), n.length && e.removeEdges(n), W(`已删除 ${t.length} 个节点、${n.length} 条连线`);
	}, ot = (t) => {
		if (p) return;
		let n = me.current?.getBoundingClientRect(), r = E.screenToFlowPosition({
			x: (n?.left ?? 0) + (n?.width ?? 800) / 2,
			y: (n?.top ?? 0) + (n?.height ?? 600) / 2
		});
		e.addNode(t, r), Le(!1);
	}, st = () => {
		let e = me.current?.getBoundingClientRect();
		return E.screenToFlowPosition({
			x: (e?.left ?? 0) + (e?.width ?? 800) / 2,
			y: (e?.top ?? 0) + (e?.height ?? 600) / 2
		});
	}, ct = () => w.nodeIds.length === 1 ? w.nodeIds[0] : void 0, lt = () => {
		p || !_?.assets || V || Ce.current?.click();
	}, ut = Wn(S.nodes, w.nodeIds), dt = async () => {
		if (!w.nodeIds.length) {
			W("请先选中需要保存的素材节点");
			return;
		}
		if (!ut.length) {
			W("选中的节点没有可保存的图片、视频、音频或文本");
			return;
		}
		let e = w.nodeIds.length - new Set(ut.map((e) => e.nodeId)).size;
		try {
			let t = await Zn(ut, Math.max(0, e));
			if (t.cancelled) return;
			W(t.skipped ? `已保存 ${t.saved} 个素材，跳过 ${t.skipped} 个不支持的节点` : `已保存 ${t.saved} 个选中素材`);
		} catch (e) {
			W(`保存素材失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}, ft = async () => {
		if (!T.valid) {
			W(`存在 ${T.issues.filter((e) => e.severity === "error").length} 项错误`);
			return;
		}
		try {
			let t = await e.run({ useCache: !0 });
			W(t.status === "success" ? "工作流运行完成" : t.status === "cancelled" ? "运行已取消" : `运行失败：${t.error}`);
		} catch (e) {
			if (et(e)) {
				let t = e.message;
				W(`请先完成配置：${t}`);
				try {
					await _?.configuration?.onRequired(e);
				} catch (e) {
					W(`打开配置失败：${e instanceof Error ? e.message : String(e)}`);
				}
			} else W(`运行失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}, pt = () => {
		let t = new Blob([e.exportGraph()], { type: "application/json" }), n = document.createElement("a");
		n.href = URL.createObjectURL(t), n.download = `${S.name}.flowcanvas.json`, n.click(), URL.revokeObjectURL(n.href);
	}, mt = async (t) => {
		if (!(!t || p)) try {
			e.importGraph(await t.text()), W("工作流已导入");
		} catch (e) {
			W(`导入失败：${e instanceof Error ? e.message : String(e)}`);
		}
	}, ht = async (t, n, r, i) => {
		let a = _?.assets;
		if (!a || p || !t.length || V) return;
		let o = new AbortController();
		De.current?.abort(), De.current = o, Ge(!0);
		try {
			let s = await a.pickFiles({
				source: r,
				files: t,
				accept: a.accept,
				graph: e.getGraph(),
				position: n,
				targetNodeId: i,
				signal: o.signal
			});
			if (o.signal.aborted) return;
			let c = 0, l = 0, u = /* @__PURE__ */ new Set(), d = [];
			e.transaction("导入素材", (e) => {
				s.forEach((t, r) => {
					let a = lr(t, r), o = a.kind, s = or.has(o) && !!a.url, f = i ? e.getGraphSnapshot().nodes.find((e) => e.id === i) : void 0;
					if (s && dr(f)) {
						if (!fr(f, o)) {
							d.push(a.name);
							return;
						}
						let t = f.type === "blank" && e.registry.has(o), n = t ? o : f.type, r = e.registry.require(n), i = t ? r.createData() : f.data, s = [...ur(t ? void 0 : f.data.embeddedMedia), a].slice(-24), c = {
							...t ? i : {},
							title: t ? r.title : f.data.title,
							embeddedMedia: s,
							...t || f.type === "local_asset" ? {
								preview: a.url,
								previewKind: o,
								mediaType: o,
								previewOrigin: "input"
							} : {},
							mimeType: a.mimeType ?? "",
							fileName: a.name,
							status: "idle",
							progress: 0,
							runMessage: "",
							runError: ""
						}, u = Z(i.generationMode) ? i.generationMode : Mt(n);
						if (u) {
							let e = Lt(i.generationDrafts, i, u);
							e[u].references = mr(e[u].references, a, u === "image" ? 14 : 24), Object.assign(c, Rt(u, e));
						}
						e.updateNode(f.id, {
							...t ? { type: n } : {},
							data: c
						}), l += 1;
						return;
					}
					if (s && e.registry.has("blank")) {
						let i = {
							x: n.x + r * 390,
							y: n.y + r % 2 * 28
						};
						e.addNode("blank", t.position ?? i, {
							title: "空白节点",
							description: "已嵌入本地素材",
							embeddedMedia: [a],
							preview: a.url,
							previewKind: o,
							mediaType: o,
							mimeType: a.mimeType ?? "",
							fileName: a.name
						}), c += 1;
						return;
					}
					if (!e.registry.has(t.type)) {
						u.add(t.type);
						return;
					}
					let p = String(t.data?.previewKind ?? t.data?.mediaType ?? ""), m = t.type === "local_asset" && (p === "image" || p === "video") ? {
						x: n.x + r * 390,
						y: n.y + r % 2 * 28
					} : {
						x: n.x + r * 28,
						y: n.y + r * 28
					};
					e.addNode(t.type, t.position ?? m, t.data), c += 1;
				});
			}), u.size ? W(`未注册资产节点：${[...u].join("、")}`) : d.length ? W(`部分素材与目标节点不兼容：${d.join("、")}`) : W(l ? `已嵌入 ${l} 个素材到节点` : c ? `已添加 ${c} 个素材节点` : "未生成可添加的素材节点");
		} catch (e) {
			o.signal.aborted || W(`素材导入失败：${e instanceof Error ? e.message : String(e)}`);
		} finally {
			De.current === o && (De.current = void 0, Ge(!1));
		}
	};
	return /* @__PURE__ */ M("div", {
		className: "fc-sdk",
		"data-theme": t,
		"data-interaction-mode": P,
		"data-read-only": p ? "true" : "false",
		"data-save-state": x?.status,
		"data-testid": "flowcanvas-sdk",
		tabIndex: 0,
		onKeyDown: (t) => {
			let n = t.target;
			if (n.isContentEditable || n.closest("input, textarea, select, [contenteditable=\"true\"], [role=\"textbox\"], [data-flowcanvas-ignore-shortcuts]")) return;
			let r = t.ctrlKey || t.metaKey;
			!p && r && t.key.toLowerCase() === "z" && (t.preventDefault(), t.shiftKey ? e.redo() : e.undo()), !p && r && t.key.toLowerCase() === "y" && (t.preventDefault(), e.redo()), r && t.key.toLowerCase() === "c" && (t.preventDefault(), e.copySelection(), W("已复制选中节点")), !p && r && t.key.toLowerCase() === "v" && (t.preventDefault(), e.pasteClipboard()), (t.key === "Delete" || t.key === "Backspace") && !p && (w.nodeIds.length && e.removeNodes(w.nodeIds), w.edgeIds.length && e.removeEdges(w.edgeIds));
		},
		children: [/* @__PURE__ */ M("main", {
			className: `fc-workspace${N ? "" : " is-inspector-closed"}`,
			children: [/* @__PURE__ */ M("section", {
				ref: me,
				className: "fc-canvas",
				onDragOverCapture: (e) => {
					!p && (e.dataTransfer.types.includes("application/flowcanvas-node") || _?.assets && e.dataTransfer.types.includes("Files")) && e.preventDefault();
				},
				onDropCapture: (t) => {
					if (t.preventDefault(), t.stopPropagation(), p) return;
					let n = E.screenToFlowPosition({
						x: t.clientX,
						y: t.clientY
					}), r = t.dataTransfer.getData("application/flowcanvas-node");
					if (r) {
						e.registry.has(r) ? e.addNode(r, n) : W(`节点类型“${r}”尚未注册`);
						return;
					}
					_?.assets && t.dataTransfer.files.length && ht(Array.from(t.dataTransfer.files), n, "drop", hr(t.target, t.clientX, t.clientY));
				},
				children: [
					/* @__PURE__ */ M(g, {
						id: `flowcanvas-${O}`,
						nodes: Qe,
						edges: $e,
						nodeTypes: Qn,
						onNodesChange: tt,
						onEdgesChange: nt,
						onConnect: it,
						connectionMode: f.Strict,
						connectOnClick: !0,
						connectionDragThreshold: 0,
						onNodeDragStart: () => {
							!p && P === "select" && (le.current = e.captureSnapshot());
						},
						onNodeDragStop: () => {
							!p && le.current && e.commitSnapshot("移动节点", le.current), le.current = void 0;
						},
						onMoveEnd: (t, n) => {
							Fe.current && !p && e.setViewport(n);
						},
						defaultViewport: {
							x: S.viewport.x,
							y: S.viewport.y,
							zoom: S.viewport.zoom
						},
						selectionMode: v.Partial,
						selectionOnDrag: P === "select",
						panOnDrag: P === "pan",
						panOnScroll: !0,
						zoomOnScroll: !0,
						multiSelectionKeyCode: [
							"Control",
							"Meta",
							"Shift"
						],
						deleteKeyCode: null,
						nodesConnectable: !p,
						nodesDraggable: !p && P === "select",
						onNodeContextMenu: (e, t) => {
							p || (e.preventDefault(), e.stopPropagation(), z({
								kind: "node",
								id: t.id,
								x: e.clientX,
								y: e.clientY
							}));
						},
						onEdgeContextMenu: (e, t) => {
							p || (e.preventDefault(), e.stopPropagation(), z({
								kind: "edge",
								id: t.id,
								x: e.clientX,
								y: e.clientY
							}));
						},
						onEdgeDoubleClick: (t, n) => {
							p || (t.preventDefault(), t.stopPropagation(), e.removeEdges([n.id]), W("已取消连线"));
						},
						onPaneClick: () => z(null),
						elementsSelectable: P === "select",
						connectionRadius: 26,
						onlyRenderVisibleElements: !0,
						minZoom: .2,
						maxZoom: 1.8,
						children: [/* @__PURE__ */ j(u, {
							variant: d.Lines,
							gap: 32,
							size: 1
						}), /* @__PURE__ */ j(m, {
							className: "fc-minimap",
							pannable: !0,
							zoomable: !0,
							nodeColor: (e) => String(e.data.definition.color ?? "#8e96a1")
						})]
					}),
					R && /* @__PURE__ */ j("div", {
						className: "fc-context-menu nodrag nowheel",
						role: "menu",
						"aria-label": R.kind === "edge" ? "连线操作" : "节点操作",
						style: {
							left: R.x,
							top: R.y
						},
						children: R.kind === "edge" ? /* @__PURE__ */ M("button", {
							type: "button",
							role: "menuitem",
							onClick: () => {
								e.removeEdges([R.id]), z(null), W("已取消连线");
							},
							children: [/* @__PURE__ */ j(Ne, { size: 14 }), "取消连线"]
						}) : /* @__PURE__ */ M(A, { children: [
							/* @__PURE__ */ M("button", {
								type: "button",
								role: "menuitem",
								disabled: !e.isNodeRunning(R.id),
								onClick: () => {
									e.cancelNode(R.id), z(null), W("已暂停当前生成，可右键重试");
								},
								children: [/* @__PURE__ */ j(Se, { size: 14 }), "暂停"]
							}),
							/* @__PURE__ */ M("button", {
								type: "button",
								role: "menuitem",
								disabled: e.isNodeRunning(R.id),
								onClick: () => {
									let e = R.id;
									z(null), Xe(e);
								},
								children: [/* @__PURE__ */ j(Ee, { size: 14 }), "重试"]
							}),
							/* @__PURE__ */ M("button", {
								className: "is-danger",
								type: "button",
								role: "menuitem",
								onClick: () => {
									e.removeNodes([R.id]), z(null), W("已删除节点");
								},
								children: [/* @__PURE__ */ j(je, { size: 14 }), "删除节点"]
							})
						] })
					}),
					/* @__PURE__ */ M("div", {
						className: "fc-canvas-actions",
						"aria-label": "画布操作",
						children: [
							x && /* @__PURE__ */ M("span", {
								className: `fc-save-state is-${x.status}`,
								children: [/* @__PURE__ */ j("i", {}), rr(x)]
							}),
							!p && /* @__PURE__ */ M("button", {
								className: "fc-json-action",
								type: "button",
								title: "导入 JSON",
								"aria-label": "导入 JSON",
								onClick: () => xe.current?.click(),
								children: [/* @__PURE__ */ j(Pe, { size: 14 }), /* @__PURE__ */ j("span", { children: "导入 JSON" })]
							}),
							!p && /* @__PURE__ */ j("input", {
								ref: xe,
								type: "file",
								accept: "application/json,.json",
								hidden: !0,
								onChange: (e) => {
									mt(e.target.files?.[0]), e.currentTarget.value = "";
								}
							}),
							/* @__PURE__ */ M("button", {
								className: "fc-json-action",
								type: "button",
								title: "导出 JSON",
								"aria-label": "导出 JSON",
								onClick: pt,
								children: [/* @__PURE__ */ j(oe, { size: 14 }), /* @__PURE__ */ j("span", { children: "导出 JSON" })]
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "切换主题",
								"aria-label": "切换主题",
								onClick: () => n(t === "dark" ? "light" : "dark"),
								children: j(t === "dark" ? Ae : ge, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "属性面板",
								onClick: () => Re((e) => !e),
								children: /* @__PURE__ */ j(be, { size: 14 })
							}),
							_?.assistant && /* @__PURE__ */ j("button", {
								type: "button",
								title: "AI 助手",
								onClick: () => {
									Re(!0), Be("assistant");
								},
								children: /* @__PURE__ */ j(ne, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								className: "fc-run-button",
								type: "button",
								onClick: We ? () => e.cancel() : () => void ft(),
								children: We ? /* @__PURE__ */ M(A, { children: [/* @__PURE__ */ j(he, { size: 14 }), "停止"] }) : /* @__PURE__ */ M(A, { children: [/* @__PURE__ */ j(ie, { size: 14 }), "运行全部"] })
							})
						]
					}),
					/* @__PURE__ */ M("nav", {
						className: `fc-rail${I ? " is-collapsed" : ""}`,
						"aria-label": "生成节点入口",
						"aria-expanded": !I,
						children: [/* @__PURE__ */ M("button", {
							className: "fc-rail__toggle",
							type: "button",
							title: I ? "展开节点抽屉" : "收起节点抽屉",
							"aria-label": I ? "展开节点抽屉" : "收起节点抽屉",
							onClick: () => L((e) => !e),
							children: [j(I ? ye : ve, { size: 17 }), /* @__PURE__ */ j("span", { children: I ? "展开" : "收起" })]
						}), !I && /* @__PURE__ */ M(A, { children: [
							/* @__PURE__ */ M("button", {
								type: "button",
								title: "添加空白节点",
								disabled: p || !e.registry.has("blank"),
								onClick: () => ot("blank"),
								children: [/* @__PURE__ */ j(ke, { size: 17 }), /* @__PURE__ */ j("span", { children: "空白" })]
							}),
							/* @__PURE__ */ M("button", {
								type: "button",
								title: "添加文本节点",
								disabled: p || !e.registry.has("prompt"),
								onClick: () => ot("prompt"),
								children: [/* @__PURE__ */ j(ce, { size: 17 }), /* @__PURE__ */ j("span", { children: "文本" })]
							}),
							/* @__PURE__ */ M("button", {
								type: "button",
								title: "添加图片节点",
								disabled: p || !e.registry.has("image"),
								onClick: () => ot("image"),
								children: [/* @__PURE__ */ j(ue, { size: 17 }), /* @__PURE__ */ j("span", { children: "图片" })]
							}),
							/* @__PURE__ */ M("button", {
								type: "button",
								title: "添加视频节点",
								disabled: p || !e.registry.has("video"),
								onClick: () => ot("video"),
								children: [/* @__PURE__ */ j(ae, { size: 17 }), /* @__PURE__ */ j("span", { children: "视频" })]
							}),
							/* @__PURE__ */ M("button", {
								type: "button",
								title: "添加音频节点",
								disabled: p || !e.registry.has("audio"),
								onClick: () => ot("audio"),
								children: [/* @__PURE__ */ j(te, { size: 17 }), /* @__PURE__ */ j("span", { children: "音频" })]
							}),
							_?.assets && /* @__PURE__ */ M("button", {
								type: "button",
								title: "上传素材",
								disabled: p || V,
								onClick: lt,
								children: [/* @__PURE__ */ j(Pe, { size: 17 }), /* @__PURE__ */ j("span", { children: "上传" })]
							}),
							/* @__PURE__ */ j("i", {
								className: "fc-rail__divider",
								"aria-hidden": "true"
							}),
							/* @__PURE__ */ M("button", {
								className: "fc-rail__save",
								type: "button",
								title: ut.length ? `保存选中素材（${ut.length}）` : "请先选择需要保存的素材",
								disabled: !ut.length,
								onClick: () => {
									dt();
								},
								children: [/* @__PURE__ */ j(oe, { size: 17 }), /* @__PURE__ */ j("span", { children: "保存" })]
							}),
							_?.assets && /* @__PURE__ */ j("input", {
								ref: Ce,
								type: "file",
								accept: _.assets.accept,
								multiple: !0,
								hidden: !0,
								onChange: (e) => {
									let t = Array.from(e.currentTarget.files ?? []);
									t.length && ht(t, st(), "picker", ct()), e.currentTarget.value = "";
								}
							})
						] })]
					}),
					Ie && /* @__PURE__ */ M("aside", {
						className: "fc-library",
						children: [
							/* @__PURE__ */ M("header", { children: [/* @__PURE__ */ j("strong", { children: "添加到画布" }), /* @__PURE__ */ j("button", {
								type: "button",
								onClick: () => Le(!1),
								children: "×"
							})] }),
							_?.assets && /* @__PURE__ */ M(A, { children: [/* @__PURE__ */ M("button", {
								className: "fc-upload-tile",
								type: "button",
								disabled: V,
								onClick: lt,
								children: [/* @__PURE__ */ j(se, { size: 14 }), /* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j("strong", { children: V ? "正在导入素材" : "上传图片或视频" }), /* @__PURE__ */ j("small", { children: "也可以直接拖入画布" })] })]
							}), /* @__PURE__ */ j("input", {
								ref: Ce,
								type: "file",
								accept: _.assets.accept,
								multiple: !0,
								hidden: !0,
								onChange: (e) => {
									let t = Array.from(e.currentTarget.files ?? []);
									t.length && ht(t, st(), "picker", ct()), e.currentTarget.value = "";
								}
							})] }),
							/* @__PURE__ */ j("p", { children: "节点" }),
							e.registry.list().map((e) => /* @__PURE__ */ M("button", {
								className: "fc-library__item",
								type: "button",
								draggable: !p,
								onDragStart: (t) => {
									t.dataTransfer.setData("application/flowcanvas-node", e.type), t.dataTransfer.effectAllowed = "copy";
								},
								onClick: () => ot(e.type),
								children: [
									/* @__PURE__ */ j("span", {
										style: { color: e.color },
										children: /* @__PURE__ */ j(C, { size: 14 })
									}),
									/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j("strong", { children: e.title }), /* @__PURE__ */ j("small", { children: e.description })] }),
									/* @__PURE__ */ j(ke, { size: 12 })
								]
							}, e.type))
						]
					}),
					/* @__PURE__ */ M("div", {
						className: "fc-canvas-tools",
						children: [
							/* @__PURE__ */ j("button", {
								className: P === "select" ? "is-active" : "",
								type: "button",
								title: "选择",
								"aria-pressed": P === "select",
								onClick: () => F("select"),
								children: /* @__PURE__ */ j(_e, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								className: P === "pan" ? "is-active" : "",
								type: "button",
								title: "平移",
								"aria-pressed": P === "pan",
								onClick: () => F("pan"),
								children: /* @__PURE__ */ j(k, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "撤销",
								disabled: p || !e.history.canUndo && !U,
								onClick: () => {
									p || (H.current?.(), H.current = void 0, e.undo());
								},
								children: /* @__PURE__ */ j(Me, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "重做",
								disabled: p || !e.history.canRedo,
								onClick: () => {
									p || e.redo();
								},
								children: /* @__PURE__ */ j(Te, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								className: "fc-canvas-delete",
								type: "button",
								title: "删除选中节点或连线",
								"aria-label": "删除选中",
								disabled: p || !w.nodeIds.length && !w.edgeIds.length,
								onClick: at,
								children: /* @__PURE__ */ j(je, { size: 14 })
							}),
							w.edgeIds.length > 0 && /* @__PURE__ */ j("button", {
								className: "fc-canvas-unlink",
								type: "button",
								title: "取消选中的连线",
								"aria-label": "取消选中的连线",
								disabled: p,
								onClick: () => {
									let t = [...w.edgeIds];
									e.removeEdges(t), W(`已取消 ${t.length} 条连线`);
								},
								children: /* @__PURE__ */ j(Ne, { size: 14 })
							}),
							/* @__PURE__ */ j("i", {}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "缩小",
								onClick: () => E.zoomOut(),
								children: /* @__PURE__ */ j(he, { size: 13 })
							}),
							/* @__PURE__ */ M("span", {
								className: "fc-canvas-zoom",
								"aria-label": `当前缩放 ${Math.round(D.zoom * 100)}%`,
								children: [Math.round(D.zoom * 100), "%"]
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "适应画布",
								onClick: () => E.fitView({
									padding: .16,
									duration: 280
								}),
								children: /* @__PURE__ */ j(fe, { size: 14 })
							}),
							/* @__PURE__ */ j("button", {
								type: "button",
								title: "放大",
								onClick: () => E.zoomIn(),
								children: /* @__PURE__ */ j(we, { size: 13 })
							})
						]
					}),
					Ve && /* @__PURE__ */ M("div", {
						className: "fc-toast",
						children: [/* @__PURE__ */ j(re, { size: 13 }), Ve]
					})
				]
			}), N && /* @__PURE__ */ j(Fn, {
				engine: e,
				node: J,
				definition: Ze,
				issues: T.issues,
				onClose: () => Re(!1),
				readOnly: p,
				renderer: J ? er(h?.inspectors, J.type) : void 0,
				assistant: _?.assistant,
				tab: ze,
				onTabChange: Be,
				onDraftChange: qe
			})]
		}), /* @__PURE__ */ M("footer", {
			className: "fc-statusbar",
			children: [
				/* @__PURE__ */ M("span", { children: [/* @__PURE__ */ j("i", {}), "画布引擎就绪"] }),
				/* @__PURE__ */ j("span", { children: w.nodeIds.length ? `已选择 ${w.nodeIds.length} 个节点` : "未选择节点" }),
				/* @__PURE__ */ M("span", { children: [
					S.nodes.length,
					" 节点 · ",
					S.edges.length,
					" 连线 · ",
					T.valid ? "校验通过" : `${T.issues.length} 项问题`
				] })
			]
		})]
	});
}
function Sr(e) {
	return /* @__PURE__ */ j(_, { children: /* @__PURE__ */ j(xr, { ...e }) });
}
//#endregion
//#region src/sdk.tsx
var Cr = (e) => ({
	status: e.state === "pending" || e.state === "saving" ? "saving" : e.state === "error" ? "error" : e.state === "saved" ? "saved" : "idle",
	message: e.state === "pending" ? "等待保存" : e.state === "saving" ? "正在保存" : e.state === "saved" ? "已保存" : e.error
}), wr = (e) => Object.assign(Object.create(null), e ?? {}), Tr = (e, t) => Object.prototype.hasOwnProperty.call(e, t) ? e[t] : void 0, Er = class {
	engine;
	root;
	container;
	theme;
	readOnly;
	services;
	renderers;
	baseNodeRenderers;
	baseInspectorRenderers;
	nodeRendererLayers = /* @__PURE__ */ new Map();
	inspectorRendererLayers = /* @__PURE__ */ new Map();
	saveState;
	plugins = new Kt();
	autosave;
	disposeAutosave;
	destroyed = !1;
	constructor(e = {}) {
		let t = {
			graph: e.graph,
			migrations: e.migrations,
			historyLimit: e.historyLimit,
			runtime: e.runtime,
			readOnly: e.readOnly
		};
		this.engine = new bt(t), this.theme = e.theme ?? "dark", this.readOnly = e.readOnly ?? !1, this.services = { ...e.services }, this.baseNodeRenderers = Object.freeze(wr(e.renderers?.nodes)), this.baseInspectorRenderers = Object.freeze(wr(e.renderers?.inspectors)), this.renderers = {
			nodes: wr(this.baseNodeRenderers),
			inspectors: wr(this.baseInspectorRenderers)
		};
		let n = [...e.includeBuiltinNodes === !0 ? Ut : [], ...e.nodeTypes ?? []];
		for (let e of n) this.engine.registry.has(e.type) ? this.engine.registry.replace(e) : this.engine.registerNodeType(e);
		e.autosave && (this.saveState = {
			status: "idle",
			message: "等待更改"
		}, this.autosave = new Ke({
			save: e.autosave,
			delay: e.autosaveDelay,
			onStatus: (t) => {
				this.saveState = Cr(t);
				try {
					e.onAutosaveStatus?.(t);
				} catch (e) {
					let t = e instanceof Error ? e : Error(String(e));
					this.engine.events.emit("error", {
						error: t,
						source: "autosave:status-observer"
					});
				}
				this.engine.events.emit("autosave:status", t), this.render();
			},
			onError: (e) => this.engine.events.emit("error", {
				error: e,
				source: "autosave"
			})
		}), this.disposeAutosave = this.engine.on("graph:change", ({ graph: e }) => this.autosave?.schedule(e)));
		try {
			for (let t of e.plugins ?? []) this.use(t);
			e.container && this.mount(e.container);
		} catch (e) {
			try {
				this.destroy();
			} catch (t) {
				throw AggregateError([e, t], "FlowCanvasSDK construction failed and cleanup also reported errors.");
			}
			throw e;
		}
	}
	mount(t) {
		this.assertAlive();
		let n = typeof t == "string" ? document.querySelector(t) : t;
		if (!n) throw Error(`FlowCanvas mount target was not found: ${String(t)}`);
		return this.unmount(), this.container = n, this.root = e(n), this.render(), this;
	}
	unmount() {
		this.root?.unmount(), this.root = void 0, this.container = void 0;
	}
	destroy() {
		if (this.destroyed) return;
		let e = [], t = (t) => {
			try {
				t();
			} catch (t) {
				e.push(t);
			}
		};
		if (t(() => this.plugins.destroy()), t(() => this.disposeAutosave?.()), t(() => this.autosave?.destroy()), t(() => this.unmount()), t(() => this.engine.destroy()), this.destroyed = !0, e.length) throw AggregateError(e, "FlowCanvasSDK was destroyed, but cleanup errors occurred.");
	}
	async flushAutosave() {
		return this.assertAlive(), this.autosave?.flush();
	}
	getAutosaveStatus() {
		return this.assertAlive(), this.autosave?.getStatus();
	}
	import(e) {
		this.assertAlive(), this.engine.importGraph(e);
	}
	export(e = 2) {
		return this.assertAlive(), this.engine.exportGraph(e);
	}
	getGraph() {
		return this.assertAlive(), this.engine.getGraph();
	}
	validate() {
		return this.assertAlive(), this.engine.validate();
	}
	run(e) {
		return this.assertAlive(), this.engine.run(e);
	}
	runNode(e, t) {
		return this.assertAlive(), this.engine.runNode(e, t);
	}
	cancel() {
		this.engine.cancel();
	}
	undo() {
		return this.assertAlive(), this.engine.undo();
	}
	redo() {
		return this.assertAlive(), this.engine.redo();
	}
	addNode(e, t, n) {
		return this.assertAlive(), this.engine.addNode(e, t, n);
	}
	addEdge(e) {
		return this.assertAlive(), this.engine.addEdge(e);
	}
	registerNodeType(e) {
		return this.assertAlive(), this.engine.registerNodeType(e);
	}
	registerNodeRenderer(e, t) {
		this.assertAlive();
		let n = Symbol(e), r = this.nodeRendererLayers.get(e) ?? [];
		r.push({
			token: n,
			renderer: t
		}), this.nodeRendererLayers.set(e, r), this.refreshNodeRenderer(e), this.render();
		let i = !1;
		return () => {
			if (i) return;
			i = !0;
			let t = this.nodeRendererLayers.get(e);
			if (!t) return;
			let r = t.findIndex((e) => e.token === n);
			r !== -1 && (t.splice(r, 1), t.length || this.nodeRendererLayers.delete(e), this.refreshNodeRenderer(e), this.render());
		};
	}
	registerInspectorRenderer(e, t) {
		this.assertAlive();
		let n = Symbol(e), r = this.inspectorRendererLayers.get(e) ?? [];
		r.push({
			token: n,
			renderer: t
		}), this.inspectorRendererLayers.set(e, r), this.refreshInspectorRenderer(e), this.render();
		let i = !1;
		return () => {
			if (i) return;
			i = !0;
			let t = this.inspectorRendererLayers.get(e);
			if (!t) return;
			let r = t.findIndex((e) => e.token === n);
			r !== -1 && (t.splice(r, 1), t.length || this.inspectorRendererLayers.delete(e), this.refreshInspectorRenderer(e), this.render());
		};
	}
	setServices(e) {
		this.assertAlive(), this.services = { ...e }, this.render();
	}
	getServices() {
		return this.services;
	}
	use(e) {
		return this.assertAlive(), this.plugins.use(e, {
			sdk: this,
			engine: this.engine
		});
	}
	unuse(e) {
		return this.assertAlive(), this.plugins.unuse(e);
	}
	setTheme(e) {
		this.assertAlive(), this.theme = e, this.render();
	}
	getTheme() {
		return this.theme;
	}
	setReadOnly(e) {
		this.assertAlive(), this.readOnly = e, this.engine.setReadOnly(e), this.render();
	}
	isReadOnly() {
		return this.readOnly;
	}
	on(e, t) {
		return this.assertAlive(), this.engine.on(e, t);
	}
	render() {
		this.root?.render(/* @__PURE__ */ j(Sr, {
			engine: this.engine,
			theme: this.theme,
			readOnly: this.readOnly,
			renderers: this.renderers,
			services: this.services,
			saveState: this.saveState,
			onThemeChange: (e) => this.setTheme(e)
		}));
	}
	refreshNodeRenderer(e) {
		let t = wr(this.renderers.nodes), n = this.nodeRendererLayers.get(e), r = n?.[n.length - 1]?.renderer ?? Tr(this.baseNodeRenderers, e);
		r ? Object.defineProperty(t, e, {
			value: r,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : delete t[e], this.renderers = {
			...this.renderers,
			nodes: t
		};
	}
	refreshInspectorRenderer(e) {
		let t = wr(this.renderers.inspectors), n = this.inspectorRendererLayers.get(e), r = n?.[n.length - 1]?.renderer ?? Tr(this.baseInspectorRenderers, e);
		r ? Object.defineProperty(t, e, {
			value: r,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : delete t[e], this.renderers = {
			...this.renderers,
			inspectors: t
		};
	}
	assertAlive() {
		if (this.destroyed) throw Error("FlowCanvasSDK instance has been destroyed.");
	}
}, Dr = /* @__PURE__ */ new Set([
	"run.completed",
	"run.failed",
	"run.cancelled"
]), Or = /* @__PURE__ */ new Map([
	["idle", "idle"],
	["queued", "queued"],
	["running", "running"],
	["success", "success"],
	["succeeded", "success"],
	["error", "error"],
	["failed", "error"],
	["cancelled", "cancelled"]
]), kr = /* @__PURE__ */ new Map([
	["success", "success"],
	["succeeded", "success"],
	["completed", "success"],
	["error", "error"],
	["failed", "error"],
	["cancelled", "cancelled"]
]), Ar = (e) => {
	let t = e.trim().replace(/\/+$/, "");
	if (!t) throw Error("Go backend runtime baseURL is required.");
	return t;
}, jr = (e, t = Date.now()) => {
	if (!e) return t;
	let n = Date.parse(e);
	return Number.isFinite(n) ? n : t;
}, Mr = (e) => {
	let t = Or.get(String(e ?? "").toLowerCase());
	if (!t) throw TypeError(`Unknown Go backend node status: ${String(e)}.`);
	return t;
}, Nr = (e) => {
	let t = kr.get(String(e ?? "").toLowerCase());
	if (!t) throw TypeError(`Unknown Go backend run status: ${String(e)}.`);
	return t;
}, Pr = (e, t) => ({
	nodeId: e.nodeId,
	status: Mr(e.status),
	progress: Number.isFinite(e.progress) ? Math.min(1, Math.max(0, e.progress)) : 0,
	attempts: Number.isSafeInteger(e.attempts) && e.attempts >= 0 ? e.attempts : 0,
	message: typeof e.message == "string" ? e.message : void 0,
	error: typeof e.error == "string" ? e.error : void 0,
	startedAt: jr(e.startedAt, t),
	endedAt: e.endedAt ? jr(e.endedAt, t) : void 0
}), Fr = (e) => ({
	valid: e.valid,
	issues: e.issues.map((e) => ({
		...e,
		code: e.code
	}))
}), Ir = class extends Error {
	status;
	body;
	constructor(e, t, n) {
		super(t), this.status = e, this.body = n, this.name = "HTTPError";
	}
}, Lr = class {
	baseURL;
	fetchImpl;
	validateBeforeRun;
	requestTimeoutMs;
	constructor(e) {
		this.baseURL = Ar(e.baseURL);
		let t = e.fetch ?? globalThis.fetch;
		if (typeof t != "function") throw Error("GoBackendWorkflowRuntime requires fetch.");
		this.fetchImpl = t.bind(globalThis), this.validateBeforeRun = e.validateBeforeRun ?? !0, this.requestTimeoutMs = e.requestTimeoutMs ?? 15e3;
	}
	async validate(e) {
		return this.requestJSON("validate", {
			method: "POST",
			body: JSON.stringify({ graph: e })
		});
	}
	async execute(e, t, n) {
		if (this.validateBeforeRun) {
			let t = await this.validate(e);
			if (!t.valid) throw new Y(Fr(t));
		}
		let r = await this.requestJSON("run", {
			method: "POST",
			body: JSON.stringify({
				graph: e,
				options: {
					runId: n.runId,
					stopOnError: n.stopOnError ?? !0
				}
			})
		});
		if (r.runId !== n.runId) throw Error(`Go backend returned an unexpected runId: ${String(r.runId)}.`);
		let i = () => {
			this.cancel(r.runId).catch(() => {});
		};
		if (n.signal.aborted) throw i(), new DOMException("Workflow execution was cancelled.", "AbortError");
		n.signal.addEventListener("abort", i, { once: !0 });
		try {
			await this.consumeEvents(r.events ?? `/runs/${r.runId}/events`, n);
			let t = await this.requestJSON(`runs/${encodeURIComponent(r.runId)}`, { method: "GET" });
			if (!t.result) throw Error(`Go backend run ${r.runId} finished without a result.`);
			return this.normalizeRunResult(t.result, e, n.runId);
		} finally {
			n.signal.removeEventListener("abort", i);
		}
	}
	async cancel(e) {
		await this.requestJSON("cancel", {
			method: "POST",
			body: JSON.stringify({ runId: e })
		});
	}
	async consumeEvents(e, t) {
		let n = await this.fetchImpl(this.resolve(e), {
			method: "GET",
			headers: { accept: "text/event-stream" },
			signal: t.signal
		});
		if (!n.ok) throw await this.responseError(n);
		if (!n.body) throw Error("Go backend SSE response has no body.");
		let r = n.body.getReader(), i = new TextDecoder(), a = "";
		try {
			for (;;) {
				let { value: e, done: n } = await r.read();
				if (n) break;
				a += i.decode(e, { stream: !0 });
				let o = this.consumeSSEBuffer(a, t);
				if (a = o.remaining, o.done) return;
			}
			a += i.decode(), this.consumeSSEBuffer(a, t);
		} catch (e) {
			throw t.signal.aborted ? new DOMException("Workflow execution was cancelled.", "AbortError") : e;
		} finally {
			r.releaseLock();
		}
	}
	consumeSSEBuffer(e, t) {
		let n = e.replace(/\r\n/g, "\n").split("\n\n"), r = n.pop() ?? "";
		for (let e of n) {
			let n = Rr(e);
			if (n && (this.applyEvent(n, t), Dr.has(n.type))) return {
				remaining: r,
				done: !0
			};
		}
		return {
			remaining: r,
			done: !1
		};
	}
	applyEvent(e, t) {
		!e.nodeId || !e.status || e.type.startsWith("node.") && t.onNodeState?.({
			nodeId: e.nodeId,
			status: Mr(e.status),
			progress: Number.isFinite(e.progress) ? Math.min(1, Math.max(0, e.progress ?? 0)) : 0,
			attempts: 0,
			message: e.message,
			error: e.error,
			startedAt: jr(e.timestamp),
			endedAt: Dr.has(e.type) ? jr(e.timestamp) : void 0
		});
	}
	normalizeRunResult(e, t, n) {
		if (e.runId !== n) throw Error(`Go backend snapshot returned an unexpected runId: ${String(e.runId)}.`);
		let r = jr(e.startedAt), i = jr(e.endedAt, r), a = Object.create(null);
		for (let n of t.nodes) {
			let t = e.nodeStates[n.id];
			a[n.id] = t ? Pr(t, i) : {
				nodeId: n.id,
				status: Nr(e.status) === "success" ? "success" : "error",
				progress: 0,
				attempts: 0,
				startedAt: r,
				endedAt: i
			};
		}
		return {
			runId: e.runId,
			status: Nr(e.status),
			nodeStates: a,
			outputs: e.outputs ?? {},
			startedAt: r,
			endedAt: i,
			error: e.error
		};
	}
	async requestJSON(e, t) {
		let n = new AbortController(), r = setTimeout(() => n.abort(), this.requestTimeoutMs);
		try {
			let r = await this.fetchImpl(this.resolve(e), {
				...t,
				headers: {
					accept: "application/json",
					...t.body === void 0 ? {} : { "content-type": "application/json" },
					...t.headers
				},
				signal: t.signal ?? n.signal
			});
			if (!r.ok) throw await this.responseError(r);
			return await r.json();
		} finally {
			clearTimeout(r);
		}
	}
	async responseError(e) {
		let t;
		try {
			t = await e.clone().json();
		} catch {
			try {
				t = await e.text();
			} catch {
				t = void 0;
			}
		}
		let n = typeof t == "object" && t && "error" in t ? String(t.error) : `Go backend request failed with HTTP ${e.status}.`;
		return new Ir(e.status, n, t);
	}
	resolve(e) {
		return /^https?:\/\//i.test(e) ? e : e.startsWith("/") ? `${new URL(this.baseURL).origin}${e}` : `${this.baseURL}/${e.replace(/^\/+/, "")}`;
	}
}, Rr = (e) => {
	let t = e.split("\n"), n = "message", r = [];
	for (let e of t) e.startsWith("event:") ? n = e.slice(6).trim() : e.startsWith("data:") && r.push(e.slice(5).trimStart());
	if (!r.length) return;
	let i = JSON.parse(r.join("\n"));
	return {
		...i,
		type: i.type || n
	};
};
//#endregion
export { Ke as AutosaveController, U as AutosaveFlushError, N as CURRENT_SCHEMA_VERSION, bt as CanvasEngine, yt as CanvasEngineDestroyedError, vt as CanvasReadOnlyError, W as CommandHistory, Sr as FlowCanvasApp, Er as FlowCanvasSDK, xt as GENERATION_MODES, Lr as GoBackendWorkflowRuntime, Re as GraphMigrationRegistry, Y as GraphValidationError, ot as LocalWorkflowRuntime, G as NodeRegistry, Kt as PluginHost, $e as RuntimeConfigurationRequiredError, Ye as SpatialIndex, Xe as analyzeTopology, Ve as assertJsonSerializable, Ut as builtinNodeDefinitions, B as cloneGraph, V as createEmptyGraph, It as createGenerationDrafts, H as deserializeGraph, zt as generationCreditCost, Rt as generationDataPatch, Ct as generationModeDescriptors, Mt as generationModeFromNodeType, Nt as generationNodeTypeForMode, Ft as getGenerationModeDescriptor, Z as isGenerationMode, Pt as isGenerationNodeType, et as isRuntimeConfigurationRequiredError, Lt as normalizeGenerationDrafts, Wt as registerBuiltinNodes, We as registerGraphMigration, Ge as serializeGraph, Qe as validateGraph, J as wouldCreateCycle };
