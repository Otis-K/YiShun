import { useEffect, useRef, useState } from 'react';
import {
  AtSign,
  Bot,
  CircleCheck,
  CopyPlus,
  DatabaseZap,
  Send,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import type { CanvasEngine } from '../core/engine';
import type { CanvasNode, GraphDocument, NodeDefinition, ValidationIssue } from '../core/types';
import type { FlowCanvasAssistantService } from '../services';
import type { FlowCanvasInspectorRenderer } from './extensions';
import { PluginBoundary } from './PluginBoundary';

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

interface AssistantMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
}

interface DraftHistory {
  nodeId: string;
  field: 'title' | 'prompt';
  before: GraphDocument;
}

export function Inspector({
  engine,
  node,
  definition,
  issues,
  onClose,
  readOnly = false,
  renderer: PropertyRenderer,
  assistant,
  tab,
  onTabChange,
  onDraftChange,
}: InspectorProps) {
  const [assistantInput, setAssistantInput] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [title, setTitle] = useState(node?.data.title ?? '');
  const [prompt, setPrompt] = useState(node?.data.prompt?.toString() ?? '');
  const [sending, setSending] = useState(false);
  const assistantController = useRef<AbortController | undefined>(undefined);
  const draftHistory = useRef<DraftHistory | undefined>(undefined);

  useEffect(() => {
    const commitActiveDraft = () => {
      const current = draftHistory.current;
      if (!current) return;
      draftHistory.current = undefined;
      engine.commitSnapshot('编辑节点属性', current.before);
      onDraftChange?.(false);
    };
    commitActiveDraft();
    setTitle(node?.data.title ?? '');
    setPrompt(node?.data.prompt?.toString() ?? '');
    return commitActiveDraft;
  }, [engine, node?.id, onDraftChange]);
  useEffect(() => {
    if (draftHistory.current?.field !== 'title') setTitle(node?.data.title ?? '');
  }, [node?.data.title]);
  useEffect(() => {
    if (draftHistory.current?.field !== 'prompt') setPrompt(node?.data.prompt?.toString() ?? '');
  }, [node?.data.prompt]);
  useEffect(() => {
    if (!assistant && tab === 'assistant') onTabChange('properties');
  }, [assistant, onTabChange, tab]);
  useEffect(() => () => assistantController.current?.abort(), []);

  const nodeIssues = node ? issues.filter(issue => issue.nodeId === node.id) : issues;

  const commitDraft = (label: string) => {
    const current = draftHistory.current;
    if (!current) return;
    draftHistory.current = undefined;
    engine.commitSnapshot(label, current.before);
    onDraftChange?.(false);
  };

  const beginDraft = (field: DraftHistory['field']) => {
    if (!node || readOnly) return;
    const current = draftHistory.current;
    if (current?.nodeId === node.id && current.field === field) return;
    if (current) engine.commitSnapshot('编辑节点属性', current.before);
    draftHistory.current = { nodeId: node.id, field, before: engine.captureSnapshot() };
    onDraftChange?.(true, () => commitDraft('编辑节点属性'));
  };

  const updateTitle = (value: string) => {
    if (!node || readOnly) return;
    beginDraft('title');
    setTitle(value);
    engine.updateNodeData(node.id, { title: value }, { record: false, transient: true });
  };

  const updatePrompt = (value: string) => {
    if (!node || readOnly) return;
    beginDraft('prompt');
    setPrompt(value);
    engine.updateNodeData(node.id, { prompt: value }, { record: false, transient: true });
  };

  const sendAssistant = async () => {
    const value = assistantInput.trim();
    if (!assistant || !value || sending) return;

    const controller = new AbortController();
    assistantController.current?.abort();
    assistantController.current = controller;
    setMessages(current => [...current, { role: 'user', text: value }]);
    setAssistantInput('');
    setSending(true);
    try {
      const result = await assistant.send({
        message: value,
        graph: engine.getGraph(),
        node: node ? structuredClone(node) : undefined,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const text = (typeof result === 'string' ? result : result.message).trim();
      if (!text) throw new Error('AI 助手返回了空内容');
      setMessages(current => [...current, { role: 'assistant', text }]);
    } catch (error) {
      if (controller.signal.aborted) return;
      const text = error instanceof Error ? error.message : String(error);
      setMessages(current => [...current, { role: 'error', text: `请求失败：${text}` }]);
    } finally {
      if (assistantController.current === controller) {
        assistantController.current = undefined;
        setSending(false);
      }
    }
  };

  return (
    <aside className="fc-inspector" aria-label="节点属性">
      <header className="fc-inspector__head">
        <strong>{node?.data.title ?? '画布检查器'}</strong>
        <button type="button" onClick={onClose} aria-label="收起属性面板">››</button>
      </header>
      <div className={`fc-inspector__tabs${assistant ? '' : ' is-single'}`} role="tablist">
        <button className={tab === 'properties' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'properties'} onClick={() => onTabChange('properties')}>节点属性</button>
        {assistant && <button className={tab === 'assistant' ? 'is-active' : ''} type="button" role="tab" aria-selected={tab === 'assistant'} onClick={() => onTabChange('assistant')}>AI 助手</button>}
      </div>

      {tab === 'properties' ? (
        <div className="fc-inspector__scroll">
          {!node ? <div className="fc-inspector__empty">选择一个节点以编辑属性</div> : PropertyRenderer && definition ? (
            <PluginBoundary
              resetKey={PropertyRenderer}
              fallback={<div className="fc-inspector__empty">自定义属性面板渲染失败，请检查插件。</div>}
              onError={error => engine.events.emit('error', { error, source: `renderer:inspector:${node.type}` })}
            >
              <PropertyRenderer
                engine={engine}
                node={node}
                definition={definition}
                issues={nodeIssues}
                readOnly={readOnly}
              />
            </PluginBoundary>
          ) : <>
            <section className="fc-inspector__summary">
              <span><Sparkles size={14} /></span>
              <div><strong>{definition?.title ?? '未知节点类型'}</strong><small>{node.type} · {node.id.slice(0, 8)}</small></div>
            </section>
            <section className="fc-inspector__section">
              <h3>基础信息</h3>
              <label className="fc-field"><span>节点名称</span><input
                readOnly={readOnly}
                value={title}
                onFocus={() => beginDraft('title')}
                onChange={event => updateTitle(event.target.value)}
                onBlur={() => commitDraft('编辑节点名称')}
              /></label>
              {'prompt' in node.data && (
                <label className="fc-field"><span>内容</span>
                  <div className="fc-prompt-editor">
                    <header><span><WandSparkles size={12} /><b>场景描述</b></span>{!readOnly && <button type="button" title="引用节点" onClick={() => {
                      const value = `${prompt}@${node.data.title} `;
                      setPrompt(value);
                      engine.updateNodeData(node.id, { prompt: value });
                    }}><AtSign size={12} /></button>}</header>
                    <textarea
                      readOnly={readOnly}
                      value={prompt}
                      onFocus={() => beginDraft('prompt')}
                      onChange={event => updatePrompt(event.target.value)}
                      onBlur={() => commitDraft('编辑节点内容')}
                    />
                    <footer><span><CircleCheck size={11} />{readOnly ? '只读' : draftHistory.current?.field === 'prompt' ? '编辑中' : '已同步'}</span><small>Prompt · {[...prompt].length} 字</small></footer>
                  </div>
                </label>
              )}
            </section>
            <section className="fc-inspector__section">
              <h3>执行设置</h3>
              <label className="fc-field"><span>重试次数</span><select disabled={readOnly} value={Number(node.data.retryCount ?? 0)} onChange={event => { if (!readOnly) engine.updateNodeData(node.id, { retryCount: Number(event.target.value) }); }}><option value="0">不重试</option><option value="1">1 次</option><option value="2">2 次</option><option value="3">3 次</option></select></label>
              <button className="fc-setting-row" disabled={readOnly} type="button" onClick={() => { if (!readOnly) engine.updateNodeData(node.id, { cache: node.data.cache === false }); }}>
                <span className="fc-setting-row__icon"><DatabaseZap size={13} /></span><span><strong>缓存运行结果</strong><small>{node.data.cache === false ? '已关闭' : '已开启'}</small></span><i className={node.data.cache === false ? '' : 'is-on'} />
              </button>
            </section>
            <section className="fc-inspector__section">
              <h3>节点校验</h3>
              <div className={`fc-validation-summary ${nodeIssues.length ? 'has-issues' : ''}`}>
                {nodeIssues.length ? nodeIssues.map(issue => <p key={`${issue.code}-${issue.portId ?? ''}`}>{issue.message}</p>) : <p><CircleCheck size={12} />校验通过</p>}
              </div>
            </section>
            {!readOnly && <section className="fc-inspector__section">
              <h3>节点操作</h3>
              <div className="fc-inspector__actions"><button type="button" onClick={() => engine.duplicateSelection()}><CopyPlus size={13} />复制</button><button className="is-danger" type="button" onClick={() => engine.removeNodes([node.id])}><Trash2 size={13} />删除</button></div>
            </section>}
          </>}
        </div>
      ) : assistant ? (
        <div className="fc-assistant">
          <div className="fc-assistant__context"><span><Bot size={14} /></span><div><strong>画布上下文已连接</strong><small>{engine.getGraphSnapshot().nodes.length} 个节点 · {issues.length} 项校验信息</small></div></div>
          <div className="fc-assistant__messages" aria-live="polite">
            {!messages.length && <p>可询问当前图结构、端口、校验或运行状态。</p>}
            {messages.map((message, index) => <p className={`is-${message.role}`} key={`${message.role}-${index}`}>{message.text}</p>)}
            {sending && <p className="is-pending">正在请求…</p>}
          </div>
          <div className="fc-assistant__compose"><textarea disabled={sending} value={assistantInput} onChange={event => setAssistantInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendAssistant(); } }} placeholder="询问当前画布…" /><button disabled={sending || !assistantInput.trim()} type="button" onClick={() => void sendAssistant()} aria-label="发送"><Send size={13} /></button></div>
        </div>
      ) : null}
    </aside>
  );
}
