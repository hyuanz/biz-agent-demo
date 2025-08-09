import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentEvent, Message } from '../types/types';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ScenarioSelector, Scenario } from './ScenarioSelector';
import { DataPeekCard } from './DataPeekCard';
import { ToolPanels, ToolPanelEvent } from './ToolPanels';
import { StatusBar } from './StatusBar';
import { fetchHealth, streamAgentChat } from '../services/api';
import { createNewSessionId, getOrCreateSessionId } from '../lib/session';
// event source helpers removed in minimal UI

// Agent-only UI

function makeId() {
  return Math.random().toString(36).slice(2);
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [gptEnabled, setGptEnabled] = useState<boolean>(false);
  const [agentTrace, setAgentTrace] = useState<AgentEvent[]>([]);
  const [adjustedQuery, setAdjustedQuery] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>('');
  const [memoryData, setMemoryData] = useState<unknown | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [thinkingForMessageId, setThinkingForMessageId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario>('users');
  const [leftWidth, setLeftWidth] = useState<number>(280);
  const [rightWidth, setRightWidth] = useState<number>(360);
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [leftExpandedWidth, setLeftExpandedWidth] = useState<number>(280);
  const [uploadedPeeks, setUploadedPeeks] = useState<Array<{ id: string; title: string; columns: string[]; rows: any[][] }>>([]);
  const [injectedUploadContext, setInjectedUploadContext] = useState<boolean>(false);
  const [toolPanels, setToolPanels] = useState<ToolPanelEvent[]>([]);
  const [demoPanels, setDemoPanels] = useState<ToolPanelEvent[]>([]);
  const [hasWelcomed, setHasWelcomed] = useState<boolean>(false);
  const [insightsOpen, setInsightsOpen] = useState<boolean>(false);
  const welcomeLockRef = useRef<boolean>(false);

  const abortRef = useRef<AbortController | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const currentAssistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    // restore sidebar width
    const storedW = Number(localStorage.getItem('leftWidth') || '0');
    if (storedW >= 200 && storedW <= 480) {
      setLeftWidth(storedW);
      setLeftExpandedWidth(storedW);
    }
    const storedR = Number(localStorage.getItem('rightWidth') || '0');
    if (storedR >= 260 && storedR <= 520) setRightWidth(storedR);
    const storedCollapsed = localStorage.getItem('leftCollapsed');
    if (storedCollapsed === '1') setLeftCollapsed(true);
    fetchHealth()
      .then((h) => {
        setHealthOk(Boolean(h.ok));
        setGptEnabled(Boolean(h.gpt_enabled));
      })
      .catch(() => setHealthOk(false));
    // removed sample queries fetch to avoid extra network noise
    setSessionId(getOrCreateSessionId());
  }, []);

  // Build dynamic system prompt
  function buildSystemPrompt(): string {
    const header = 'You are a Business Analytics Agent. You analyze tabular data and respond with clear, concise insights.';
    const dataPart = uploadedPeeks.length > 0
      ? `Data sources: Use ONLY the uploaded datasets below. Ignore demo data.\n\n${uploadedPeeks.map((p) => `Dataset: ${p.title}\nColumns: ${p.columns.join(', ')}`).join('\n\n')}`
      : 'Data sources: Use the demo datasets (users, events, purchases).';
    const tools = 'Tool policy: Prefer business_insight first (one-sentence insight + small table). Use chartjs_data for simple bar/line charts. Offer sql_tutor only if the user asks for SQL help. Call stakeholder_suggest only after an insight/chart and the user seems ready to share. Keep streams short and professional. Never emit raw JSON to the user.';
    const style = 'Style: Be brief. One short paragraph plus a compact table when helpful. Ask a follow-up question.';
    return `${header}\n${dataPart}\n${tools}\n${style}`;
  }

  // Initial greeting via agent (no tools)
  const startInitialGreetingRef = useRef<null | (() => Promise<void>)>(null);

  startInitialGreetingRef.current = useCallback(async () => {
    if (hasWelcomed || welcomeLockRef.current) return;
    welcomeLockRef.current = true;
    setHasWelcomed(true);
    const assistantMsg: Message = { id: makeId(), role: 'assistant', content: '' };
    setMessages((prev) => [...prev, assistantMsg]);
    setLoading(true);
    setThinkingSteps([]);
    setThinkingForMessageId(assistantMsg.id);
    const systemContent = buildSystemPrompt();
    const greetingUserMsg = { role: 'user', content: 'Send greeting message. Don’t call any tools yet.' };
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAgentChat(
        { session_id: sessionId, messages: [{ role: 'system', content: systemContent } as any, greetingUserMsg] },
        {
          onEvent: (ev) => {
            if ((ev as any).type === 'final') {
              setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: (m.content || '') + ((ev as any).text || '') } : m)));
              setThinkingForMessageId(null);
            }
          },
          onError: () => {},
          onDone: () => setLoading(false),
        },
        controller
      );
    } catch {
      setLoading(false);
    } finally {
      abortRef.current = null;
    }
  }, [hasWelcomed, sessionId, uploadedPeeks]);

  // Trigger greeting on first mount/new session
  useEffect(() => {
    if (sessionId && messages.length === 0 && !hasWelcomed && startInitialGreetingRef.current) {
      void startInitialGreetingRef.current();
    }
  }, [sessionId, messages.length, hasWelcomed]);

  const canSend = useMemo(() => input.trim().length > 0, [input]);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const updateAssistantContent = useCallback((id: string, delta: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)));
  }, []);

  const startAgentStream = useCallback(
    async (question: string) => {
      const userMsg: Message = { id: makeId(), role: 'user', content: question };
      const assistantMsg: Message = { id: makeId(), role: 'assistant', content: '' };
      appendMessage(userMsg);
      appendMessage(assistantMsg);
      currentAssistantIdRef.current = assistantMsg.id;
      setLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setThinkingSteps([]);
        setThinkingForMessageId(assistantMsg.id);
        // Build payload messages; if there are uploaded datasets, inject a one-time context preface
        const baseHistory = messages.concat(userMsg).map((m) => ({ role: m.role, content: m.content }));
        const hasUploads = uploadedPeeks.length > 0;
        const contextPreface = hasUploads && !injectedUploadContext
          ? [{
              role: 'user',
              content: `Context: Use ONLY the uploaded datasets below for analysis. Ignore any demo/sample data.\n\n` +
                uploadedPeeks
                  .map((p) => `Dataset: ${p.title}\nColumns: ${p.columns.join(', ')}`)
                  .join('\n\n'),
            }]
          : [];
        if (hasUploads && !injectedUploadContext) setInjectedUploadContext(true);

        await streamAgentChat(
          { session_id: sessionId, messages: [...contextPreface, ...baseHistory] },
          {
            onEvent: (ev) => {
              if (ev.type === 'query_update') {
                setAdjustedQuery((ev as any).query || '');
              }
              if (ev.type === 'tool_call') {
                setThinkingSteps((prev) => [...prev, `Calling tool: ${ev.name}`]);
              }
              if (ev.type === 'tool_result') {
                setThinkingSteps((prev) => [...prev, `Received result from: ${ev.name}`]);
                const name = (ev as any).name as string;
                const result = (ev as any).result as any;
                // Store only successful/meaningful results
                const panel = (() => {
                  switch (name) {
                    case 'business_insight': {
                      const hasInsight = Boolean(result?.insight && String(result.insight).trim().length > 0);
                      const hasColumns = Array.isArray(result?.columns) && result.columns.length > 0;
                      const hasRows = Array.isArray(result?.rows) && result.rows.length > 0;
                      const hasData = Array.isArray(result?.data) && result.data.length > 0;
                      if (!hasInsight && !(hasColumns && (hasRows || hasData))) return null;
                      return { type: 'business_insight', result } as ToolPanelEvent;
                    }
                    case 'chartjs_data': {
                      if (!result?.chartjs) return null;
                      return { type: 'chartjs_data', result } as ToolPanelEvent;
                    }
                    case 'sql_tutor': {
                      const tipsLen = Array.isArray(result?.tips) ? result.tips.length : 0;
                      const examplesLen = Array.isArray(result?.examples) ? result.examples.length : 0;
                      const hasSchema = result?.schema && Object.keys(result.schema).length > 0;
                      if (tipsLen + examplesLen === 0 && !hasSchema) return null;
                      return { type: 'sql_tutor', result } as ToolPanelEvent;
                    }
                    case 'stakeholder_suggest': {
                      const suggestionsLen = Array.isArray(result?.suggestions) ? result.suggestions.length : 0;
                      const hasPrompt = Boolean(result?.prompt);
                      if (suggestionsLen === 0 && !hasPrompt) return null;
                      return { type: 'stakeholder_suggest', result } as ToolPanelEvent;
                    }
                    case 'run_analysis_plan': {
                      const hasColumns = Array.isArray(result?.columns) && result.columns.length > 0;
                      const hasRows = Array.isArray(result?.rows) && result.rows.length > 0;
                      const hasPython = Boolean(result?.python_code);
                      if (!(hasColumns && hasRows) && !hasPython) return null;
                      return { type: 'run_analysis_plan', result } as ToolPanelEvent;
                    }
                    default:
                      return null; // ignore unknown/unsuccessful
                  }
                })();
                if (panel) setToolPanels((prev) => [...prev, panel]);
              }
              // Do not surface table previews in the chat UI
              if ((ev as AgentEvent).type === 'final') {
                updateAssistantContent(assistantMsg.id, (ev as any).text || '');
                setThinkingForMessageId(null);
              }
            },
            onError: () => {},
            onDone: () => setLoading(false),
          },
          controller
        );
      } catch (err: any) {
        setLoading(false);
      } finally {
        currentAssistantIdRef.current = null;
        abortRef.current = null;
      }
    },
    [appendMessage, messages, sessionId, updateAssistantContent]
  );

  const handleSubmit = useCallback(() => {
    const q = input.trim();
    if (!q) return;
    // If a previous stream is ongoing, abort it before starting a new one
    if (loading && abortRef.current) {
      try {
        // mark previous assistant message as stopped early so it doesn't look like it vanished
        if (currentAssistantIdRef.current) {
          setThinkingForMessageId(null);
          updateAssistantContent(currentAssistantIdRef.current, '\n[stopped early due to new question — partial results may appear in History insights]');
        }
        abortRef.current.abort();
      } catch {}
    }
    setInput('');
    startAgentStream(q);
  }, [input, loading, startAgentStream, updateAssistantContent]);

  // Repurpose cancel into a Manual Demo flow (inserts a staged tool_result panel)
  const handleDemoFlow = useCallback(() => {
    setDemoPanels([
      { type: 'business_insight', result: { insight: 'Demo: Top 3 pages by clicks this week.', columns: ['page', 'clicks'], rows: [{ page: 'home', clicks: 1240 }, { page: 'product', clicks: 978 }, { page: 'checkout', clicks: 652 }] } },
      { type: 'chartjs_data', result: { chartjs: { type: 'bar', data: { labels: ['home', 'product', 'checkout'], datasets: [{ label: 'Clicks', data: [1240, 978, 652], backgroundColor: '#10a37f' }] }, options: { responsive: true, maintainAspectRatio: false } } } },
    ]);
  }, []);

  const handleNewChat = useCallback(() => {
    const id = createNewSessionId();
    setSessionId(id);
    setMessages([]);
    setInput('');
    setAdjustedQuery(null);
    setThinkingSteps([]);
    setThinkingForMessageId(null);
    setToolPanels([]);
    setHasWelcomed(false);
    welcomeLockRef.current = false;
    // Reset default layout proportions for a fresh session
    setLeftCollapsed(false);
    setLeftWidth(leftExpandedWidth || 280);
    localStorage.setItem('leftCollapsed', '0');
    localStorage.setItem('leftWidth', String(leftExpandedWidth || 280));
    setRightWidth(360);
    localStorage.setItem('rightWidth', '360');
  }, []);

  // Memory and trace helpers removed

  // Normalize various possible tool_result table shapes into columns+rows.
  function normalizeTable(result: any): { columns: string[]; rows: any[][] } | null {
    if (!result) return null;
    // Case 1: { columns: string[], rows: any[][] }
    if (Array.isArray(result.columns) && Array.isArray(result.rows)) {
      const columns: string[] = result.columns;
      const rows: any[][] = (result.rows as any[]).map((row: any) => {
        if (Array.isArray(row)) return row;
        if (row && typeof row === 'object') {
          return columns.map((c) => (row as any)[c]);
        }
        return [row];
      });
      return { columns, rows };
    }
    // Case 2: { columns: string[], data: any[] }
    if (Array.isArray(result.columns) && Array.isArray(result.data)) {
      const columns: string[] = result.columns;
      const rows: any[][] = (result.data as any[]).map((row: any) => {
        if (Array.isArray(row)) return row;
        if (row && typeof row === 'object') {
          return columns.map((c) => (row as any)[c]);
        }
        return [row];
      });
      return { columns, rows };
    }
    // Case 3: array of objects/values
    if (Array.isArray(result)) {
      if (result.length === 0) return { columns: [], rows: [] };
      if (typeof result[0] === 'object' && result[0] !== null) {
        const columns = Object.keys(result[0] as any);
        const rows: any[][] = (result as any[]).map((row: any) => columns.map((c) => row[c]));
        return { columns, rows };
      }
      // Primitive values
      return { columns: ['value'], rows: (result as any[]).map((v) => [v]) };
    }
    // Case 4: single object
    if (typeof result === 'object') {
      const columns = Object.keys(result as any);
      const rows = [columns.map((c) => (result as any)[c])];
      return { columns, rows };
    }
    return null;
  }

  // Trace panel removed per user preference

  function tableToCsv(table: { columns: string[]; rows: any[][] }): string {
    const header = table.columns.join(',');
    const body = table.rows
      .map((row) =>
        row
          .map((cell) => {
            const s = String(cell ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
              ? '"' + s.replace(/"/g, '""') + '"'
              : s;
          })
          .join(',')
      )
      .join('\n');
    return header + '\n' + body;
  }

  function reorderPreferredColumns(columns: string[]): string[] {
    const preferred = ['user_id', 'name', 'email'];
    const set = new Set(columns);
    const front = preferred.filter((c) => set.has(c));
    const rest = columns.filter((c) => !front.includes(c));
    return [...front, ...rest];
  }

  // Simple CSV preview parser: returns columns + up to maxRows rows
  function parseCsvPreview(text: string, maxRows: number): { columns: string[]; rows: any[][] } {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return { columns: [], rows: [] };
    const columns = lines[0].split(',').map((s) => s.trim());
    const rows: any[][] = [];
    for (let i = 1; i < Math.min(lines.length, maxRows + 1); i++) {
      const vals = lines[i].split(',');
      rows.push(vals.map((v) => v.trim()));
    }
    return { columns, rows };
  }

  const effectiveLeftWidth = leftCollapsed ? 48 : leftWidth;

  return (
    <div className="app-grid" style={{ gridTemplateColumns: `${effectiveLeftWidth}px 1fr ${rightWidth}px` }}>
      <aside className="left-panel">
        {!leftCollapsed && (
        <div className="notice card" style={{ padding: 12, marginBottom: 12 }}>
          <strong>About</strong>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Synthetic demo only. Explore users, events, and purchases safely.
          </div>
        </div>
        )}
        {/* Collapse/expand control */}
        {!leftCollapsed ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setLeftExpandedWidth(leftWidth);
              setLeftCollapsed(true);
              localStorage.setItem('leftCollapsed', '1');
            }}
            style={{ position: 'absolute', top: 8, right: 8, padding: '4px 8px', zIndex: 2 }}
            aria-label="Collapse left panel"
          >
            Hide
          </button>
        ) : null}
        {/* Onboarding — demo scenarios always visible */}
        {!leftCollapsed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>Scenarios (onboarding — demo)</div>
          {uploadedPeeks.length > 0 && (
            <span style={{ fontSize: 11, color: '#0f9d58' }}>Using uploaded datasets for analysis</span>
          )}
        </div>
        )}
        {!leftCollapsed && <ScenarioSelector value={scenario} onChange={setScenario} />}
        {!leftCollapsed && (
        <div style={{ marginTop: 12 }}>
          {scenario === 'users' && (
            <DataPeekCard
              title="Users (sample)"
              columns={["id", "name", "email", "age"]}
              rows={[["u_001", "Taylor Fox", "taylor@example.com", 29],["u_002","Jordan Cruz","jordan@example.com",34],["u_003","Robin Lee","robin@example.com",26]]}
            />
          )}
          {scenario === 'events' && (
            <DataPeekCard
              title="Events (sample)"
              columns={["id","user_id","event_type","page","clicks"]}
              rows={[["e_101","u_001","page_view","home",4],["e_102","u_002","add_to_cart","product",2],["e_103","u_003","checkout_start","checkout",1]]}
            />
          )}
          {scenario === 'purchases' && (
            <DataPeekCard
              title="Purchases (sample)"
              columns={["id","user_id","amount_usd","items"]}
              rows={[["p_301","u_001",129.0,2],["p_302","u_002",59.0,1],["p_303","u_003",249.0,3]]}
            />
          )}
        </div>
        )}
        {/* Demo flow trigger under scenarios */}
        {!leftCollapsed && (
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={handleDemoFlow}>
              Run demo
            </button>
            <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>Adds a staged insight and chart to preview the flow.</div>
            {demoPanels.length > 0 && (
              <div className="card" style={{ marginTop: 8, padding: 0 }}>
                <div style={{ padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>Demo results</div>
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <ToolPanels panels={demoPanels} />
                </div>
              </div>
            )}
          </div>
        )}
        {/* Left panel reserved for About and Demo only */}
        {!leftCollapsed && (
        <div className="resizer" onMouseDown={(e) => {
          const startX = e.clientX;
          const startW = leftWidth;
          const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            const next = Math.max(200, Math.min(480, startW + dx));
            setLeftWidth(next);
            localStorage.setItem('leftWidth', String(next));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }} />
        )}
        {leftCollapsed && (
          <div
            role="button"
            aria-label="Expand left panel"
            onClick={() => { setLeftCollapsed(false); localStorage.setItem('leftCollapsed', '0'); }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              background:
                'linear-gradient(180deg, rgba(16,163,127,0.25), rgba(124,58,237,0.25))',
              color: '#065f46',
              fontSize: 18,
              userSelect: 'none'
            }}
            title="Expand"
          >
            📊
          </div>
        )}
      </aside>
      <main className="main-panel">
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Guided path */}
          <div className="card" style={{ margin: '8px 12px', padding: 12, position: 'sticky', top: 8, zIndex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Short path to start exploring</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                className="btn"
                style={{ borderStyle: 'dashed' }}
                onClick={() => setInput('Give me top 5 buyers (name + revenue) and a one-sentence summary.')}
              >Give me top 5 buyers (name + revenue) and a one-sentence summary.</button>
              <button
                className="btn"
                style={{ borderStyle: 'dashed' }}
                onClick={() => setInput('Show a bar chart of the top 5 pages by clicks.')}
              >Show a bar chart of the top 5 pages by clicks.</button>
              <button
                className="btn"
                style={{ borderStyle: 'dashed' }}
                onClick={() => setInput('How do I write SQL to find daily revenue?')}
              >How do I write SQL to find daily revenue?</button>
            </div>
          </div>
          <MessageList messages={messages} thinkingForMessageId={thinkingForMessageId} thinkingSteps={thinkingSteps} />
        </div>
        {adjustedQuery && (
          <div style={{ padding: '4px 12px', fontSize: 12, color: '#555' }}>
            Adjusted query: <em>{adjustedQuery}</em>
          </div>
        )}
        <Composer
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          disabledInput={false}
          disabledSubmit={!canSend}
          onNewChat={handleNewChat}
        />
      </main>
      <aside className="right-panel">
        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Agent thinking</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            {thinkingSteps.length === 0 && <li>Idle</li>}
            {thinkingSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
        <div className="card" style={{ padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Insights (latest)</div>
          {toolPanels.length === 0 ? (
            <div style={{ fontSize: 12, color: '#666' }}>No insights yet</div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <ToolPanels panels={[toolPanels[toolPanels.length - 1]]} />
            </div>
          )}
        </div>
        <div className="card" style={{ marginTop: 12, padding: 0 }}>
          <div style={{ padding: '8px 12px', fontWeight: 600, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>History insights</span>
            <button className="btn" style={{ padding: '4px 8px' }} onClick={() => setInsightsOpen((v) => !v)}>{insightsOpen ? 'Minimize' : 'Expand'}</button>
          </div>
          {insightsOpen && (
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {toolPanels.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: '#666' }}>No history yet</div>
              ) : (
                <ToolPanels panels={toolPanels} />
              )}
            </div>
          )}
        </div>
        {/* Upload (beta) moved to bottom-right — blend in, no card background */}
        <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
          <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 600 }}>
            Upload CSV <span style={{ fontSize: 10, color: '#999', marginLeft: 6 }}>(beta)</span>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#777', display: 'block', marginBottom: 6 }}>Create a new Data Peek from your CSV</label>
            <input type="file" accept=".csv" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                const { columns, rows } = parseCsvPreview(text, 3);
                if (columns.length > 0) {
                  setUploadedPeeks((prev) => [
                    ...prev,
                    { id: makeId(), title: `Uploaded dataset: ${file.name}`, columns, rows },
                  ]);
                  setInjectedUploadContext(false); // inject context on next send
                }
              } catch {
                // ignore parse errors in demo
              }
            }} />
          </div>
          {uploadedPeeks.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ marginBottom: 6, fontSize: 12, color: '#666', fontWeight: 600 }}>Uploaded datasets</div>
              {uploadedPeeks.map((p) => (
                <div key={p.id} style={{ marginBottom: 8 }}>
                  <DataPeekCard title={p.title} columns={p.columns} rows={p.rows} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="resizer-left" onMouseDown={(e) => {
          const startX = e.clientX;
          const startW = rightWidth;
          const onMove = (ev: MouseEvent) => {
            const dx = startX - ev.clientX; // dragging left increases width
            const next = Math.max(260, Math.min(520, startW + dx));
            setRightWidth(next);
            localStorage.setItem('rightWidth', String(next));
          };
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }} />
      </aside>
      {/* footer status removed for a blended look */}
    </div>
  );
}

export default ChatWindow;


